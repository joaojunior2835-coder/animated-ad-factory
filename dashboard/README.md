# Animated Ad Factory — Dashboard (Local MVP)

A minimal local web dashboard for turning one product input into a staged animated
ad package. Built with Vite + React. No backend, no auth, no database, no external
APIs — everything runs in your browser and your work is kept in `localStorage`.

## Run it

From this `dashboard/` folder:

```bash
npm install
npm run dev
```

Vite serves the app at <http://localhost:5173> (it opens automatically). To run it
inside VS Code, open a terminal in `dashboard/` and run the same commands, then use
the VS Code "Open in Browser" / Simple Browser on the printed URL.

Other scripts:

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
