# Animated Ad Factory — Dashboard (Local MVP)

A minimal local web dashboard for turning one product input into a staged animated
ad package. Built with Vite + React. No auth and no database — your work is kept in
`localStorage`. AI features go through a small local-only backend that holds your API
keys; without keys the app still runs, just without generation.

## Run it

From this `dashboard/` folder:

```bash
npm install
npm run dev
```

That one command starts **both** parts the app needs:

- the Vite frontend at <http://localhost:5173> (it opens automatically),
- the local API backend at <http://127.0.0.1:8787>.

Open the printed `localhost` URL — do **not** double-click `index.html`, because the
page only loads when served over http. To run it inside VS Code, open a terminal in
`dashboard/` and run the same commands, then use the VS Code "Open in Browser" /
Simple Browser on the printed URL.

The badge in the top-right tells you the state. If it reads *"Local backend
offline"*, only the frontend is running — stop it and use `npm run dev` (or start the
backend separately with `npm run dev:server`). See `API_SETUP.md` for adding keys.

Other scripts:

- `npm run dev:web` — frontend only (no backend; AI features will be offline).
- `npm run dev:server` — backend only.
- `npm run build` — production build into `dist/`.
- `npm run preview` — serve the production build locally.

## What it does

- **Product Intake** — the ten intake fields (name, description, audience, market/
  language, visual style, duration, benefits, claims/restrictions, brand tone,
  brand colors). Auto-saves as you type.
- **Stages** — Audience Psychology, Ad Concept, Story Beats, Frame Prompts, Flow
  Clip Prompts, Voiceover Script, Music Direction, Edit Plan, Final Export. Each
  stage shows what it should produce, a large editable text area, and a **Save
  Stage** button.
- **Project JSON** — a live, copyable view of the structured project.
- **Export** — downloads a Markdown package using the same heading structure as the
  project's existing renderer (`scripts/render_project.py` / `docs/output-spec.md`).

## Relationship to the rest of the project

This dashboard sits on top of the existing foundation (schemas, prompt templates,
docs, and the deterministic Python export renderer). It does not modify or replace
them. See the repository root `README.md` and `docs/system-vision.md` for the full
picture.
