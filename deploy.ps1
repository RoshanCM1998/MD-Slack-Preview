#
# Deploys the MD Preview Slack bot to an existing SmartMoving Azure App Service Plan.
#
# One-time setup:  .\deploy.ps1 -Provision -Secrets -Configure
# Code-only push:  .\deploy.ps1 -Deploy
# Everything:      .\deploy.ps1 -All
#
# Before the first run:
#   1. Fill in the CONFIG block below (subscription, RG, plan, vault, secret values).
#   2. Make the Socket Mode change in bot.js (see "bot.js change" note at the bottom).
#   3. Make sure you're logged in:  az login
#

param(
    [switch]$Provision,     # create the Web App, assign identity, enable Always On
    [switch]$Secrets,       # push Slack tokens into Key Vault
    [switch]$Configure,     # wire Key Vault references into app settings
    [switch]$Deploy,        # zip + push the Node code
    [switch]$All,           # Provision + Secrets + Configure + Deploy
    [switch]$Destroy        # tear the Web App down (does NOT touch Key Vault secrets)
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot

if ($All) {
    $Provision = $true
    $Secrets   = $true
    $Configure = $true
    $Deploy    = $true
}

# =============================================================================
# CONFIG — fill these in before the first run
# =============================================================================

# --- Azure target ---
$SubscriptionId   = ""                              # e.g. "fd072e17-0f7a-42de-baa4-0eed3caeec13"
$ResourceGroup    = ""                              # e.g. "smartmoving-dev-rg"
$AppServicePlan   = ""                              # e.g. "smartmoving-dev-appsvc"   (must be B1+ for Always On)
$WebAppName       = ""                              # globally unique, e.g. "smartmoving-dev-md-slack-preview"
$Location         = "Central US"                    # must match the plan's region

# --- Key Vault ---
$KeyVaultName     = ""                              # reuse an existing vault in the same subscription

# --- Slack secret NAMES inside Key Vault (values are set interactively below) ---
$SecretNameBotToken       = "SlackBotToken"         # xoxb-...
$SecretNameAppToken       = "SlackAppToken"         # xapp-... (Socket Mode app-level token)
$SecretNameSigningSecret  = "SlackSigningSecret"    # only needed if you stay on HTTP Events mode

# --- Runtime ---
$NodeRuntime      = "NODE:20-lts"                   # check: az webapp list-runtimes --os linux

# =============================================================================
# helpers
# =============================================================================

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "   $msg" -ForegroundColor Red }

function Require-Config {
    $missing = @()
    if (-not $SubscriptionId) { $missing += "SubscriptionId" }
    if (-not $ResourceGroup)  { $missing += "ResourceGroup" }
    if (-not $AppServicePlan) { $missing += "AppServicePlan" }
    if (-not $WebAppName)     { $missing += "WebAppName" }
    if (-not $KeyVaultName)   { $missing += "KeyVaultName" }
    if ($missing.Count -gt 0) {
        Write-Err "Missing config values: $($missing -join ', ')"
        Write-Err "Fill in the CONFIG block at the top of deploy.ps1 and re-run."
        exit 1
    }
}

function Ensure-Login {
    $ctx = az account show --query "id" -o tsv 2>$null
    if (-not $ctx) {
        Write-Err "Not logged in. Run:  az login"
        exit 1
    }
    az account set --subscription $SubscriptionId
    if ($LASTEXITCODE -ne 0) { Write-Err "Failed to set subscription $SubscriptionId"; exit 1 }
    $sub = az account show --query "name" -o tsv
    Write-Ok "Subscription: $sub  ($SubscriptionId)"
}

Require-Config
Ensure-Login

# =============================================================================
# 1. Provision the Web App on the existing plan
# =============================================================================

