# Customer Feedback Consolidation MVP

Single-tenant MVP to consolidate product feedback from Intercom and file uploads, generate opportunity clusters, and support PM review workflows.

## Current status
- Implemented through US-015 in this repository.
- App includes:
  - Review queue + actions (`/review`)
  - Weekly brief generation + snapshots (`/briefs`)
  - Reliability/health panel (`/`)
  - Audit log view (`/audit-logs`)
- Intercom status/connect/backfill APIs are available.

## Stack
- Next.js (App Router) + TypeScript + Tailwind
- Prisma + PostgreSQL
- BullMQ + Redis
- OpenAI API for summarization/signal extraction

## Local quick start
1. Install dependencies:
```bash
npm install
```
2. Create env file:
```bash
cp .env.example .env
```
3. Set required environment variables in `.env`:
- `DATABASE_URL`
- `REDIS_URL`
- `OPENAI_API_KEY`
- `INTERCOM_CREDENTIALS_ENCRYPTION_KEY` (32-byte secret; base64 or raw)
- `INTERNAL_API_KEY`
4. Generate Prisma client:
```bash
npm run prisma:generate
```
5. Run migrations (local development database):
```bash
npm run prisma:migrate
```
6. Run app:
```bash
npm run dev
```
7. (Optional but recommended) run workers in separate terminals:
```bash
npm run worker:feedback-summary
npm run worker:feedback-signals
npm run worker:intercom-sync
```

## Production deployment (single-tenant)
Recommended simplest setup: Railway for app + workers + Postgres + Redis.

1. Create a Railway project from this GitHub repo.
2. Add Postgres service.
3. Add Redis service.
4. Add environment variables to the web service:
- `DATABASE_URL` (from Railway Postgres)
- `REDIS_URL` (from Railway Redis)
- `OPENAI_API_KEY`
- `INTERCOM_CREDENTIALS_ENCRYPTION_KEY`
- `INTERNAL_API_KEY`
- `NODE_ENV=production`
5. Build/start commands for web service:
- Build: `npm run build`
- Start: `npm run start`
6. Run production migrations once:
```bash
npx prisma migrate deploy
```
7. Create 3 worker services from same repo:
- Worker 1 start command: `npm run worker:feedback-summary`
- Worker 2 start command: `npm run worker:feedback-signals`
- Worker 3 start command: `npm run worker:intercom-sync`
8. Copy the same env vars to each worker service.

### Backfill safety limits (recommended)
To prevent large Intercom workspaces from creating massive queues/cost spikes, set:
- `INTERCOM_BACKFILL_MAX_RECORDS` (default `500`)
- `INTERCOM_BACKFILL_MAX_PAGES` (default `20`)

You can also override per request on backfill API:
```bash
curl -X POST "$APP_URL/api/sync/intercom/backfill" \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-02-01T00:00:00.000Z","to":"2026-02-07T23:59:59.999Z","maxRecords":200,"maxPages":10}'
```

## Intercom integration
Current MVP exposes API endpoints for connection and sync:
- `POST /api/integrations/intercom/connect`
- `GET /api/integrations/intercom/status`
- `POST /api/sync/intercom/backfill`

Example connect request:
```bash
curl -X POST "$APP_URL/api/integrations/intercom/connect" \
  -H "Content-Type: application/json" \
  -d '{"accessToken":"<INTERCOM_ACCESS_TOKEN>"}'
```

Example backfill request:
```bash
curl -X POST "$APP_URL/api/sync/intercom/backfill" \
  -H "Content-Type: application/json" \
  -d '{"from":"2026-01-01T00:00:00.000Z","to":"2026-01-31T23:59:59.999Z"}'
```

## Security notes
- Revoke any leaked PATs or API tokens immediately.
- Keep all secrets only in provider env settings (never commit secrets).
- `INTERNAL_API_KEY` protects internal mutation endpoints (delete/restore).
