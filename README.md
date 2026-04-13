# Backend

Express API that collects Signed Tree Heads (STHs) from CT monitors and serves them to the browser extension for split-world detection. Acts as the central data store for the CT verification system.

## What it does

- Receives STH reports from monitor instances via authenticated API
- Stores STHs in PostgreSQL with metadata (log ID, tree size, root hash, monitor ID)
- Provides aggregate statistics (per-log breakdowns, per-monitor activity, ingestion rates)
- Exposes data for the browser extension

## API endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/sth` | Submit STH data (authenticated with `MONITOR_API_KEY`) |
| `GET /api/stats` | Aggregate statistics and per-monitor activity |
| `GET /api/healthcheck` | Health check |
| `GET /api/docs` | Swagger UI (dev only) |

## Prerequisites

- Docker

## Setup

```bash
cp .env.example .env
# Edit .env with real credentials
docker compose up -d --build
```

The API binds to `127.0.0.1:3000` - external access goes through the proxy.

## Environment variables

| Variable | Description |
|----------|-------------|
| `POSTGRES_USER` | PostgreSQL username |
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `POSTGRES_DB` | Database name |
| `PORT` | API port (default: 3000) |
| `MONITOR_API_KEY` | Shared secret for monitor authentication |

## Project structure

```
src/
  index.ts              # Server entrypoint
  prisma.ts             # Prisma client
  swagger.ts            # Swagger/OpenAPI config
  routes/
    sth.ts              # STH ingestion endpoint
    stats.ts            # Statistics and monitoring endpoint
    healthcheck.ts      # Health check
prisma/                 # Database schema and migrations
docker-compose.yml      # API + PostgreSQL + Adminer (dev profile)
```
