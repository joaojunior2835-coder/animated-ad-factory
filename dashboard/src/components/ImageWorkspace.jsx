import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { apiBase } from '../lib/ai/apiClient.js'
import { assetDimensions, downloadLocalAsset } from '../lib/assetMedia.js'
import AssetPreview from './AssetPreview.jsx'
import ModelSettings from './ModelSettings.jsx'
import './ImageWorkspace.css'

const EMPTY_CONTEXT = { productTestId: '', creativeId: '' }
const IN_FLIGHT = ['Queued', 'Generating', 'Downloading', 'Preparing references', 'Uploading references']
const money = minor => minor == null ? 'Unavailable' : `€${(Number(minor) / 100).toFixed(2)}`
const imageDraft = scene => ({
  ...(scene?.id ? { id: scene.id } : {}), kind: 'image', name: scene?.name || 'Image concept',
  prompt: scene?.prompt || '', provider: scene?.provider || '', model: scene?.model || '',
  mode: 'text-to-image', imageSize: scene?.imageSize || '', outputFormat: scene?.outputFormat || '',
  quantity: Number(scene?.quantity || 1),
})
const isImage = scene => scene.kind === 'image' || scene.mode === 'text-to-image'
const usableModel = model => model.configured && model.implemented && model.priced

async function request(path, body, signal) {
  const response = await fetch(`${apiBase()}/api/operator/generator/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal,
  })
  const result = await response.json()
  if (!response.ok || result.ok === false) throw new Error(result.error || 'The image workspace request failed.')
  return result
}

function defaultsForModel(model, previous = imageDraft()) {
  const sizes = model.imageSizes || [], formats = model.outputFormats || []
  return {
    ...previous, provider: model.provider, model: model.model, mode: 'text-to-image',
    imageSize: sizes.some(size => size.id === previous.imageSize) ? previous.imageSize : (sizes.find(size => size.id === 'square_hd') || sizes[0])?.id || '',
    outputFormat: formats.includes(previous.outputFormat) ? previous.outputFormat : formats[0] || '',
    quantity: Math.min(model.quantity?.max || 1, Math.max(model.quantity?.min || 1, previous.quantity || 1)),
  }
}

function Confirmation({ quote, busy, onCancel, onConfirm }) {
  const dialogRef = useRef(null)
  const cancelRef = useRef(onCancel), busyRef = useRef(busy)
  cancelRef.current = onCancel
  busyRef.current = busy
  useEffect(() => {
    const previousFocus = document.activeElement
    dialogRef.current?.querySelector('button')?.focus()
    const onKey = event => {
      if (event.key === 'Escape' && !busyRef.current) cancelRef.current()
      if (event.key !== 'Tab') return
      const buttons = dialogRef.current?.querySelectorAll('button:not(:disabled)')
      if (!buttons?.length) { event.preventDefault(); return }
      const first = buttons[0], last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); previousFocus?.focus?.() }
  }, [])
  return createPortal(<div className="iw-modal-backdrop"><section className="iw-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="image-confirm-title">
    <span className="workspace-eyebrow">REVIEW GENERATION</span><h2 id="image-confirm-title">Generate {quote.outputCount} image{quote.outputCount === 1 ? '' : 's'}?</h2>
    <dl className="iw-quote-details"><div><dt>Model</dt><dd>{quote.modelLabel}</dd></div><div><dt>Image size</dt><dd>{quote.sizeLabel}</dd></div><div><dt>Output format</dt><dd>{quote.scene.outputFormat.toUpperCase()}</dd></div><div><dt>Outputs / Jobs</dt><dd>{quote.outputCount} images · {quote.outputCount} Jobs</dd></div><div><dt>Authorized attempts</dt><dd>{quote.attemptLimit} per Job</dd></div><div><dt>EUR reservation ceiling</dt><dd>{money(quote.totalMinor)}</dd></div></dl>
    <p className="iw-quote-note">Each image is a separate request. Positive fractional-cent prices are rounded up at the reservation boundary. This is a catalog estimate; final provider billing may differ.</p>
    <p className="iw-quote-note">Regenerating requires a new quote and confirmation. Existing images remain saved.</p>
    <div className="iw-modal-actions"><button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className="primary" disabled={busy || Date.now() >= quote.expiresAt} onClick={onConfirm}>{busy ? 'Starting…' : `Confirm generation · ${money(quote.totalMinor)}`}</button></div>
  </section></div>, document.body)
}

/** Parent navigation awaits ref.flushDraft(). Before a Creative is selected,
 * the unsaved brief remains in this mounted component; no dummy lineage exists.
 */
const ImageWorkspace = forwardRef(function ImageWorkspace({
  active = true, context = EMPTY_CONTEXT, onContextChange,
  onUseAsStartFrame, onAddToCanvas, onUseInStudio, onSaveToCreative,
}, ref) {
  const [options, setOptions] = useState(null)
  const [work, setWork] = useState(null)
  const [draft, setDraft] = useState(imageDraft)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [estimate, setEstimate] = useState(null)
  const [quote, setQuote] = useState(null)
  const [title, setTitle] = useState('')
  const state = useRef({ creativeId: '', work: null, draft: imageDraft(), dirty: false, editSequence: 0, newDraft: false })
  const savingRef = useRef(null), operationRef = useRef(null), optionsRef = useRef(null)
  const activeRef = useRef(active)
  activeRef.current = active
  const creativeId = String(context.creativeId || '')
  const productTestId = String(context.productTestId || '')
  const models = (options?.capabilities || options?.imageModels || []).filter(model => model.capability === 'generate_image' || Array.isArray(model.imageSizes))
  const availableModels = models.filter(usableModel)
  const model = models.find(item => item.provider === draft.provider && item.model === draft.model)
  const images = (work?.scenes || []).filter(isImage)
  const live = images.find(scene => scene.id === draft.id)
  const held = live?.status === 'Reconciliation required'
  const running = IN_FLIGHT.includes(live?.status) || IN_FLIGHT.includes(live?.displayStatus)
  const locked = busy || loading || running || held
  const currentProduct = options?.productTests?.find(item => String(item.id) === productTestId)
  const currentCreative = options?.creatives?.find(item => String(item.id) === creativeId)
  const selectedAsset = live?.media || null
  const size = model?.imageSizes?.find(item => item.id === draft.imageSize)
  const validSettings = Boolean(model && usableModel(model) && size && model.outputFormats?.includes(draft.outputFormat)
    && Number.isInteger(draft.quantity) && draft.quantity >= model.quantity.min && draft.quantity <= model.quantity.max)

  const assignDraft = (next, changed) => {
    state.current.draft = next
    state.current.dirty = changed
    state.current.editSequence++
    setDraft(next)
    setDirty(changed)
  }
  const accept = (workspace, sceneId = state.current.draft.id) => {
    if (String(workspace.creative.id) !== state.current.creativeId) return
    if (state.current.work && workspace.revision < state.current.work.revision) return
    state.current.work = workspace
    setWork(workspace)
    if (sceneId) state.current.newDraft = false
    if (state.current.newDraft) return
    const imageScenes = workspace.scenes.filter(isImage)
    const chosen = imageScenes.find(scene => scene.id === sceneId) || imageScenes[imageScenes.length - 1]
    if (chosen) assignDraft(imageDraft(chosen), false)
    else assignDraft({ ...state.current.draft, id: undefined }, false)
  }
  const edit = patch => {
    if (locked) return
    assignDraft({ ...state.current.draft, ...patch }, true)
    setQuote(null)
    setEstimate(null)
    setError('')
    setNotice('')
  }

  const saveOnce = () => {
    if (savingRef.current) return savingRef.current
    const snapshot = state.current
    if (!snapshot.dirty || !snapshot.creativeId || !snapshot.work) return Promise.resolve(snapshot.work)
    const savingCreative = snapshot.creativeId, sequence = snapshot.editSequence
    const savedDraft = { ...snapshot.draft }, currentWork = snapshot.work
    if (!savedDraft.id && currentWork.scenes.length >= 12) return Promise.reject(new Error('This Creative already has 12 scenes. Choose another Creative for a new image draft.'))
    const nextScenes = savedDraft.id ? currentWork.scenes.map(scene => scene.id === savedDraft.id ? savedDraft : scene) : [...currentWork.scenes, savedDraft]
    setSaving(true)
    const promise = request(`${savingCreative}/scenes`, { revision: currentWork.revision, scenes: nextScenes }).then(result => {
      if (state.current.creativeId !== savingCreative) return result.workspace
      const persisted = savedDraft.id ? result.workspace.scenes.find(scene => scene.id === savedDraft.id) : result.workspace.scenes[result.workspace.scenes.length - 1]
      state.current.work = result.workspace
      state.current.newDraft = false
      setWork(result.workspace)
      if (state.current.editSequence === sequence) assignDraft(imageDraft(persisted), false)
      else if (!state.current.draft.id) {
        const withId = { ...state.current.draft, id: persisted.id }
        state.current.draft = withId
        setDraft(withId)
      }
      return result.workspace
    }).finally(() => { savingRef.current = null; setSaving(false) })
    savingRef.current = promise
    return promise
  }
  const flushDraft = async () => {
    if (savingRef.current) await savingRef.current
    while (state.current.dirty && state.current.creativeId && state.current.work) await saveOnce()
    return state.current.work
  }
  useImperativeHandle(ref, () => ({
    flushDraft: async () => {
      const workspace = await flushDraft()
      setQuote(null)
      return workspace
    },
    hasUnsavedDraft: () => state.current.dirty,
  }), [])

  const act = fn => {
    if (operationRef.current) return operationRef.current
    setBusy(true)
    setError('')
    const promise = Promise.resolve().then(fn).catch(error => { setError(error?.message || 'The image action failed.'); setQuote(null) }).finally(() => { operationRef.current = null; setBusy(false) })
    operationRef.current = promise
    return promise
  }

  useEffect(() => {
    if (!active) { setQuote(null); return }
    const controller = new AbortController()
    request('options', undefined, controller.signal).then(result => {
      optionsRef.current = result
      setOptions(result)
      if (!state.current.draft.model) {
        const first = (result.capabilities || result.imageModels || []).find(item => item.capability === 'generate_image' && usableModel(item))
        if (first) assignDraft(defaultsForModel(first, state.current.draft), state.current.dirty)
      }
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [active])

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    const previous = state.current
    const keepUnlinkedDraft = !previous.creativeId && previous.dirty
    const unlinkedDraft = keepUnlinkedDraft ? { ...previous.draft, id: undefined } : null
    if (previous.creativeId !== creativeId) {
      state.current.creativeId = creativeId
      state.current.work = null
      state.current.newDraft = false
      setWork(null)
      setEstimate(null)
      setQuote(null)
      if (!keepUnlinkedDraft) {
        const defaultModel = (optionsRef.current?.capabilities || []).find(item => item.capability === 'generate_image' && usableModel(item))
        assignDraft(defaultModel ? defaultsForModel(defaultModel) : imageDraft(), false)
      }
    }
    if (!creativeId) { setLoading(false); return }
    if (state.current.dirty && state.current.work) return
    setLoading(true)
    request(creativeId, undefined, controller.signal).then(result => {
      if (controller.signal.aborted) return
      accept(result.workspace)
      if (unlinkedDraft) assignDraft(unlinkedDraft, true)
      setError('')
    }).catch(error => { if (!controller.signal.aborted) setError(error.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [active, creativeId])

  useEffect(() => {
    if (!active || !dirty || busy || saving || !work || !validSettings || error) return
    const timer = setTimeout(() => saveOnce().catch(error => setError(error.message)), 700)
    return () => clearTimeout(timer)
  }, [active, dirty, draft, busy, saving, work, validSettings, error])

  useEffect(() => {
    if (!active || !creativeId) return
    let disposed = false
    const timer = setInterval(async () => {
      if (state.current.dirty || savingRef.current || operationRef.current) return
      try {
        const result = await request(creativeId)
        if (disposed || state.current.dirty || savingRef.current || operationRef.current) return
        accept(result.workspace)
      } catch (error) { if (!disposed) setError(error.message) }
    }, 2500)
    return () => { disposed = true; clearInterval(timer) }
  }, [active, creativeId])

  useEffect(() => {
    if (!active || !creativeId || !draft.id || dirty || !work || !validSettings) { setEstimate(null); return }
    const controller = new AbortController()
    request(`${creativeId}/estimate`, { sceneIds: [draft.id] }, controller.signal).then(result => { if (!controller.signal.aborted) setEstimate(result) }).catch(error => {
      if (!controller.signal.aborted) setEstimate({ totalMinor: null, rows: [{ error: error.message }] })
    })
    return () => controller.abort()
  }, [active, creativeId, draft.id, dirty, work?.revision, validSettings])

  useEffect(() => {
    if (!quote) return
    const timer = setTimeout(() => { setQuote(null); setNotice('This quote expired. Generate requests a fresh estimate before confirmation.') }, Math.max(0, quote.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [quote])

  useEffect(() => {
    if (quote && work?.revision !== quote.revision) {
      setQuote(null)
      setNotice('This Creative changed. Request a fresh quote before generation.')
    }
  }, [work?.revision, quote])

  const changeContext = next => act(async () => {
    await flushDraft()
    setQuote(null)
    await onContextChange?.(next)
  })
  const createCreative = () => act(async () => {
    await flushDraft()
    const result = await request('creatives', { productTestId: Number(productTestId), angle: title.trim() })
    const refreshed = await request('options')
    optionsRef.current = refreshed
    setOptions(refreshed)
    setTitle('')
    await onContextChange?.({ productTestId, creativeId: String(result.creativeId) })
  })
  const chooseDraft = id => act(async () => {
    const workspace = await flushDraft()
    if (!workspace) return
    setQuote(null)
    setEstimate(null)
    if (id) accept(workspace, id)
    else {
      const selectedModel = model && usableModel(model) ? model : availableModels[0]
      state.current.newDraft = true
      assignDraft(selectedModel ? defaultsForModel(selectedModel) : imageDraft(), false)
    }
  })
  const changeModel = id => {
    const nextModel = models.find(item => item.id === id)
    if (!nextModel || !usableModel(nextModel)) return
    const next = defaultsForModel(nextModel, state.current.draft)
    const reset = next.imageSize !== draft.imageSize || next.outputFormat !== draft.outputFormat || next.quantity !== draft.quantity
    edit(next)
    if (reset) setNotice('Unsupported settings were reset for the selected model. A new quote is required.')
  }
  const askGenerate = () => act(async () => {
    const workspace = await flushDraft()
    const scene = workspace?.scenes.find(item => item.id === state.current.draft.id)
    if (!scene?.id || !scene.prompt.trim()) throw new Error('Choose a Creative and write an image prompt first.')
    const result = await request(`${creativeId}/quote`, { revision: workspace.revision, sceneIds: [scene.id] })
    accept(result.workspace, scene.id)
    if (!activeRef.current) return
    setQuote({ ...result.quote, scene: imageDraft(scene), modelLabel: model?.label || scene.model,
      sizeLabel: size ? `${size.width} × ${size.height} · ${size.aspect}` : scene.imageSize,
      outputCount: result.quote.outputCount ?? scene.quantity,
    })
  })
  const confirm = () => act(async () => {
    const confirmedQuote = quote
    if (!confirmedQuote) return
    setQuote(null)
    try {
      const result = await request(`${creativeId}/start`, { confirmed: true, token: confirmedQuote.token, revision: confirmedQuote.revision })
      const blocked = result.outcomes?.find(item => item.outcome !== 'started')
      if (blocked) throw new Error(blocked.reason || 'Generation could not start. Check its saved status.')
    } finally {
      const result = await request(creativeId)
      accept(result.workspace, confirmedQuote.scene.id)
    }
  })
  const selectOutput = (sceneId, asset) => act(async () => {
    const workspace = await flushDraft()
    const scene = workspace.scenes.find(item => item.id === sceneId)
    if (scene?.media?.id === asset.id) { accept(workspace, sceneId); return }
    const result = await request(`${creativeId}/result`, { revision: workspace.revision, sceneId, assetId: asset.id })
    accept(result.workspace, sceneId)
  })
  const transfer = callback => act(async () => { await flushDraft(); await callback(selectedAsset) })

  const outputRows = images.flatMap(scene => {
    const assets = scene.outputs?.length ? scene.outputs : scene.media ? [scene.media] : []
    return [...new Map(assets.map(asset=>[asset.id,asset])).values()].map(asset => ({ scene, asset }))
  })
  const estimateRow = estimate?.rows?.find(row => row.sceneId === draft.id) || estimate?.rows?.[0]
  const estimateError = estimateRow?.error
  const saveLabel = !creativeId ? 'Choose a Creative to save this draft' : saving ? 'Saving…' : dirty ? 'Unsaved edits' : draft.id ? 'Saved locally' : 'New draft'

  return <section className="image-workspace" data-testid="image-workspace" aria-busy={loading}>
    <header className="iw-header"><div><span className="workspace-eyebrow">CREATE SOMETHING NEW</span><h2>Image</h2></div><div className="iw-header-actions"><span className="iw-save-status" role="status">{saveLabel}</span><button type="button" className="ghost" disabled={busy || loading || !work || work.scenes.length >= 12} onClick={() => chooseDraft(null)}>New image draft</button></div></header>
    <details className="iw-context" open={!creativeId}>
      <summary>{currentProduct?.name || 'Choose a product'}<span>{currentCreative?.angle || 'Select a Creative before generation'}</span></summary>
      <div className="iw-context-fields"><label>Product Test<select aria-label="Image Product Test" value={productTestId} disabled={busy || loading || !onContextChange} onChange={event => changeContext({ productTestId: event.target.value, creativeId: '' })}><option value="">Choose a Product Test</option>{options?.productTests?.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Creative<select aria-label="Image Creative" value={creativeId} disabled={busy || loading || !productTestId || !onContextChange} onChange={event => changeContext({ productTestId, creativeId: event.target.value })}><option value="">Choose a Creative</option>{options?.creatives?.filter(item => String(item.product_test_id) === productTestId).map(item => <option key={item.id} value={item.id}>{item.angle}</option>)}</select></label><label>New Creative title<input aria-label="New image Creative title" placeholder="Product image concept" value={title} onChange={event => setTitle(event.target.value)} maxLength={300} /></label><button type="button" className="ghost" disabled={busy || !productTestId || !title.trim() || !onContextChange} onClick={createCreative}>Create Creative</button></div>
      {!options?.productTests?.length && options ? <p>Create a Product Test in Planning &amp; review to save and produce images. You can write your prompt below first.</p> : <p>The selected Creative supplies production lineage and its existing iteration budget.</p>}
    </details>
    {error ? <div className="iw-error" role="alert">{error}<button type="button" className="ghost small" disabled={busy || saving} onClick={() => act(async () => { await flushDraft(); if (creativeId) accept((await request(creativeId)).workspace) })}>Retry save / refresh</button></div> : null}
    {notice ? <p className="iw-notice" role="status">{notice}</p> : null}
    <div className="iw-media-area">
      {images.length ? <div className="iw-draft-history" aria-label="Image draft history">{images.map(scene => <button type="button" key={scene.id} className={scene.id === draft.id ? 'active' : ''} aria-pressed={scene.id === draft.id} disabled={busy || saving} onClick={() => chooseDraft(scene.id)}>{scene.name}<span>{scene.displayStatus || scene.status}</span></button>)}</div> : null}
      {outputRows.length ? <div className="iw-output-grid" aria-label="Generated images">{outputRows.map(({ scene, asset }) => <button type="button" key={`${scene.id}:${asset.id}`} className={`iw-output${scene.id === draft.id && selectedAsset?.id === asset.id ? ' selected' : ''}`} data-testid={`image-output-${asset.id}`} aria-pressed={scene.id === draft.id && selectedAsset?.id === asset.id} disabled={busy || IN_FLIGHT.includes(scene.status) || scene.status === 'Reconciliation required'} onClick={() => selectOutput(scene.id, asset)}><AssetPreview asset={asset} /><span className="iw-output-caption"><span>{scene.name}</span><span>{assetDimensions(asset)}{selectedAsset?.id === asset.id && scene.id === draft.id ? ' · Selected' : ''}</span></span></button>)}</div>
        : <div className="iw-empty"><div className="iw-empty-art" aria-hidden="true"><span /><span /><span /></div><h3>Your next image starts with an idea.</h3><p>Describe the subject, lighting and composition. Generate a single image or compare up to four outputs.</p><div className="iw-prompt-starters"><button type="button" disabled={locked} onClick={() => edit({ prompt: 'A minimal studio still life of an unbranded skincare bottle on warm stone, soft side lighting, natural shadows, generous negative space, editorial product photography.' })}>Studio still life</button><button type="button" disabled={locked} onClick={() => edit({ prompt: 'A cinematic unbranded product scene on a dark reflective surface, a narrow beam of warm light, realistic textures, precise composition, no text or logos.' })}>Cinematic product</button><button type="button" disabled={locked} onClick={() => edit({ prompt: 'An airy lifestyle photograph of an unbranded product on a sunny kitchen counter, linen and natural materials, realistic morning light, clean composition, no text.' })}>Lifestyle concept</button></div></div>}
      {selectedAsset ? <div className="iw-result-actions"><span>Asset #{selectedAsset.id}</span><button type="button" className="ghost" disabled={busy} onClick={() => transfer(downloadLocalAsset)}>Download image</button>{onUseAsStartFrame ? <button type="button" className="primary" disabled={busy} onClick={() => transfer(onUseAsStartFrame)}>Use as Start Frame</button> : null}{onAddToCanvas ? <button type="button" className="ghost" disabled={busy} onClick={() => transfer(onAddToCanvas)}>Add to Canvas</button> : null}{onUseInStudio ? <button type="button" className="ghost" disabled={busy} onClick={() => transfer(onUseInStudio)}>Use in Studio</button> : null}{onSaveToCreative ? <button type="button" className="ghost" disabled={busy} onClick={() => transfer(onSaveToCreative)}>Save to Creative</button> : null}</div> : null}
      {live?.history?.length ? <p className="iw-history-note">{live.history.length} previous generation{live.history.length === 1 ? '' : 's'} retained in this Creative’s history. Saved media remains available in Assets.</p> : null}
      {running ? <p className="iw-run-status" role="status"><span className="iw-status-dot" />{live.displayStatus || live.status} · You can leave this workspace and return to the saved run.</p> : null}
      {held ? <p className="iw-error" role="alert">Reconciliation required. Billing status is uncertain; the existing request and reservation must be checked before another generation.</p> : null}
      {live?.status === 'Failed' ? <p className="iw-error" role="alert">Generation failed. Review the saved error below; generating again requires a new quote.</p> : null}
      {live?.details && (held || live.status === 'Failed') ? <details className="iw-diagnostics"><summary>Saved generation details</summary><pre>{JSON.stringify({ jobs: live.details.run?.jobs?.map(job => ({ id: job.id, status: job.status, error: job.error_message })), attempts: live.details.attempts?.map(attempt => ({ request: attempt.external_request_id, status: attempt.provider_status, reconciliation: attempt.reconciliation_status })) }, null, 2)}</pre></details> : null}
    </div>
    <div className="iw-composer" data-testid="image-composer">
      <label className="iw-prompt-label" htmlFor="image-generation-prompt">Describe your image</label><textarea id="image-generation-prompt" aria-label="Image prompt" placeholder="A product close-up in soft morning light, with…" rows={3} maxLength={6000} value={draft.prompt} disabled={locked} onChange={event => edit({ prompt: event.target.value })} />
      <div className="iw-composer-controls"><div className="iw-settings"><label className="iw-model-picker">Model<select aria-label="Image model" value={model?.id || ''} disabled={locked || !availableModels.length} onChange={event => changeModel(event.target.value)}>{!model ? <option value="">{draft.model ? `${draft.model} · unavailable` : 'Choose a configured model'}</option> : null}{models.filter(item => usableModel(item) || item.id === model?.id).map(item => <option key={item.id} value={item.id} disabled={!usableModel(item)}>{item.label}{!usableModel(item) ? ' · unavailable' : ''}</option>)}</select></label><ModelSettings image model={model} value={draft} onChange={(key,value)=>edit({[key]:value})} disabled={locked} prefix="Image"/></div>
        <button type="button" className="primary iw-generate" disabled={locked || saving || !creativeId || !work || !draft.prompt.trim() || !validSettings} onClick={askGenerate}><span>{busy ? 'Working…' : running ? live.displayStatus || live.status : selectedAsset ? 'Regenerate' : 'Generate'}</span><small>{dirty || saving ? 'Quote before confirmation' : money(estimate?.totalMinor)}</small></button>
      </div>
      <div className="iw-composer-footnote"><span>Text-to-image · This model does not accept product/reference images.</span><span>{estimateRow?.sourceUsd != null ? `Provider estimate: $${Number(estimateRow.sourceUsd).toFixed(4)} USD · ` : ''}{estimateRow?.rounding || 'EUR quote includes conservative per-Job rounding.'}</span></div>
      {estimateError ? <p className="iw-price-warning" role="status">{estimateError}</p> : null}
      {!availableModels.length && options ? <p className="iw-price-warning">{options.imageUnavailableReason || 'No configured, priced image model is available. Check provider configuration in Settings.'}</p> : null}
      {!creativeId ? <p className="iw-price-warning">Your prompt is a draft. Select a Product Test and Creative above to save it and request a quote.</p> : null}
    </div>
    {quote && active ? <Confirmation quote={quote} busy={busy} onCancel={() => setQuote(null)} onConfirm={confirm} /> : null}
  </section>
})

export default ImageWorkspace
