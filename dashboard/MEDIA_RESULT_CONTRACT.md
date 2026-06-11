# Media Generation Result Contract

One shared, normalized shape for **every** generation result — Manual, Mock, and any
future API media provider. It exists so the preview → attach → save → export pipeline
is identical no matter where the output came from.

> **Connected:** OpenAI **text-to-image** (`generate_image`) flows through this
> contract (backend returns a `data_url`, frontend normalizes it). **Video is not
> connected** (any provider), and OpenRouter image is not connected. Future providers
> (Kling / Seedance / fal / Replicate) just map their raw output into this shape — no
> UI rewrite needed.

Module: [`src/lib/ai/mediaResultContract.js`](src/lib/ai/mediaResultContract.js) (frontend-only, no API calls, no keys).

## The normalized result

```
{
  id, provider_id, provider_name, action_type,
  media_type,    // image | video | prompt | text | json | unknown
  source_type,   // mock | manual | api | external_url | upload | local_disk
  status,        // success | error | pending | unsupported
  prompt, output_text, raw_output,
  external_url, data_url, local_url,
  file_name, mime_type, file_size,
  storage,       // mock | session | external_url | local_disk | none
  scene_id, variation_id, created_at, request_id, model, error
}
```

## Helpers

- **`normalizeMediaResult(input)`** — convert any raw provider/orchestrator result
  into the shape above (derives `media_type` from `action_type`, `storage`/`source_type`
  from the URLs present, and `status` from success/unsupported flags).
- **`mediaResultToVariation(result)`** — map a result to scene-variation fields
  (preserves provider, prompt, media type, external/local URL, storage, file metadata).
- **`getMediaResultPreview(result)`** — `{ url, preview, local }` props for `<MediaPreview/>`.
- **`getMediaResultHealth(result)`** — the health label (see below).
- **`isMediaResultSaveable(result)`** — true only when it carries inline `data_url`
  not yet on disk (so it can be saved to the Local Media Library).
- **`isMediaResultAttachable(result)`** — true for a successful result that has media
  or text to represent as a variation.

## Pipeline

1. **Generate** — Manual / Mock / API actions run, then `normalizeMediaResult(...)`
   produces a contract result shown in the **Generation Result** modal.
2. **Review** — the modal shows provider, source type, action, media type, model,
   request id, status, error, a preview (if any), the prompt, and the output. Nothing
   is auto-applied or auto-saved.
3. **Attach** — **Add As Scene Variation** turns an attachable result into a scene
   variation (selectable for the Final Timeline).
4. **Save** — **Save To Local Media Library** appears only when the result has inline
   `data_url`; it writes to local disk and updates the result with
   `local_url` / `storage: local_disk` / `file_name` / `mime_type` / `file_size`.
5. **Export** — Final Export records the normalized metadata where present
   (source, storage, action, model, request id, created_at, local/external URL, size).

## Preview precedence and health labels

Preview order (same everywhere): **local_url → external_url → data_url/session preview
→ mock placeholder → text fallback**.

Health labels: **Local file saved · URL saved · Session-only preview · Mock result ·
No media attached**.

## OpenAI text-to-image (`generate_image`)

With Provider Mode = API and API Provider = OpenAI, an image action:

1. Shows a confirmation: *"This will use OpenAI image API credits. Continue?"*
2. Generates exactly **one** image server-side (`OPENAI_IMAGE_MODEL`, optional
   `OPENAI_IMAGE_SIZE`/`OPENAI_IMAGE_QUALITY`); the backend returns a `data_url`.
3. The result is normalized (`media_type: image`, `source_type: api`, `status: success`),
   previewed in the modal, and is **saveable** (it has `data_url`) and **attachable**.
4. Nothing is auto-saved: click **Save To Local Media Library** to persist (→ `local_url`,
   `storage: local_disk`) and/or **Add As Scene Variation**.

The image API uses **separate API credits**. `qa:canvas` never makes a real image call
(its backend is keyless, so image actions return a friendly config error).

## Unsupported image/video

Video (any provider) and OpenRouter image are normalized — not crashed — as:

```
status: "unsupported", media_type: "image" | "video", storage: "none",
error: "Image/video generation is not connected yet."
```

They are **not** attachable and make **no** network/API call.

## Rule for future providers

A future image/video provider (backend) must return output that the frontend maps
through `normalizeMediaResult` before display. Do not introduce a second result shape
— everything flows through this contract.
