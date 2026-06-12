# Marketing Studio — Gap Analysis vs Higgsfield

Field notes from a live walkthrough of Higgsfield's Marketing Studio
(higgsfield.ai/marketing-studio/product, June 2026), compared against our local
Marketing Studio (dashboard → 🎬 Marketing Studio). Test ad: fictional French
wellness drink "Calme", UGC format, Interview hook, Kitchen setting, avatar
attached. One sample generation was launched (40 credits).

> Scope note: Higgsfield generates **finished videos in the cloud for credits**.
> Ours generates **paste-ready prompts locally for free**. Many differences are
> intentional; the gaps worth closing are about *input UX and creative
> guidance*, not about becoming a video generator.

## How Higgsfield's Marketing Studio actually works

**It is not a step wizard.** It is a single full-page composer with attachments:

- One prompt bar: "Describe what happens in the ad…" with Product/App mode tabs.
- Attachment slots: **PRODUCT** (from URL scrape, manual image upload, or a saved
  product library) and **AVATAR** (one slot only). Selected entities appear as
  **@mentions inside the prompt text** (e.g. `@Nia`, `@CloudCool™…`).
- Three pickers as chips under the prompt, each opening a curated modal:
  - **Format** ("Pick the format that hits", tabs All/UGC/Commercial, 9 formats):
    UGC ("Realistic social media videos"), Tutorial ("Step-by-step tutorials"),
    Unboxing ("High-quality unboxing"), Hyper Motion ("Highlight your product"),
    Product Review ("Authentic product reviews"), TV Spot ("Authentic stories,
    amplified"), Wild Card ("A unique and creative video mode for custom ideas"),
    UGC Virtual Try On ("Try before you buy"), Pro Virtual Try On ("Advanced
    virtual try-on"). Every card is a looping video example.
  - **Hook** ("Hooks that stop the scroll — the first 3 seconds decide if your ad
    gets watched or skipped. Pick a proven opener.", tabs All/Stunt/Subtle,
    search): 9 named hooks, each a video example + one-line recipe — Product Hit,
    Spicy, Interview, Random Object Mic, Product Crash, Blizzard, Camera Bump,
    Product Dodge, Epic Fail. Picking one pins its **full prompt text in an
    editable "Hook prompt" banner** above the composer (Edit button).
  - **Setting** ("Settings that set the scene", tabs All/Realistic/Unrealistic,
    search): 14 settings, each a video example + mini scene description —
    Bedroom, Airplane Wing, Nature, Roofing, Gym, Volcano Rim, Bathroom, Tiny
    Reviewer, Kitchen, Car Roof, In Car, Street, Office, Train Surf.
- A sliders popover: Aspect ratio (Auto/16:9/9:16/4:3/3:4/1:1/21:9), Quality
  (480p/720p/1080p), Duration (slider, default 8s).
- **GENERATE** shows the live credit cost on the button (48 → 40 with promo).
  After clicking: "Generation started" toast, a project is created (URL gets
  `marketing-project-id`), the view becomes a canvas-like project workspace with
  a 9:16 placeholder tile + spinner + cancel, and the composer stays docked and
  editable at the bottom. Generation runs server-side for minutes.
- **Avatars**: ~20 pre-built, full-body photo + first name only (no language,
  style, or voice metadata). Search, All/Pinned/My-avatars filters, Male/Female
  filter, pin-to-top, "Create avatar" (custom avatar creation; the AI Influencer
  studio owns deep customization).
- **Sidebar tools**:
  - **Url to Ad** — "Make a video ad in one click. Drop a product link, get an ad
    ready for TikTok, Reels, and Shorts. No filming, no editing, no brief."
  - **Ad Reference** — "Paste a viral ad and turn it into your own — same hook,
    same energy, now selling your product" (upload reference video + product +
    avatar). Their version of our Competitor Video Recreation.
- **Projects** sidebar (auto-saved server-side), "All generations" library,
  community gallery of format examples with **Recreate** buttons that pre-fill
  the composer.

Things notably absent on Higgsfield: any script/scene editing before generation,
any visible scene-by-scene plan, podcast/two-person formats, host/guest
assignment (single avatar slot), language selector (language is inferred from
the prompt text), claim/compliance fields, duration math, and any way to see the
final video prompt that was used (only the hook prompt is exposed).

---

## WHAT HIGGSFIELD HAS THAT WE ARE MISSING

1. **A hook library** — named, categorized (Stunt/Subtle), searchable proven
   openers with one-line recipes, where picking one injects an editable hook
   prompt. We generate one hook line from the brief; we have no menu of proven
   hook patterns. This is their single best creative-guidance idea.
2. **A setting/scene library** — 14 named settings (Bedroom → Volcano Rim) with
   mini scene descriptions that slot into the prompt. Our scenes carry one
   auto-written `visualDescription`; users get no curated location/mood choices.
3. **Visual example-first selection** — every format/hook/setting card is a
   looping video example; the community gallery has one-click **Recreate** that
   pre-fills the whole composer. We have text-only cards and no example
   gallery/recreate flow.
4. **Product as a first-class reusable entity** — URL scrape ("Url to Ad"),
   manual creation with images, and a saved product library reusable across
   projects. Our brief is retyped text per session; no product library, no
   image attachment.
5. **More commercial format coverage** — Unboxing, Tutorial, Product Review,
   Hyper Motion, Virtual Try On, TV Spot, Wild Card (9 vs our 5). Several
   (Unboxing, Tutorial, Product Review) map cleanly onto our scene-arc engine.
6. **Multiple named projects with auto-save** — a Projects sidebar, each project
   its own workspace; we have exactly one studio session slot.
7. **@mention entity references in the prompt** — attached avatar/product become
   tokens inside the text, making one prompt read naturally while staying
   structured.
8. **Per-generation aspect-ratio/quality/duration overrides** in a compact
   sliders popover (7 ratios, 3 quality tiers, free duration slider). We fix
   aspect ratio per format and offer 4 clip durations.

## WHAT WE HAVE THAT HIGGSFIELD DOES NOT

1. **A reviewable, editable script & scene plan before anything is generated** —
   Higgsfield goes prompt → finished video with zero scene-level control; we
   expose every scene's dialogue, beat, shot, and duration for editing. Keep.
2. **Podcast / two-person formats with host-guest alternation** — Higgsfield has
   one avatar slot and no dialogue formats at all. Our french_podcast/ugc_podcast
   with strict speaker alternation is genuinely differentiated. Keep.
3. **Visible, paste-ready prompts as the product** — they hide everything except
   the hook prompt; we output the full per-clip prompt package (setup header +
   prompt + notes) for Google Flow/Omni/Seedance. Keep — it's the core value.
4. **Language as a first-class control + French-never-Seedance routing** —
   Higgsfield infers language from prompt text; we enforce omni-v51 rules
   (duration in header only, no appearance, gaze rule, natural-pace tail,
   word-count→duration). Keep.
5. **Compliance / claim-boundary field** baked into the brief and carried into
   the export. Higgsfield has nothing of the kind.
6. **Duration math against a target ad length** (clip durations vs 15/30/45/60s
   target). Higgsfield generates one clip at a time (~8s); no campaign-length
   thinking.
7. **Zero cost, zero cloud, zero login** — their flow burned 40 credits for one
   8-second clip and locked when credits ran out ("All credits used").
8. **Structured competitor-analysis extraction into the brief** — Ad Reference
   needs a video file upload; our paste-text extraction fills the brief fields
   instantly.
9. **Markdown production package + Node Canvas hand-off** — a complete
   documented deliverable; they output a video file in a webapp.

## WHAT EXISTS IN BOTH BUT NEEDS TO BE CLOSER

1. **Hook handling** — both treat the hook as the make-or-break first 3 seconds,
   but they offer 9 named selectable hook patterns while we auto-write one line.
   Ours should become a hook-pattern picker that feeds `generateSceneOutline`.
2. **Format selection** — both use card grids, but their cards teach by example
   (video loop + style category tabs). Ours should at least gain category
   grouping and per-format example scripts/outlines as a "preview".
3. **Character/avatar picking** — both have a roster + custom option. They have
   photos, pinning, search, gender filter; we have richer *metadata* (language,
   style, tags) but no visuals and no pinning/search. Converge: keep metadata,
   add image slots + search/pin.
4. **Product/brief input** — both support "describe it" + assisted fill. Their
   assisted fill is URL scrape; ours is competitor-text paste. Ours should also
   persist products as reusable entities (name + brief + image URLs) in
   localStorage.
5. **Project/session model** — they auto-save many named projects; we have one
   localStorage session with explicit save. Ours should become a named-sessions
   list (still localStorage-only).
6. **Setting the scene** — they pick a setting per *ad*; we write a per-scene
   visual description. A settings library injected into scene
   `visualDescription` would close it without losing per-scene control.

## WHAT IS NOT WORTH COPYING

1. **Actual cloud video generation, credits, and upsell banners** — entire
   credit economy (40 credits/clip, "All credits used" lockout, Upgrade CTAs)
   contradicts our zero-API, zero-cost constraint.
2. **Single-clip output model** — one ~8s clip per generation with no campaign
   structure is a *limitation* driven by GPU cost, not a feature.
3. **Hiding the final prompt** — their black-box prompt assembly is the opposite
   of our product (the prompt package IS our output).
4. **Url-to-Ad full automation ("no brief")** — needs server-side scraping and
   their generation backend; our extraction-from-paste covers the intent
   locally.
5. **AI Influencer studio / custom avatar generation** — a separate
   GPU-backed product; our frame-carries-identity model already handles custom
   characters.
6. **Account, projects-in-cloud, community gallery infrastructure** — explicitly
   out of scope (no login/users/cloud).

---

# PRIORITY FIX LIST

## TIER 1 — DO THIS NEXT (high impact, fast to build)

1. **Hook library** — add `HOOKS` to marketingStudioModel.js (10-15 named hooks:
   pattern name, category stunt/subtle/question/curiosity, one-line recipe,
   FR+EN line templates); a hook picker in Step 1/Step 4 that overrides scene 1
   and stays editable.
2. **Settings library** — add `SETTINGS` (10+ named settings with scene
   descriptions, realistic/unrealistic categories); picker per studio +
   per-scene override that feeds `visualDescription`.
3. **Format categories + 3 new formats** — group format cards (UGC / Commercial /
   Podcast), and add `unboxing`, `tutorial`, `product_review` formats reusing the
   existing arc engine (product-handling shot types, VO/dialogue mix like
   cinematic).
4. **Named saved sessions** — replace the single `aaf_marketing_studio_session`
   slot with a session list (name, updated_at) + New/Load/Delete in the studio
   header; auto-name from the product name like Higgsfield auto-names projects
   from the prompt; same localStorage, no backend.
5. **Per-scene aspect-ratio sanity + quality hint in setup header** — allow
   overriding aspect ratio per studio (not per format only) and surface a
   quality line (720p/1080p) in the markdown package header.

## TIER 2 — DO AFTER TIER 1 (high impact, more complex)

1. **Product library** — reusable product entities (name, brief fields, image
   URLs/local refs) stored in localStorage, attachable to any session; pre-fills
   the brief.
2. **Example-first format cards** — per-format sample scene outline + sample
   prompt shown in a preview drawer ("what you'll get"), our equivalent of their
   video examples.
3. **Recreate-from-package** — import a previously exported markdown package (or
   saved session JSON) back into the wizard as a starting point — our analog of
   the community "Recreate" button.
4. **Character gallery upgrade** — optional image URL/local path per character,
   search + pin, gender/language filters in one row; keep metadata badges.
5. **Hook/setting search** — text filter across hook + setting libraries once
   they exist (trivial after Tier 1, listed separately so Tier 1 stays small).

## TIER 3 — FUTURE SPRINT (nice to have)

1. **App-ad mode** — a second composer mode for app/SaaS ads (screens instead of
   product shots), mirroring their Product/App tabs.
2. **A/B variant generation** — generate 2-3 hook/CTA variants per package
   (already on our future list; their Wild Card format strengthens the case).
3. **Per-scene regenerate-with-different-hook/setting** — combinatorial remix
   inside Step 4.
4. **Reference-ad video notes** — a structured "reference ad breakdown" form
   (their Ad Reference, minus upload): timestamped beats feeding scene arcs —
   bridges Marketing Studio and the existing Canvas competitor workflow.
5. **Community-style local gallery** — render saved sessions as cards with their
   first prompt as preview text.

---

## Walkthrough evidence log (Task 1 detail)

1. **Step structure**: no steps — single composer (prompt bar + chips + slots +
   GENERATE) on one page; project workspace after generating. Validation seen:
   GENERATE requires being logged in with credits; cost is shown on the button;
   no field-level errors encountered (everything optional except the prompt
   in practice).
2. **Format selector**: modal grid of 9 video-example cards, categories
   All/UGC/Commercial, selected card = white border; chip shows the pick.
   No clip counts or aspect ratios are shown on the cards (single-clip model;
   ratio lives in the sliders popover).
3. **Avatar system**: ~20 avatars, photo + name only; search, All/Pinned/My
   avatars, Male/Female filter; pinning; Create avatar entry; selecting injects
   an @mention; **one avatar slot only** (no host/guest).
4. **Brief/script**: no brief form and no script step — one free-text prompt,
   @mentions, editable hook prompt banner. AI-assist equivalents: Url-to-Ad
   scraping and hook/setting prompt injection.
5. **Generation & output**: "Generation started" toast → project workspace with
   spinner tile + cancel; took ~3-4 minutes server-side; cost 40 credits
   (30%-off promo from 48); account hit "All credits used" right after one
   clip. The project **auto-named itself from the prompt** ("Calme Evening
   Dr…"). Output = one 9:16 video tile in the project canvas with hover
   actions (like, download, duplicate, audio control) and a "…" menu:
   **Recreate, Reuse prompt, Like, Share, Copy to, Publish, Download,
   Ad Reference URL, Remove**. So the typed prompt is reusable afterward, and
   any output can immediately become the reference for an Ad Reference run.
   Per-clip edit = re-prompt in the docked composer. The generated avatar's
   look only loosely matched the picked avatar thumbnail.
6. **UX patterns**: left sidebar (Tools + Projects), composer docked
   bottom after first generation (fully editable = "go back" equivalent),
   auto-saved projects, zoom slider + Liked filter in the workspace, tooltips
   are modal-header taglines, community gallery = format examples with Recreate.

*Test substitution note: product attachment used the account's existing saved
product (CloudCool comforter) because manual product creation requires a native
file-picker upload; the "Calme" framing was carried in the prompt text. This
does not affect any UI/flow observation above.*
