# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prospection B2B (searchPDG) — a B2B prospecting app for searching companies in Northern France, finding executive contacts, retrieving emails, and exporting to CSV. All UI and comments are in French.

## Commands

### Development (runs backend + frontend concurrently)
```
npm run dev
```
- Backend: Express on port 3001 (via nodemon)
- Frontend: Vite dev server on port 5173

### Build frontend for production
```
cd frontend && npm run build
```
Output goes to `backend/public/` (served by Express in production).

### Production
```
NODE_ENV=production node backend/server.js
```
Serves both API and built frontend on port 3001. On Windows, `start.bat` handles install + build + run.

### Database migrations (Prisma)
```
cd backend && npx prisma migrate dev
npx prisma generate
```

## Architecture

**Monorepo with two packages** — root `package.json` uses `concurrently` to run both:

- **`backend/`** — Node.js/Express API server. Routes in `backend/routes/` act as proxies to external APIs. Uses PostgreSQL via Prisma ORM (single table: `EntrepriseExportee` for export history).
- **`frontend/`** — React 18 + Vite + Tailwind CSS. Most business logic lives in `App.jsx` (search state, enrichment orchestration, filtering). Components: `SearchForm`, `ResultsTable`, `DetailPanel`, `ExportButton`, `StatusBanner`. API calls centralized in `services/api.js`.

### External API integrations (all proxied through backend routes)

| Route file | External API | Purpose |
|---|---|---|
| `entreprises.js` | data.gouv.fr | Official company data (SIREN/SIRET) |
| `claude.js` | Brave Search | Find company websites + LinkedIn HR contacts (filename is misleading — no Anthropic API call here) |
| `hunter.js` | Hunter.io | Domain email search fallback |
| `dropcontact.js` | Dropcontact | Email enrichment (uses polling, not webhooks) |
| `exports.js` | PostgreSQL | Export history CRUD |
| `status.js` | — | Health check for all APIs |

Routes are mounted under `/api/<name>` in `backend/server.js`. In dev, CORS is restricted to `http://localhost:5173`; in prod (`NODE_ENV=production`) CORS is disabled and Express serves the built SPA from `backend/public/` with a catch-all route for client-side routing.

### Key patterns

- Frontend deduplicates results by SIREN across multi-department/sector searches
- Dropcontact enrichment uses a polling loop (10 attempts, 4s intervals)
- `import.meta.env.PROD` switches API base URL between dev (localhost:3001) and production (relative)
- Vite build outputs directly into `backend/public/` so Express can serve the SPA

## Environment

Backend requires `backend/.env` with:
- `DROPCONTACT_API_KEY` — email enrichment
- `BRAVE_API_KEY` — website/HR search
- `HUNTER_API_KEY` — domain email search fallback
- `DATABASE_URL` — PostgreSQL connection string (Supabase)
- `PORT` — server port (default 3001)

See `backend/.env.example` for the template. The `@anthropic-ai/sdk` dependency is present in `backend/package.json` but not currently imported — no Claude/Anthropic API key is required.

## No test suite

There are currently no tests configured in this project.
