# Animated Ad Factory

## Mission

Private, local, single-user dashboard for producing and testing AI video ads for DTC ecommerce.

This is NOT SaaS.
Do not add users, login, billing infrastructure, cloud database, or multi-user architecture.

## Stack

- React/Vite frontend
- Node.js ESM backend
- SQLite via better-sqlite3
- MCP server
- Local filesystem media storage

## Ports

- Frontend: localhost:5173
- Backend: 127.0.0.1:8787
- MCP: 127.0.0.1:8789
- qa:canvas: 8788

## Security / Provider Rules

- Never expose API keys in frontend code or logs.
- All real provider API calls go through the backend.
- Never return base64 media to the frontend.
- Save media locally and return paths/URLs.
- Do not make real paid provider calls in automated tests.

## Architecture Invariants

Preserve:

- ProductTest / Iteration / Creative / ProductionRun lineage
- atomic budget reservation
- FX blocking before paid production execution
- restart-safe async reconciliation
- bounded retry
- idempotent settlement
- explicit paid-production confirmation
- frozen production specifications

Do not change SQLite schema or budget/reservation logic without an explicit Phase 0 audit.

## Current State

M0-M5 complete.
MCP server complete.
fal.ai configured.
Groq can be ignored for now.

Current priority:

1. Seedance 2.0 provider integration
2. minimal M6 assembly
3. start using the tool for real production

Speed is now a priority.

## Scope Discipline

Do not refactor unrelated working systems.
Do not fix documentation unless required for the active task.
Do not migrate MCP transport unless explicitly requested.
Do not add future features early.
Prefer minimal changes that get the production workflow usable.

## Required Verification

Every completed build sprint must run:

npm run build
npm run qa:canvas
npm run qa:e2e
npm run test:docs
node scripts/test-studio.mjs
npm run test:studio

qa:canvas must remain exactly 68/68.

If the sprint touches M5 production execution, also run relevant:

- test-m5-dispatch.mjs
- test-m5-restart.mjs
- test-m5-retry.mjs

Do not commit if required tests fail.

After a successful sprint:
git commit
git push origin main