if ($Provision) {
    Write-Step "Creating Web App '$WebAppName' on plan '$AppServicePlan'..."

    $exists = az webapp show -g $ResourceGroup -n $WebAppName --query "name" -o tsv 2>$null
    if ($exists) {
        Write-Warn "Web App already exists — skipping create."
    } else {
        az webapp create `
            --resource-group $ResourceGroup `
            --plan $AppServicePlan `
            --name $WebAppName `
            --runtime $NodeRuntime
        if ($LASTEXITCODE -ne 0) { Write-Err "webapp create failed"; exit 1 }
        Write-Ok "Web App created."
    }

    Write-Step "Enabling HTTPS-only, TLS 1.2, Always On, and startup command..."
    az webapp update -g $ResourceGroup -n $WebAppName --https-only true | Out-Null
    az webapp config set -g $ResourceGroup -n $WebAppName `
        --min-tls-version 1.2 `
        --always-on true `
        --startup-file "node bot.js" | Out-Null
    Write-Ok "App hardened."

    Write-Step "Assigning system-assigned managed identity..."
    $principalId = az webapp identity assign -g $ResourceGroup -n $WebAppName --query "principalId" -o tsv
    if (-not $principalId) { Write-Err "Failed to assign identity"; exit 1 }
    Write-Ok "Managed identity principalId: $principalId"

    Write-Step "Granting 'Key Vault Secrets User' on $KeyVaultName to the app identity..."
    $vaultId = az keyvault show -n $KeyVaultName --query "id" -o tsv
    if (-not $vaultId) { Write-Err "Key Vault '$KeyVaultName' not found in this subscription"; exit 1 }
    az role assignment create `
        --assignee-object-id $principalId `
        --assignee-principal-type ServicePrincipal `
        --role "Key Vault Secrets User" `
        --scope $vaultId | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Warn "Role assignment may already exist — continuing." }
    Write-Ok "Vault access granted."
}

# =============================================================================
# 2. Push Slack tokens into Key Vault (interactive — prompts so tokens never hit disk or history)
# =============================================================================

if ($Secrets) {
    Write-Step "Writing Slack tokens to Key Vault '$KeyVaultName'..."

    # Load values from .env first (if present), then prompt for anything still missing.
    # .env is gitignored — still, keep it off shared drives and delete after you don't need it locally.
    $envValues = @{}
    $EnvFile = Join-Path $Root ".env"
    if (Test-Path $EnvFile) {
        Write-Ok "Reading values from .env"
        foreach ($line in Get-Content $EnvFile) {
            $trimmed = $line.Trim()
            if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
            $eq = $trimmed.IndexOf("=")
            if ($eq -lt 1) { continue }
            $k = $trimmed.Substring(0, $eq).Trim()
            $v = $trimmed.Substring($eq + 1).Trim().Trim('"').Trim("'")
            if ($v) { $envValues[$k] = $v }
        }
    } else {
        Write-Warn ".env not found — will prompt for each value."
    }

    function SecureToPlain($s) {
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
        try   { [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr) }
        finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }

    function Resolve-Secret($envKey, $promptLabel, $optional = $false) {
        if ($envValues.ContainsKey($envKey)) {
            Write-Ok "Using $envKey from .env"
            return $envValues[$envKey]
        }
        $label = if ($optional) { "$promptLabel (Enter to skip)" } else { $promptLabel }
        $secure = Read-Host -AsSecureString $label
        return SecureToPlain $secure
    }

    $botPlain = Resolve-Secret "SLACK_BOT_TOKEN"     "SLACK_BOT_TOKEN (xoxb-...)"
    $appPlain = Resolve-Secret "SLACK_APP_TOKEN"     "SLACK_APP_TOKEN (xapp-..., for Socket Mode)"
    $sigPlain = Resolve-Secret "SLACK_SIGNING_SECRET" "SLACK_SIGNING_SECRET" $true

    if ($botPlain) {
        az keyvault secret set --vault-name $KeyVaultName --name $SecretNameBotToken      --value $botPlain | Out-Null
        Write-Ok "Set $SecretNameBotToken"
    }
    if ($appPlain) {
        az keyvault secret set --vault-name $KeyVaultName --name $SecretNameAppToken      --value $appPlain | Out-Null
        Write-Ok "Set $SecretNameAppToken"
    }
    if ($sigPlain) {
        az keyvault secret set --vault-name $KeyVaultName --name $SecretNameSigningSecret --value $sigPlain | Out-Null
        Write-Ok "Set $SecretNameSigningSecret"
    }

    $botPlain = $null; $appPlain = $null; $sigPlain = $null; $envValues = $null
    [GC]::Collect()
}

# =============================================================================
# 3. Wire Key Vault references into app settings
# =============================================================================

if ($Configure) {
    Write-Step "Configuring app settings with Key Vault references..."

    $vaultUri = "https://$KeyVaultName.vault.azure.net/secrets"
    $settings = @(
        "SLACK_BOT_TOKEN=@Microsoft.KeyVault(SecretUri=$vaultUri/$SecretNameBotToken/)",
        "SLACK_APP_TOKEN=@Microsoft.KeyVault(SecretUri=$vaultUri/$SecretNameAppToken/)",
        "SLACK_SIGNING_SECRET=@Microsoft.KeyVault(SecretUri=$vaultUri/$SecretNameSigningSecret/)",
        "AUTO_JOIN_CHANNELS=true",
        "WEBSITE_NODE_DEFAULT_VERSION=~20",
        "SCM_DO_BUILD_DURING_DEPLOYMENT=true"
    )

    az webapp config appsettings set `
        -g $ResourceGroup `
        -n $WebAppName `
        --settings $settings | Out-Null

    Write-Ok "App settings configured."
    Write-Warn "Verify Key Vault references resolved:"
    Write-Host "   az webapp config appsettings list -g $ResourceGroup -n $WebAppName -o table" -ForegroundColor Gray
}

