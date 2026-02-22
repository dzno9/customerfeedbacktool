# Customer Feedback Consolidation MVP

## Stack
- Next.js (App Router) + TypeScript + Tailwind
- Prisma + PostgreSQL
- BullMQ + Redis
- OpenAI API for extraction/summarization

## Quick start
1. Install deps:
   npm install
2. Copy env file:
   cp .env.example .env
   # set INTERCOM_CREDENTIALS_ENCRYPTION_KEY to a 32-byte value
3. Generate Prisma client:
   npm run prisma:generate
4. Run app:
   npm run dev

## Current state
- Baseline scaffold created.
- Ready to implement US-005 Canonical Feedback Model and first migrations.
