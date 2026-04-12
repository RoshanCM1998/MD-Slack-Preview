# Architecture Overview

Our system uses a **microservices** architecture with 3 layers.

## Tech Stack

| Layer   | Technology | Port | Status |
|---------|-----------|------|--------|
| API     | Express   | 3000 | ✅ Live |
| Worker  | Bull      | -    | ✅ Live |
| DB      | Postgres  | 5432 | ✅ Live |

## Getting Started

```bash
npm install
npm run dev
```

## Key Features

- **Hot reload** in development
- Built-in *rate limiting*
- ~~Legacy auth~~ replaced with OAuth2

### Task List

- [x] Setup CI/CD
- [x] Add monitoring
- [ ] Write integration tests
- [ ] Deploy to staging

> **Note:** Make sure to configure your `.env` file before running.

```javascript
const config = {
  port: process.env.PORT || 3000,
  db: process.env.DATABASE_URL,
  redis: process.env.REDIS_URL,
};

export default config;
```