# =============================================================================
# 4. Deploy code (zip deploy)
# =============================================================================

if ($Deploy) {
    Write-Step "Packaging and deploying bot code..."

    $ZipPath = Join-Path $Root "deploy.zip"
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }

    # Include only what the app needs at runtime. Kudu will run `npm install` because of SCM_DO_BUILD_DURING_DEPLOYMENT.
    $Include = @("bot.js", "package.json", "package-lock.json")
    $Missing = $Include | Where-Object { -not (Test-Path (Join-Path $Root $_)) }
    if ($Missing) { Write-Err "Missing files: $($Missing -join ', ')"; exit 1 }

    Compress-Archive -Path ($Include | ForEach-Object { Join-Path $Root $_ }) -DestinationPath $ZipPath -Force
    Write-Ok "Built $ZipPath"

    az webapp deploy `
        --resource-group $ResourceGroup `
        --name $WebAppName `
        --src-path $ZipPath `
        --type zip
    if ($LASTEXITCODE -ne 0) { Write-Err "Deploy failed"; exit 1 }

    Write-Ok "Deployed."
    Write-Host ""
    Write-Host "   App URL:  https://$WebAppName.azurewebsites.net" -ForegroundColor Gray
    Write-Host "   Logs:     az webapp log tail -g $ResourceGroup -n $WebAppName" -ForegroundColor Gray
    Write-Host "   Restart:  az webapp restart -g $ResourceGroup -n $WebAppName" -ForegroundColor Gray
}

# =============================================================================
# Destroy (optional)
# =============================================================================

if ($Destroy) {
    Write-Step "Deleting Web App '$WebAppName'..."
    $confirm = Read-Host "Type DELETE to confirm"
    if ($confirm -ne "DELETE") { Write-Warn "Cancelled."; exit 0 }
    az webapp delete -g $ResourceGroup -n $WebAppName
    Write-Ok "Web App deleted. Key Vault secrets were NOT touched."
}

# =============================================================================
# bot.js change required BEFORE the first deploy
# =============================================================================
#
# Switch to Socket Mode so there's no public inbound endpoint on company infra.
# In bot.js, replace the `new App({...})` block with:
#
#   const app = new App({
#     token: process.env.SLACK_BOT_TOKEN,
#     appToken: process.env.SLACK_APP_TOKEN,
#     socketMode: true,
#   });
#
# Remove `signingSecret` and the `customRoutes` array — neither is needed in Socket Mode.
#
# In the Slack app config:
#   - Enable "Socket Mode" and generate an app-level token with scope `connections:write`
#   - That token is what you paste as SLACK_APP_TOKEN when prompted by -Secrets
#
