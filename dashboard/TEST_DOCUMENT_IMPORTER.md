# Manual Test: Universal Document Importer & Brand Library

QA steps for the Brand Library document importer and its hand-off into the AI
prompt. Pure-logic checks are automated in `npm run test:docs`; the steps below
cover the browser behaviour (uploads, extraction, binding) that can't be tested in
Node.

## Setup

```bash
cd dashboard
npm install      # only if not already installed
npm run dev      # opens http://localhost:5173
```

Open the dashboard and click **Brand Library** in the left nav.

Test files live in `dashboard/test-assets/`:
- `brand-test.txt`
- `brand-test.md`
- `brand-test.json`

For the PDF test you need any PDF that contains **selectable text** (not a scan).
Easiest: open `test-assets/brand-test.md` (or `.txt`) and "Print → Save as PDF",
or use any existing text PDF you have.

---

## 1. Upload TXT / MD / JSON (automatic extraction)

1. In **Global Brand Library**, click **Add Document**.
2. Go to the **Upload Files** tab.
3. (Optional) pick tags, e.g. `brand voice`, `compliance`.
4. Click **Choose files** and select all three: `brand-test.txt`, `brand-test.md`, `brand-test.json`.
5. **Expected:** three rows appear, each with a green **success** badge and the file
   text shown in the box. Source badges read `txt`, `markdown`, `json`.
6. Click **Add 3 document(s) to Library**. The modal closes.
7. **Expected:** three new cards in the Global Brand Library, each tagged `Global`.

## 2. Upload a PDF (automatic extraction with fallback)

1. **Add Document → Upload Files → Choose files →** select your text PDF.
2. **Expected (text PDF):** a `pdf` source badge and a **success** (or **partial**)
   status, with extracted text in the box.
3. **Expected (scanned/image PDF):** a **failed** status and the message
   "No selectable text found … Paste the text manually." Paste any text into the
   box — the row becomes importable.
4. Click **Add … document(s) to Library**.
5. **Expected:** the PDF doc is added with source type `pdf`. The app never crashes,
   even if extraction failed.

> DOCX behaves the same way: `.docx` uploads auto-extract via the bundled library,
> and fall back to manual paste if they can't be read.

## 3. Paste a Google Doc manually

1. **Add Document → Google Docs** tab.
2. **Expected:** a note reads "Paste the Google Doc text here for now. Direct Google
   Docs import will come later."
3. Enter a **Google Doc title**, an optional **URL** (e.g. a docs.google.com link),
   and paste some text into **content**. Pick a tag like `offer`.
4. Click **Add to Library**.
5. **Expected:** a new card with source type `google_docs`. (No Google sign-in is
   requested — this is manual by design.)

## 4. Search / filter the library

1. Type `cravings` in the **Search** box.
2. **Expected:** only docs whose title/content contain "cravings" remain.
3. Clear search. Set the **tag** filter to `compliance`.
4. **Expected:** only docs tagged `compliance` show.
5. Set the **source** filter to `json`.
6. **Expected:** only the JSON doc shows. Reset both filters to `All`.

## 5. Add docs to the Current Project

1. On a library card, click **Add to Project**.
2. **Expected:** the card now shows an **In Current Project** label (and the button
   becomes **Remove from Project**). The doc appears under **Current Project Docs**.
3. Repeat for a second doc.

## 6. Mark docs Active in the AI Prompt

1. In **Current Project Docs**, each doc has an **Active** checkbox.
2. Leave one doc **Active** (checked) and **uncheck** the other.
3. **Expected:** the active doc shows an **Active in AI Prompt** label; the inactive
   one does not. The library card mirrors the same labels.

## 7. Confirm active docs appear in AI Handoff (and inactive do not)

1. Go to **AI Handoff** in the left nav.
2. Click **Preview prompt**.
3. **Expected:** the **=== ACTIVE BRAND DOCS ===** section contains the **active**
   doc — its title line reads `-- <title> [source: <type>; tags: …] --` followed by
   its content.
4. **Expected:** the **inactive** doc's content does **not** appear anywhere in the
   prompt.
5. Toggle the inactive doc to Active back in Brand Library, return to AI Handoff,
   Preview again. **Expected:** it now appears.

## 8. Confirm the large-context warning

1. Add (or paste) a large doc — roughly **16,000+ characters** of active content
   total. Fast way: **Add Document → Paste Text**, paste a big block, add it, then
   **Add to Project** and keep it **Active**. (Paste the same text a few times to
   exceed the threshold.)
2. Go to **AI Handoff**.
3. **Expected:** a red note appears: **"Large context: consider deselecting
   low-priority docs."** The same note also appears near the top of the generated
   prompt.
4. Deselect/short the doc so total active content drops below ~16,000 chars.
5. **Expected:** the warning disappears.

## 9. Persistence & reset behaviour

1. Reload the page (F5). **Expected:** library and project docs are still there
   (stored in `localStorage`).
2. In the right panel, click **Reset** and confirm. **Expected:** the project clears
   but the **Global Brand Library docs remain** (the library survives project reset).

---

## Pass criteria
- TXT/MD/JSON extract instantly with `success`.
- PDF/DOCX extract automatically when they contain text, and fall back to manual
  paste (clear message, no crash) when they don't.
- Google Docs is a manual paste with title + optional URL.
- Docs can be added to the library, bound to the project, and toggled Active.
- Active docs appear in the AI Handoff prompt; inactive docs never do.
- The large-context warning toggles around the threshold.

## Known limitations
- **No Google OAuth** — Google Docs import is manual paste only.
- **PDF/DOCX run in the browser**; scanned/image-only PDFs have no selectable text
  and require manual paste. Extraction quality depends on the source file.
- The heavy PDF/DOCX libraries load **on demand** (first PDF/DOCX upload), so that
  first extraction may take a moment.
- Storage is browser `localStorage` (per-machine, per-browser); there is no server
  or database.
