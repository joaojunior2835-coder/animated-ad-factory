# Local API Backend — Setup (Parts 1–3)

This is a **private, single-user, local-only** tool. There is no login, no
database, no cloud storage, and no multi-user anything. The backend exists so API
keys live on your machine (in the server process) and are **never** placed in the
browser/frontend.

> **Status:** **OpenAI** and **OpenRouter** text/JSON are connected through the
> local backend (`generate_text`, `generate_json`, `repair_json`). **OpenAI
> text-to-image** (`generate_image`) is connected too. **Video generation is NOT
> connected** (any provider). Manual and Mock modes are unchanged.

## 1. Create your keys file

```bash
cd dashboard
cp .env.example .env.local      # Windows: copy .env.example .env.local
```

Fill in whichever keys you have in `.env.local`:

```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.5                 # optional; defaults to gpt-5.5 if blank

OPENROUTER_API_KEY=sk-or-...
OPENROUTER_MODEL=openai/gpt-4o-mini  # REQUIRED for OpenRouter; no default

ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
```

- **`OPENAI_API_KEY`** — required to use OpenAI in API mode. Get it from your OpenAI account.
- **`OPENAI_MODEL`** — OpenAI chat model for text/JSON. If omitted, defaults to `gpt-5.5`.
- **`OPENROUTER_API_KEY`** — required to use OpenRouter in API mode. Get it from your
  OpenRouter account (https://openrouter.ai/keys).
- **`OPENROUTER_MODEL`** — **required** when using OpenRouter; there is **no default**.
  Use an OpenRouter model id, e.g. `openai/gpt-4o-mini` or `anthropic/claude-3.5-sonnet`.
  If it's missing, OpenRouter actions return a clear configuration error instead of guessing.
- **`OPENAI_IMAGE_MODEL`** — **required** for OpenAI text-to-image (`generate_image`);
  there is **no default** (e.g. `gpt-image-2`). Not needed for text/JSON. If missing,
  image actions return a clear image-specific config error.
- **`OPENAI_IMAGE_SIZE`** / **`OPENAI_IMAGE_QUALITY`** — optional image options (e.g.
  `1024x1024`, `low`), sent only if set. Default to **low** quality when configured.
- **Image API uses separate API credits** from text/JSON, billed to your OpenAI account.
- Restart the backend after editing `.env.local` (keys are read at startup).
- **Choosing a provider in the dashboard:** in **Board View → Production Board**, set
  **Provider Mode = API**, then pick **API Provider** (OpenAI or OpenRouter). The
  selection is stored per project (`canvas.api_provider_id`) and is used by every API
  action (Test, Improve Output Prompt, Improve Empty Prompts, Generate Adapted Canvas
  JSON, Repair Canvas JSON). Default is OpenAI.
- **Billing:** OpenAI and OpenRouter each bill **separately** to their own accounts at
  their own rates. This tool does not proxy or meter usage.

- `.env.local` is gitignored. **Never** paste keys into the browser, the dashboard
  UI, or any `src/` file.
- The server reads these keys into its own process only and never returns key
  values to any client (the health check reports booleans, not values).

## 2. Run the backend

```bash
cd dashboard
npm run dev:server
```

It binds to **http://127.0.0.1:8787** (localhost only). Override the port with
`PORT=9000 npm run dev:server` if needed. The frontend's backend URL can be
overridden at build/start time with `VITE_API_BASE_URL` (defaults to
`http://127.0.0.1:8787`); the frontend never receives any API key.

## 3. Run the frontend

In a second terminal:

```bash
cd dashboard
npm run dev          # http://localhost:5173
```

Or run both together:

```bash
cd dashboard
npm run dev:all      # starts Vite + the backend (Ctrl+C stops both)
```

## QA isolation (qa:canvas)

`npm run qa:canvas` is a **deterministic, key-free** smoke test. It does NOT use your
normal backend:

- It starts its **own backend on a dedicated port (8788)** with **all provider keys
  cleared**, and points the test browser at it via a `localStorage` override
  (`API_BASE_URL`). It refuses to reuse a stranger on 8788 and verifies the spawned
  backend is keyless before running (failing fast otherwise).
- Because the QA backend is keyless, **qa:canvas never makes paid OpenAI/OpenRouter
  calls** — provider actions return friendly "not configured" errors, which is what
  the tests assert.
- It works even if your **real keyed backend is already running on 8787**; the two
  never interact. The QA backend is stopped automatically when the run ends.
- **Live API testing** (real OpenAI/OpenRouter round-trips) belongs in runtime QA
  (start the real backend on 8787 and use the dashboard / Antigravity), **not** in
  `qa:canvas`.

## Endpoints

- `GET /health` → `{ ok, status, provider_connected, providers_configured: { openai, anthropic, gemini, openrouter }, openai_model, openrouter_model }`
  (booleans + model names only — never key values). `provider_connected` is true when
  an OpenAI **or** OpenRouter key is present.
- `POST /api/llm` — body `{ provider_id, action_type, input_prompt, context? }`.
  - `provider_id: "openai"` + a configured key → real OpenAI call.
  - `provider_id: "openrouter"` + a configured key + `OPENROUTER_MODEL` → real OpenRouter call.
  - Success: `{ success: true, provider, model, output_text, raw_text, parsed_json?, parse_error?, request_id }`.
  - Missing key/model or unsupported action (image/video) → `{ success: false, error: "...", request_id }`.
  - The key is never logged and never returned.

## Using API mode in the dashboard

1. Start the backend (`npm run dev:server`) and the frontend (`npm run dev`), or
   both with `npm run dev:all`.
2. Open the Canvas → **Board View** → **Production Board**.
3. Set **Provider Mode** to **API**. An **API health panel** appears showing:
   - **connected / not connected** to the local backend,
   - the **backend URL** (default `http://127.0.0.1:8787`, override with
     `VITE_LOCAL_API_BASE` in `.env.local`),
   - **providers configured** (openai / anthropic / gemini / openrouter — booleans
     from `/health`, never key values),
   - **last checked** time and a **Refresh** button, plus the last error if any.

What the messages mean:

- *"API mode is selected, but the local backend is not connected. Run npm run
  dev:server or npm run dev:all."* → the frontend could not reach the local server.
  Start it.
- *"Backend is running, but no API provider key is configured in .env.local."* →
  the server is up but every provider boolean is false. Add a key to `.env.local`
  and restart the server.

4. Choose the **API Provider** (OpenAI or OpenRouter) next to Provider Mode. The
   health panel shows each provider's configured state and model, the currently
   selected provider, and a friendly warning if the selected provider is not configured.

Behavior in API mode:

- **Text/JSON actions** (`generate_text`, `generate_json`, `repair_json`) call the
  local `/api/llm` using the **selected API provider** and show the result in the
  **API Result Preview** modal. For JSON actions the modal also shows the parsed JSON
  (or a parse error). **Nothing is saved or applied automatically** — you review,
  then **Apply / Import / Copy Output / Cancel**.
- **OpenAI image (`generate_image`)** is connected (text-to-image only). With
  Provider Mode = API, API Provider = OpenAI, click an image action (e.g. Regenerate
  Image). You'll get a confirmation — *"This will use OpenAI image API credits.
  Continue?"* — then exactly **one** image is generated and shown in the result modal
  as a preview. **Nothing is saved automatically**: click **Add As Scene Variation**
  and/or **Save To Local Media Library** to keep it. Requires `OPENAI_API_KEY` +
  `OPENAI_IMAGE_MODEL`.
- **Video actions** are **not** connected: *"OpenAI video generation is not connected
  yet."* OpenRouter image/video is also not connected.

### Test Selected API Provider

In the API health panel, click **Test Selected API Provider**. It sends a fixed prompt
(`Reply with exactly: Local backend connected.`) to the currently selected provider and
shows the result or a friendly error inline. It writes nothing to your project. Use it
to confirm your key/model are working.

> The frontend (`src/lib/ai/apiClient.js`) only ever talks to the local backend.
> It never holds, reads, or sends provider API keys. Do not paste keys into the
> browser or any `src/` file — keys live only in `.env.local`, read by the server.

## Canvas Brain actions (OpenAI text/JSON)

These use real OpenAI text/JSON via the local backend. Each button is labeled
**"Uses OpenAI API credits."** and only works when **Provider Mode = API**. Set
that in **Board View → Production Board**, then use the actions below (most live in
**List View**). Every result opens the **API Result Preview** modal — nothing is
applied until you click an apply/import button.

**Improve Output Prompt (one scene)**
1. Provider Mode = API. In List View, expand a scene.
2. Click **Improve Output Prompt with API**.
3. Review the returned prompt, then **Apply to scene** (sets that scene's
   `output_prompt`), **Copy Output**, or **Cancel**.

**Improve all empty prompts**
1. In List View → Prepare Export, click **Improve Empty Prompts with API**.
2. It asks OpenAI for prompts for every scene with no `output_prompt` and shows
   the parsed JSON. Click **Apply Prompts To Empty Scenes** to fill only the empty
   ones, or **Cancel**.

**Generate Adapted Canvas JSON**
1. In List View → Generate Adaptation, click **Generate Adapted Canvas JSON with
   API** (sends the same prompt as Generate Adaptation Prompt).
2. Review `raw output` + `parsed JSON`, then **Import JSON** (validates and updates
   scenes/method data — brand docs and brief are untouched), **Copy Output**, or
   **Cancel**.

**Repair JSON**
1. Paste AI JSON into **Import Adapted Canvas JSON** and click Import. If it fails
   validation and Provider Mode = API, **Repair JSON with API** appears (alongside
   the existing **Copy Repair Prompt**).
2. Click it to send the invalid JSON + exact errors to OpenAI; review the repaired
   JSON, then **Import JSON** or **Cancel**.

If the key is missing or the backend is down, each action shows a friendly error in
the modal and changes nothing.

## API Action Log & debugging

Every API call is gated and traced so usage stays controlled:

- **Confirmation:** before any paid OpenAI call, a modal asks *"This will use OpenAI
  API credits. Continue?"* — click **Continue** or **Cancel**. Manual and Mock
  never show this.
- **API Action Log** (Board View, collapsible panel): a **session-only** record of
  API calls, newest first. Each row shows time, status (success/error), provider,
  action, model, scene (if any), `request_id`, short prompt/output previews, and any
  error. It is cleared on reload and with **Clear log**. No API keys are stored.
- **request_id:** each `/api/llm` response includes a `request_id` (also shown in
  the API Result Preview modal and the log). Use it to correlate a specific call
  when debugging.
- **Copy Debug Info:** in the API Result Preview modal, this copies `request_id`,
  provider, action, model, status, error, and prompt/output previews — never any
  key — so you can paste a full picture of a failed call.
- **Model display:** the API health panel shows the active backend model
  (`openai_model` from `/health`).

To debug a failed API call:

1. Reproduce it; note the friendly error in the modal.
2. Click **Copy Debug Info** (or read the matching row in the API Action Log).
3. Check the backend terminal for the same `request_id` and confirm
   `OPENAI_API_KEY` / `OPENAI_MODEL` are set and the backend was restarted.

## Billing & limits

- **API usage is billed to your own provider account(s)** at their rates. **OpenAI and
  OpenRouter bill separately.** This tool does not proxy, meter, or resell anything —
  calls go straight from your local backend to the selected provider using your key.
  There is no cost tracker yet.
- Set usage limits in each provider account if you want a hard ceiling.
- **Image and video generation APIs are still not connected** (OpenAI or OpenRouter).
  Those actions stay in Manual or Mock mode.

## What is connected / not connected

- **Connected now:** OpenAI and OpenRouter **text/JSON** (`generate_text`,
  `generate_json`, `repair_json`), plus **OpenAI text-to-image** (`generate_image`),
  via the local backend — with an approval-gated result modal and a per-project API
  provider selector.
- **Not connected:** Anthropic, Gemini (placeholders), **OpenRouter image**, and **all
  video generation** — those route to Manual or Mock mode.
- **Not in this tool at all:** cloud storage, database, login, multi-user.

## Security notes

- Keys never leave the local server process; the frontend never reads them.
- The key is never logged by the backend and never returned in any response.
- Server listens on `127.0.0.1` only.
- Do not commit `.env.local`.
