import { useCallback, useEffect, useRef, useState } from 'react'
import { apiBase } from '../lib/ai/apiClient.js'
import { STUDIO_PRESETS, normalizeStudioProduction, proposeStudioScenes, importStudioScenes, buildStudioGenerationScene, studioSceneSignature, savedStudioGeneratorScene as savedScene, prepareStudioSceneSave, studioCanvasPayload, createStudioVariation } from '../lib/studioProductionModel.js'
import ModelSettings from './ModelSettings.jsx'
import './StudioWorkbench.css'

const money = value => value == null ? 'À estimer' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value / 100)
const mediaUrl = asset => `${apiBase()}${asset.relative_path === 'mock-video-output.mp4' ? '/' : '/media/'}${asset.relative_path.split('/').map(encodeURIComponent).join('/')}`
const running = scene => ['Queued', 'Generating', 'Reconciliation required'].includes(scene?.status)

async function request(path, body, signal) {
  const response = await fetch(`${apiBase()}/api/operator/generator/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal })
  const value = await response.json()
  if (!response.ok || value.ok === false) throw new Error(value.error || 'Le serveur local ne répond pas.')
  return value
}

function PresetArt({ preset, photo }) {
  return <span className={`sw-preset-art sw-art-${preset.tone}`} aria-hidden="true">{photo ? <img src={mediaUrl(photo)} alt="" /> : <svg viewBox="0 0 180 130"><ellipse cx="90" cy="108" rx="45" ry="9" fill="currentColor" opacity=".12"/><rect x="62" y="28" width="56" height="76" rx="9" fill="currentColor" opacity=".75"/><rect x="69" y="21" width="42" height="11" rx="4" fill="currentColor" opacity=".4"/><rect x="69" y="54" width="42" height="27" rx="2" fill="#131718" opacity=".8"/><path d="M78 64h24M78 71h15" stroke="currentColor" opacity=".45"/></svg>}<span>{String(preset.shots.length).padStart(2, '0')} plans</span></span>
}

function Confirmation({ quote, busy, onCancel, onConfirm }) {
  const ref = useRef(null)
  useEffect(() => {
    const previous = document.activeElement
    ref.current?.querySelector('button')?.focus()
    const keyboard = event => {
      if (event.key === 'Escape' && !busy) onCancel()
      if (event.key !== 'Tab') return
      const buttons = ref.current?.querySelectorAll('button:not(:disabled)')
      if (!buttons?.length) return
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1].focus() }
      else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0].focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); previous?.focus?.() }
  }, [busy, onCancel])
  return <div className="sw-modal-backdrop"><section className="sw-modal" ref={ref} role="dialog" aria-modal="true" aria-label="Confirmer la production Studio"><h3>Générer {quote.sceneIds.length} clip{quote.sceneIds.length > 1 ? 's' : ''} ?</h3><p className="sw-quote-total">{money(quote.totalMinor)}</p><p>{quote.label} · {quote.resolution} · {quote.aspectRatio} · audio {quote.audio ? 'activé' : 'désactivé'}</p><ul>{quote.scope.map(s => <li key={s.id}>{s.name} · 1 sortie · {s.seconds} s</li>)}</ul><p>Ce lot contient des scènes successives pour une seule publicité. Chaque régénération demande une nouvelle confirmation. Estimation catalogue, hors facture fournisseur vérifiée.</p><p>Les limites de tentatives et réservations du moteur de production restent applicables. Aucun nouvel essai payant n’est autorisé par un simple rafraîchissement.</p><div className="sw-actions"><button className="ghost" disabled={busy} onClick={onCancel}>Annuler</button><button className="primary" disabled={busy} onClick={onConfirm}>Confirmer la génération</button></div></section></div>
}

/** The parent owns the existing SQLite-backed Studio session. No production history lives in localStorage. */
export default function StudioWorkbench({ sessionId, studio, onUpdate, onCreateSession, onAdvanced, onSessions, productLibrary = [], context, onContextChange, onOpenCreative, onOpenCanvas, onCreateVariation }) {
  const [options, setOptions] = useState(null), [work, setWork] = useState(null), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [category, setCategory] = useState('Tous'), [selected, setSelected] = useState(0)
  const [quote, setQuote] = useState(null), [estimate, setEstimate] = useState(null), [variantTemplate, setVariantTemplate] = useState('single_hero')
  const [history, setHistory] = useState([]), [advanced, setAdvanced] = useState(false), [templatesOpen, setTemplatesOpen] = useState(false), [normalDuration, setNormalDuration] = useState(5)
  const cancelQuote = useCallback(() => setQuote(null), [])
  const lock = useRef(false), uploadRef = useRef(null), currentSession = useRef(sessionId), optionsSequence = useRef(0)
  currentSession.current = sessionId
  const production = normalizeStudioProduction(studio.production), scenes = production.scenes
  const models = (options?.capabilities || []).filter(c => c.capability === (production.mediaKind === 'image' ? 'generate_image' : 'generate_video') && c.configured && c.priced)
  const model = models.find(c => c.id === production.modelId) || (!production.modelId ? models[0] : null)
  const productTestId = production.productTestId || context?.productTestId || null
  const creativeId = production.creativeId || (production.newCreative ? null : context?.creativeId || options?.creatives.find(c => c.marketing_studio_session_id === sessionId)?.id) || null
  const photo = options?.media.find(a => a.id === production.productAssetId)
  const activeScene = scenes[Math.min(selected, Math.max(0, scenes.length - 1))]
  const liveScene = activeScene && work?.scenes.find(s => s.id === production.sceneLinks[activeScene.id])
  const historyKey = JSON.stringify(liveScene?.history || [])
  let previewMatchesDraft = false
  try { previewMatchesDraft = Boolean(liveScene && liveScene.current && studioSceneSignature(liveScene) === studioSceneSignature(buildStudioGenerationScene(activeScene, studio, model))) } catch { /* Invalid or incomplete drafts keep old previews visible without approval. */ }
  const inputKeyFor = (draftScenes = scenes) => JSON.stringify({ product: studio.product, brief: studio.brief, ...production, creativeId: null, productTestId: null, newCreative: false, scenes: draftScenes, sceneLinks: {} })
  const inputKey = inputKeyFor()
  const hasRunning = work?.scenes.some(running)
  const readonly = busy || Boolean(quote)
  const update = fn => { setQuote(null); setEstimate(null); setError(''); onUpdate(fn) }
  const patch = values => update(s => ({ ...s, production: { ...normalizeStudioProduction(s.production), ...values } }))
  const patchScene = values => patch({ scenes: scenes.map(s => s.id === activeScene.id ? { ...s, ...values } : s) })
  const refreshOptions = async signal => { const seq = ++optionsSequence.current; const result = await request('options', undefined, signal); if (seq === optionsSequence.current) setOptions(result); return result }
  const act = async fn => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message); setQuote(null) } finally { lock.current = false; setBusy(false) }
  }

  useEffect(() => { const controller = new AbortController(); refreshOptions(controller.signal).catch(e => { if (e.name !== 'AbortError') setError(e.message) }); return () => controller.abort() }, [])
  useEffect(() => { if (!sessionId && onCreateSession && !lock.current) onCreateSession(studio) }, [sessionId])
  useEffect(() => { setQuote(null); setEstimate(null); setSelected(0); setNotice(''); setError('') }, [sessionId])
  useEffect(() => { if (sessionId && model && !production.modelId) onUpdate(s => ({ ...s, production: { ...normalizeStudioProduction(s.production), modelId: normalizeStudioProduction(s.production).modelId || model.id } })) }, [sessionId, model?.id])
  useEffect(() => { if (quote && quote.inputKey !== inputKey) setQuote(null) }, [inputKey, quote])
  useEffect(() => {
    const controller = new AbortController(); setWork(null)
    if (!creativeId) return () => controller.abort()
    const load = async () => { if (lock.current) return; try { const result = await request(String(creativeId), undefined, controller.signal); if (!controller.signal.aborted) setWork(result.workspace) } catch (e) { if (e.name !== 'AbortError') setError(e.message) } }
    load(); const timer = setInterval(load, 2500)
    return () => { controller.abort(); clearInterval(timer) }
  }, [creativeId, sessionId])
  useEffect(() => {
    const controller = new AbortController(); setHistory([])
    const entries = JSON.parse(historyKey)
    if (entries.length) Promise.all(entries.map(async (entry, index) => {
      if (entry.assetId) return { ...entry, asset: options?.media.find(a => a.id === entry.assetId), index }
      if (!entry.runId) return { ...entry, index }
      const response = await fetch(`${apiBase()}/api/operator/runs/${entry.runId}`, { signal: controller.signal })
      if (!response.ok) return { ...entry, index }
      const result = await response.json(); return { ...entry, asset: result.finalAsset, index }
    })).then(entries => { if (!controller.signal.aborted) setHistory(entries) }).catch(e => { if (e.name !== 'AbortError') setNotice('Certaines versions précédentes sont indisponibles. Consultez le Creative pour les détails.') })
    return () => controller.abort()
  }, [historyKey, liveScene?.id])

  function chooseModel(id) {
    const next = models.find(m => m.id === id)
    if (!next) return
    if (production.mediaKind === 'image') {
      patch({ modelId: id, imageSize: next.imageSizes?.some(size => size.id === production.imageSize) ? production.imageSize : next.imageSizes?.[0]?.id || 'square_hd', outputFormat: next.outputFormats?.includes(production.outputFormat) ? production.outputFormat : next.outputFormats?.[0] || 'png', quantity: Math.max(next.quantity?.min || 1, Math.min(next.quantity?.max || 4, production.quantity || 1)), productAssetId: null })
      setNotice('')
      return
    }
    const reset = !next.aspects.includes(production.aspectRatio) || !next.resolutions.includes(production.resolution) || scenes.some(s => !next.durations.includes(s.seconds)) || (production.generateAudio && !next.audio)
    patch({ modelId: id, aspectRatio: next.aspects.includes(production.aspectRatio) ? production.aspectRatio : next.aspects[0], resolution: next.resolutions.includes(production.resolution) ? production.resolution : next.resolutions[0], generateAudio: Boolean(production.generateAudio && next.audio), scenes: scenes.map(s => ({ ...s, seconds: next.durations.includes(s.seconds) ? s.seconds : next.durations[0] })) })
    setNotice(advanced ? (reset ? 'Les réglages incompatibles ont été adaptés au modèle. Les scripts et la photo sont conservés; une nouvelle estimation est nécessaire.' : 'Modèle modifié. Une nouvelle estimation est nécessaire.') : '')
  }

  function chooseMediaKind(mediaKind) {
    const next = (options?.capabilities || []).find(c => c.capability === (mediaKind === 'image' ? 'generate_image' : 'generate_video') && c.configured && c.priced)
    patch({ mediaKind, modelId: next?.id || '', sceneLinks: {}, ...(mediaKind === 'image' ? { productAssetId: null } : {}) })
  }

  async function ensureSaved() {
    if (!sessionId) throw new Error('Studio draft is still preparing. Try again in a moment.')
    const draftScenes = draftScenesForPrompt()
    if (production.productAssetId && !photo) throw new Error('La photo produit est introuvable dans les médias locaux. Sélectionnez-la à nouveau.')
    const source = { ...studio, production: { ...production, modelId: model?.id || production.modelId, scenes: draftScenes } }
    const compiled = draftScenes.map(s => buildStudioGenerationScene(s, source, model))
    let id = creativeId
    let linkedProductId = productTestId || production.productTestId
    if (!id) {
      if (!linkedProductId) {
        const result = await request('quick-creative', { workspace: 'studio', title: 'Quick Studio draft' })
        linkedProductId = result.productTestId
        id = result.creativeId
      } else {
        const result = await request('creatives', { productTestId: Number(linkedProductId), angle: `${studio.product.name || 'Studio prompt'} · ${STUDIO_PRESETS.find(t => t.id === production.templateId)?.name || 'Studio'}`, marketingStudioSessionId: sessionId })
        id = result.creativeId
      }
      if (currentSession.current !== sessionId) throw new Error('La session a changé. Le nouveau Creative reste disponible dans la liste.')
      onUpdate(s => ({ ...s, production: { ...normalizeStudioProduction(s.production), creativeId: Number(id), newCreative: false, productTestId: Number(linkedProductId), scenes: draftScenes, sceneLinks: {} } }))
      onContextChange?.({ productTestId: Number(linkedProductId), creativeId: Number(id) })
    }
    const loaded = (await request(String(id))).workspace
    const prepared = prepareStudioSceneSave(loaded, draftScenes, compiled, production.creativeId === Number(id) || !production.creativeId ? production.sceneLinks : {})
    const saved = prepared.changed ? (await request(`${id}/scenes`, { revision: loaded.revision, scenes: prepared.scenes.map(savedScene) })).workspace : loaded
    if (currentSession.current !== sessionId) throw new Error('La session a changé. La préparation est enregistrée; rouvrez son Creative.')
    const sceneLinks = Object.fromEntries(draftScenes.map((s, i) => [s.id, saved.scenes[prepared.indices[i]].id]))
    onUpdate(s => ({ ...s, production: { ...normalizeStudioProduction(s.production), creativeId: Number(id), productTestId: linkedProductId || production.productTestId, scenes: draftScenes, sceneLinks } }))
    onContextChange?.({ productTestId: linkedProductId || production.productTestId, creativeId: Number(id) })
    setWork(saved)
    return { id, workspace: saved, sceneLinks, draftScenes }
  }
  const prepareQuote = selectedDraftId => act(async () => {
    const result = await ensureSaved()
    const scope = result.draftScenes.filter(s => !selectedDraftId || s.id === selectedDraftId).map(s => result.workspace.scenes.find(v => v.id === result.sceneLinks[s.id])).filter(s => s && (selectedDraftId || !(s.status === 'Complete' && s.current)))
    if (!scope.length) { setNotice('Toutes les scènes actuelles sont terminées. Régénérer un clip demande une nouvelle confirmation.'); return }
    const response = await request(`${result.id}/quote`, { revision: result.workspace.revision, sceneIds: scope.map(s => s.id) })
    setWork(response.workspace); setEstimate(response.quote.totalMinor)
    setQuote({ ...response.quote, creativeId: result.id, inputKey: inputKeyFor(result.draftScenes), scope, label: model.label, resolution: production.resolution, aspectRatio: production.aspectRatio, audio: production.generateAudio })
  })
  const confirm = () => act(async () => {
    const approvedQuote = quote; setQuote(null)
    if (!approvedQuote || approvedQuote.inputKey !== inputKey) throw new Error('Les réglages ont changé. Demandez une nouvelle estimation.')
    try {
      const result = await request(`${approvedQuote.creativeId}/start`, { confirmed: true, token: approvedQuote.token, revision: approvedQuote.revision })
      const blocked = result.outcomes?.find(o => o.outcome !== 'started')
      if (blocked) throw new Error(blocked.reason || 'La production est bloquée. Vérifiez le statut du Creative.')
    } finally { setWork((await request(String(approvedQuote.creativeId))).workspace) }
  })
  const upload = file => act(async () => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size >= 30 * 1024 * 1024) throw new Error('Choisissez une image PNG, JPEG ou WebP de moins de 30 Mo.')
    const response = await fetch(`${apiBase()}/api/operator/references/upload`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Import de la photo impossible.')
    const validation = await fetch(`${apiBase()}/api/operator/references/validate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assetId: result.asset.id, kind: 'image' }) })
    if (!validation.ok) throw new Error((await validation.json()).error || 'Image non valide.')
    await refreshOptions(); patch({ productAssetId: result.asset.id }); setNotice('Photo enregistrée localement et utilisée comme première image de chaque clip.')
  })
  const transfer = callback => act(async () => { const result = await ensureSaved(); callback?.({ ...studioCanvasPayload({ ...studio, production: { ...production, creativeId: result.id, sceneLinks: result.sceneLinks } }, result.workspace.scenes, model), sessionId }) })
  const download = asset => act(async () => { const response = await fetch(mediaUrl(asset)); if (!response.ok) throw new Error('Le fichier local est introuvable.'); const objectUrl = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = objectUrl; link.download = asset.relative_path.split('/').pop(); link.click(); setTimeout(() => URL.revokeObjectURL(objectUrl), 1000) })
  const newCleanDraft = () => { setWork(null); setHistory([]); setNotice(''); update(s => {
    const imageModel = (options?.capabilities || []).find(c => c.capability === 'generate_image' && c.configured && c.priced)
    return { ...s, product: { ...s.product, name: '', description: '', claimBoundary: '' }, brief: { ...s.brief, hook: '', language: 'fr' }, production: { ...normalizeStudioProduction({}), mediaKind: 'image', modelId: imageModel?.id || '' } }
  }) }

  const shouldPlanScenes = prompt => production.mediaKind === 'video' && /\b(before|demo|demonstrate|after|hook|cta|ugc|ad|scenes?|plans?|15|20|30|avant|démonstration|après|publicit)/i.test(prompt || '')
  const draftScenesForPrompt = () => {
    if (scenes.length) return scenes
    const prompt = studio.brief.hook.trim()
    if (shouldPlanScenes(prompt)) {
      const seconds = model?.durations?.includes(normalDuration) ? normalDuration : model?.durations?.[0] || 5
      return [
        { id: `prompt-${Date.now()}-1`, name: 'Hook', visualDescription: `${prompt}\n\nScene 1: open with the hook and setup.`, script: '', scriptLocked: false, seconds },
        { id: `prompt-${Date.now()}-2`, name: 'Demo', visualDescription: `${prompt}\n\nScene 2: demonstrate the product or main action naturally.`, script: '', scriptLocked: false, seconds },
        { id: `prompt-${Date.now()}-3`, name: 'Result', visualDescription: `${prompt}\n\nScene 3: finish with the outcome and a clear final frame.`, script: '', scriptLocked: false, seconds },
      ]
    }
    return [{ id: `prompt-${Date.now()}`, name: production.mediaKind === 'image' ? 'Image concept' : 'Single clip', visualDescription: prompt, script: '', scriptLocked: false, seconds: model?.durations?.includes(normalDuration) ? normalDuration : model?.durations?.[0] || 5 }]
  }
  const normalOutputs = Array.from(new Map((work?.scenes || []).flatMap(scene => [...(scene.outputs || []), ...(scene.media ? [scene.media] : []), ...(scene.historyOutputs || [])]).filter(Boolean).map(asset => [asset.id, asset])).values())

  if (!advanced) return <section className="studio-workbench sw-simple" data-testid="studio-workbench">
    <header className="sw-simple-header"><div><span className="sw-eyebrow">MARKETING STUDIO</span><h2>Marketing Studio</h2></div><div className="sw-actions"><button className="ghost" onClick={newCleanDraft}>New</button>{onSessions && <button className="ghost" onClick={onSessions}>History</button>}<button className="ghost" onClick={() => setTemplatesOpen(true)}>Templates</button><button className="ghost" onClick={() => setAdvanced(true)}>Advanced Studio</button>{onAdvanced && <button className="ghost small" onClick={onAdvanced}>Formats</button>}</div></header>
    {error && <div className="sw-message sw-error" role="alert">{error}<button className="ghost small" disabled={busy} onClick={() => act(refreshOptions)}>Refresh configuration</button></div>}
    {notice && <p className="sw-message" role="status">{notice}</p>}
    <input ref={uploadRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={e => { upload(e.target.files[0]); e.target.value = '' }} />
    <main className="sw-simple-stage" aria-label="Studio results">
      {normalOutputs.length ? <div className="sw-simple-gallery">{normalOutputs.map(asset => <article key={asset.id} className="sw-simple-card">{/^image\//.test(asset.mime_type || '') ? <img src={mediaUrl(asset)} alt="Studio generated result" /> : <video src={mediaUrl(asset)} controls playsInline preload="metadata" />}<footer><span>Asset #{asset.id}</span><button className="ghost small" disabled={busy} onClick={() => download(asset)}>Download</button></footer></article>)}</div> : <div className="sw-simple-empty"><strong>What do you want to create?</strong><p>Attach optional references, describe the marketing creative, choose Image or Video, then generate.</p>{photo && <span className="sw-reference-pill"><img src={mediaUrl(photo)} alt="Attached product reference"/>Product reference <button type="button" className="ghost small" disabled={readonly} onClick={() => patch({ productAssetId: null })}>×</button></span>}</div>}
    </main>
    <section className="sw-simple-composer" aria-label="Studio prompt composer">
      <div className="sw-attach-row"><details><summary aria-label="Add Studio attachment">+</summary><div className="sw-attach-menu"><button className="ghost small" type="button" disabled={!sessionId || readonly} onClick={() => uploadRef.current?.click()}>Upload image</button><button className="ghost small" type="button" disabled title="Video references are handled in Remix for now.">Upload video</button><button className="ghost small" type="button" disabled title="Audio references are not supported by the current Studio provider path.">Upload audio</button><label>Choose from Assets<select aria-label="Photo produit Studio" disabled={!sessionId || readonly || production.mediaKind === 'image'} value={production.productAssetId || ''} onChange={e => patch({ productAssetId: Number(e.target.value) || null })}><option value="">No product reference</option>{options?.media.filter(a => a.mime_type.startsWith('image/')).map(a => <option key={a.id} value={a.id}>{a.relative_path.split('/').pop()}</option>)}</select></label><details><summary>Link Product / Project</summary><label>Product Test<select aria-label="Product Test Studio" disabled={readonly} value={productTestId || ''} onChange={e => { const id = Number(e.target.value) || null; patch({ productTestId: id, creativeId: null, newCreative: true, sceneLinks: {} }); onContextChange?.({ productTestId: id, creativeId: null }) }}><option value="">No Product Test</option>{options?.productTests.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Creative<select aria-label="Creative Studio" disabled={readonly} value={creativeId || ''} onChange={e => { const id = Number(e.target.value) || null; patch({ creativeId: id, newCreative: !id, sceneLinks: {} }); onContextChange?.({ productTestId, creativeId: id }) }}><option value="">No linked Creative</option>{options?.creatives.filter(c => !productTestId || c.product_test_id === Number(productTestId)).map(c => <option key={c.id} value={c.id}>{c.angle}</option>)}</select></label></details></div></details>{photo ? <span className="sw-reference-pill"><img src={mediaUrl(photo)} alt="Attached product reference"/>Product <button type="button" className="ghost small" disabled={readonly} onClick={() => patch({ productAssetId: null })}>×</button></span> : null}</div>
      <label className="sw-simple-prompt">Describe the marketing creative you want<textarea aria-label="Brief créatif Studio" rows={3} disabled={!sessionId || readonly} maxLength={1200} value={studio.brief.hook} onChange={e => update(s => ({ ...s, brief: { ...s.brief, hook: e.target.value } }))} placeholder="Create a premium product hero image on a clean bathroom counter." /></label>
      <div className="sw-simple-controls"><div className="sw-settings"><label>Image / Video<select aria-label="Studio media type" disabled={readonly} value={production.mediaKind} onChange={e => chooseMediaKind(e.target.value)}><option value="image">Image</option><option value="video">Video</option></select></label><label>Model<select aria-label="Modèle Studio" disabled={readonly || !models.length} value={model?.id || ''} onChange={e => chooseModel(e.target.value)}>{!model && <option value="">No configured model</option>}{models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>{production.mediaKind === 'image' ? <ModelSettings image model={model} value={production} onChange={(key,value)=>patch({[key]:value})} disabled={readonly} prefix="Studio"/> : <><label>Aspect<select aria-label="Format Studio" disabled={readonly || !model} value={production.aspectRatio} onChange={e => patch({ aspectRatio: e.target.value })}>{!model?.aspects.includes(production.aspectRatio) && <option>{production.aspectRatio}</option>}{model?.aspects.map(a => <option key={a}>{a}</option>)}</select></label><label>Resolution<select aria-label="Résolution Studio" disabled={readonly || !model} value={production.resolution} onChange={e => patch({ resolution: e.target.value })}>{!model?.resolutions.includes(production.resolution) && <option>{production.resolution}</option>}{model?.resolutions.map(r => <option key={r}>{r}</option>)}</select></label><label>Duration<select aria-label="Durée du plan Studio" disabled={readonly || !model} value={model?.durations?.includes(activeScene?.seconds) ? activeScene.seconds : normalDuration} onChange={e => { const seconds = Number(e.target.value); setNormalDuration(seconds); if (scenes.length) patch({ scenes: scenes.map((s, i) => i === selected ? { ...s, seconds } : s) }) }}>{(model?.durations || [5]).map(s => <option key={s} value={s}>{s}s</option>)}</select></label><label className="sw-check"><input type="checkbox" checked={production.generateAudio} disabled={readonly || !model?.audio} onChange={e => patch({ generateAudio: e.target.checked })} />Audio</label></>}</div><button className="primary sw-generate" disabled={!sessionId || readonly || !model || !studio.brief.hook.trim() || hasRunning} onClick={() => prepareQuote()}>{production.mediaKind === 'image' ? 'Generate image' : 'Generate'} <span>{money(estimate)}</span></button></div>
    </section>
    {templatesOpen && <div className="sw-modal-backdrop"><section className="sw-modal sw-template-modal" role="dialog" aria-modal="true" aria-label="Studio Templates"><div className="sw-gallery-heading"><h3>Templates</h3><button className="ghost small" onClick={() => setTemplatesOpen(false)}>Close</button></div><p className="sw-small">Optional prompt shortcuts. They do not switch Studio back to the legacy workflow.</p><div className="sw-filters" aria-label="Catégories de presets">{['Tous', 'Produit', 'Lifestyle', 'Court'].map(c => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div><div className="sw-presets">{STUDIO_PRESETS.filter(p => category === 'Tous' || p.category === category).map(p => <button key={p.id} className={`sw-preset${production.templateId === p.id ? ' selected' : ''}`} onClick={() => { const proposed = proposeStudioScenes(p.id, studio.brief.language); update(s => ({ ...s, brief: { ...s.brief, hook: s.brief.hook || `${p.name}: ${p.description}` }, production: { ...normalizeStudioProduction(s.production), templateId: p.id, scenes: [] } })); setTemplatesOpen(false); setNotice('Template added as prompt inspiration. Generate to create media or a scene plan.') }}><PresetArt preset={p} photo={photo} /><strong>{p.name}</strong><small>{p.description}</small></button>)}</div></section></div>}
    {quote && <Confirmation quote={quote} busy={busy} onCancel={cancelQuote} onConfirm={confirm} />}
  </section>

  return <section className="studio-workbench sw-advanced" data-testid="studio-workbench">
    <header className="sw-header"><div><span className="sw-eyebrow">ADVANCED STUDIO</span><h2>Advanced Studio</h2></div><div className="sw-actions"><button className="ghost" onClick={() => setAdvanced(false)}>Back to normal Studio</button>{onSessions && <button className="ghost" onClick={onSessions}>Sessions</button>}<button className="ghost" onClick={onAdvanced}>Advanced · formats & exports</button></div></header>
    {error && <div className="sw-message sw-error" role="alert">{error}<button className="ghost small" disabled={busy} onClick={() => act(refreshOptions)}>Actualiser la configuration</button></div>}
    {notice && <p className="sw-message" role="status">{notice}</p>}
    {!sessionId ? <div className="sw-start"><h3>Du produit à des clips prêts à utiliser.</h3><p>Une proposition locale, vos scènes éditables, puis une confirmation du coût avant la génération.</p><button className="primary" onClick={() => onCreateSession?.(studio)}>Créer un brouillon Studio</button></div> : null}
    <div className="sw-layout"><aside className="sw-product"><div className="sw-product-photo">{photo ? <img src={mediaUrl(photo)} alt={`Photo de ${studio.product.name || 'votre produit'}`} /> : <div><span>Votre produit</span><small>Ajoutez sa photo</small></div>}<button className="ghost small" disabled={!sessionId || readonly} onClick={() => uploadRef.current?.click()}>Importer une photo</button><input ref={uploadRef} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={e => { upload(e.target.files[0]); e.target.value = '' }} /></div>
      <label>Photo de la médiathèque<select aria-label="Photo produit Studio" disabled={!sessionId || readonly} value={production.productAssetId || ''} onChange={e => patch({ productAssetId: Number(e.target.value) || null })}><option value="">Sans référence produit</option>{options?.media.filter(a => a.mime_type.startsWith('image/')).map(a => <option key={a.id} value={a.id}>{a.relative_path.split('/').pop()}</option>)}</select></label>
      {productLibrary.length > 0 && <label>Mes produits<select aria-label="Produit de la bibliothèque Studio" disabled={!sessionId || readonly} value="" onChange={e => { const entry = productLibrary.find(p => p.id === e.target.value); if (entry) update(s => ({ ...s, product: { ...s.product, ...entry.product } })) }}><option value="">Choisir un produit enregistré</option>{productLibrary.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <label>Nom du produit<input aria-label="Nom du produit Studio" maxLength={200} disabled={!sessionId || readonly} value={studio.product.name} onChange={e => update(s => ({ ...s, product: { ...s.product, name: e.target.value } }))} placeholder="Votre produit" /></label>
      <label>Faits produit<textarea aria-label="Faits produit Studio" rows={3} maxLength={1600} disabled={!sessionId || readonly} value={studio.product.description} onChange={e => update(s => ({ ...s, product: { ...s.product, description: e.target.value } }))} placeholder="Ce que c’est, ses caractéristiques vérifiées." /></label>
      <label>Langue du script<select disabled={!sessionId || readonly} value={studio.brief.language} onChange={e => update(s => ({ ...s, brief: { ...s.brief, language: e.target.value } }))}><option value="fr">Français</option><option value="en">English</option></select></label>
      <p className="sw-small">{photo ? 'La photo sert de première image. Le rendu et la fidélité du produit restent à vérifier.' : 'Sans photo, vous créez une direction visuelle; l’identité exacte du produit ne peut pas être garantie.'}</p>
      <details className="sw-context" open={!productTestId}><summary>Contexte de production</summary>
        <label>Product Test<select aria-label="Product Test Studio" disabled={readonly} value={productTestId || ''} onChange={e => { const id = Number(e.target.value) || null; patch({ productTestId: id, creativeId: null, newCreative: true, sceneLinks: {} }); onContextChange?.({ productTestId: id, creativeId: null }) }}><option value="">Choisir avant de générer</option>{options?.productTests.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label>Creative<select aria-label="Creative Studio" disabled={readonly} value={creativeId || ''} onChange={e => { const id = Number(e.target.value) || null; patch({ creativeId: id, newCreative: !id, sceneLinks: {} }); onContextChange?.({ productTestId, creativeId: id }) }}><option value="">Nouveau Creative à la préparation</option>{options?.creatives.filter(c => !productTestId || c.product_test_id === Number(productTestId)).map(c => <option key={c.id} value={c.id}>{c.angle}</option>)}</select></label>
        <p className="sw-small">Le brouillon est gratuit. Les budgets existants du Product Test s’appliquent à toute production.</p>
      </details>
    </aside><main className="sw-main">
      <details className="sw-template-drawer"><summary>Templates</summary><div className="sw-gallery-heading"><h3>Optional inspiration</h3><div className="sw-filters" aria-label="Catégories de presets">{['Tous', 'Produit', 'Lifestyle', 'Court'].map(c => <button key={c} aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}</div></div>
      <div className="sw-presets">{STUDIO_PRESETS.filter(p => category === 'Tous' || p.category === category).map(p => <button key={p.id} className={`sw-preset${production.templateId === p.id ? ' selected' : ''}`} aria-pressed={production.templateId === p.id} disabled={readonly || !sessionId} onClick={() => { patch({ templateId: p.id, ...(!scenes.length ? { scenes: proposeStudioScenes(p.id, studio.brief.language) } : {}) }); if (scenes.length) setNotice('Direction selected. Existing scenes are preserved. Create a variation for a new proposal.') }}><PresetArt preset={p} photo={photo} /><strong>{p.name}</strong><small>{p.description}</small></button>)}</div></details>
      <div className="sw-scene-toolbar"><h3>{scenes.length ? `${scenes.length} scènes · ${scenes.reduce((n, s) => n + s.seconds, 0)} s` : 'Votre proposition'}</h3><div className="sw-actions">{!scenes.length && <button className="ghost" disabled={!sessionId || readonly} onClick={() => patch({ scenes: proposeStudioScenes(production.templateId, studio.brief.language) })}>Proposer les scènes</button>}{!scenes.length && studio.scenes?.length > 0 && <button className="ghost" disabled={readonly} onClick={() => patch({ scenes: importStudioScenes(studio.scenes) })}>Importer les scènes du wizard</button>}<button className="ghost small" disabled={!sessionId || readonly || scenes.length >= 12} onClick={() => { patch({ scenes: [...scenes, { id: `manual-${Date.now()}`, name: `Scène ${scenes.length + 1}`, visualDescription: '', script: '', scriptLocked: false, seconds: model?.durations.includes(5) ? 5 : model?.durations[0] || 5 }] }); setSelected(scenes.length) }}>Ajouter un plan</button></div></div>
      <div className="sw-scene-strip">{scenes.map((s, i) => { const live = work?.scenes.find(v => v.id === production.sceneLinks[s.id]); return <button key={s.id} aria-pressed={selected === i} onClick={() => setSelected(i)}><span>{String(i + 1).padStart(2, '0')}</span><strong>{s.name}</strong><small>{s.seconds} s · {live?.displayStatus || live?.status || 'Brouillon'}</small></button> })}</div>
      <div className="sw-concept"><div className="sw-preview">{liveScene?.media ? (/^image\//.test(liveScene.media.mime_type || '') ? <img key={liveScene.media.id} src={mediaUrl(liveScene.media)} alt="Studio generated result" onError={() => setError('Le média local est introuvable ou ne peut pas être lu. Rechargez la médiathèque avant une nouvelle génération.')} /> : <video key={liveScene.media.id} src={mediaUrl(liveScene.media)} controls playsInline preload="metadata" onError={() => setError('La vidéo locale est introuvable ou ne peut pas être lue. Rechargez la médiathèque avant une nouvelle génération.')} />) : photo ? <img src={mediaUrl(photo)} alt="Référence produit du concept" /> : <div className="sw-preview-empty"><PresetArt preset={STUDIO_PRESETS.find(p => p.id === production.templateId) || STUDIO_PRESETS[0]} /><strong>Un espace pour votre prochaine publicité.</strong><p>Vos résultats apparaissent ici après confirmation et génération.</p></div>}{liveScene && <span className="sw-preview-status" role="status">{liveScene.displayStatus || liveScene.status}{liveScene.approved ? ' · Approuvée' : ''}</span>}</div>
        <div className="sw-scene-editor">{activeScene ? <><label>Nom du plan<input aria-label="Nom du plan Studio" disabled={readonly} value={activeScene.name} maxLength={150} onChange={e => patchScene({ name: e.target.value })} /></label><label>Instruction visuelle<textarea aria-label="Instruction visuelle Studio" rows={5} maxLength={2200} disabled={readonly} value={activeScene.visualDescription} onChange={e => patchScene({ visualDescription: e.target.value })} /></label><label>Script exact · facultatif<textarea aria-label="Script exact Studio" rows={4} maxLength={2500} disabled={readonly || activeScene.scriptLocked} value={activeScene.script} onChange={e => patchScene({ script: e.target.value })} placeholder="Vos mots, conservés sans réécriture." /></label><label className="sw-check"><input type="checkbox" checked={activeScene.scriptLocked} disabled={readonly} onChange={e => patchScene({ scriptLocked: e.target.checked })} />Verrouiller ce script</label><p className="sw-small">{production.generateAudio ? 'Le script est transmis tel quel au modèle. Vérifiez la prononciation et le rendu.' : 'Audio désactivé : le script reste dans le brouillon pour les sous-titres ou une voix ajoutée ensuite.'}</p><label>Durée du plan<select aria-label="Durée du plan Studio" disabled={readonly || !model} value={activeScene.seconds} onChange={e => patchScene({ seconds: Number(e.target.value) })}>{!model?.durations.includes(activeScene.seconds) && <option value={activeScene.seconds}>{activeScene.seconds} s · non pris en charge</option>}{model?.durations.map(s => <option key={s} value={s}>{s} s</option>)}</select></label></> : <p>Sélectionnez une direction pour proposer des scènes locales, gratuites et éditables.</p>}</div></div>
      {liveScene?.media && <div className="sw-actions sw-result-actions"><button className="ghost" disabled={busy} onClick={() => download(liveScene.media)}>Télécharger le clip</button><button className="ghost" disabled={readonly || !previewMatchesDraft || running(liveScene) || liveScene.approved} onClick={() => act(async () => { const latest = (await request(String(creativeId))).workspace; setWork((await request(`${creativeId}/result`, { revision: latest.revision, sceneId: liveScene.id, approved: true })).workspace) })}>{liveScene.approved ? 'Scène approuvée' : 'Approuver la scène'}</button><button className="ghost" disabled={readonly || running(liveScene)} onClick={() => prepareQuote(activeScene.id)}>Régénérer ce clip</button><span className="sw-small">{liveScene.history?.length || 0} version(s) précédentes conservées dans le Creative.</span></div>}
      {liveScene?.status === 'Reconciliation required' && <p className="sw-message sw-error" role="alert">Facturation incertaine. Le résultat précédent nécessite une réconciliation; aucun nouvel envoi automatique.</p>}
      {history.length > 0 && <details className="sw-history"><summary>Historique de ce plan · {history.length} version(s)</summary><div>{history.map(entry => <article key={`${entry.runId || entry.assetId}-${entry.index}`}><strong>Version {entry.index + 1}</strong>{entry.asset ? <><video src={mediaUrl(entry.asset)} controls playsInline preload="none" /><button className="ghost small" disabled={busy} onClick={() => download(entry.asset)}>Télécharger cette version</button></> : <p className="sw-small">{entry.runId ? `Production ${entry.runId}` : 'Asset précédent'} · média indisponible, dossier conservé dans le Creative.</p>}</article>)}</div></details>}
      {liveScene?.media && !previewMatchesDraft && <p className="sw-message">Ce clip appartient à des réglages précédents. Une nouvelle génération et approbation sont nécessaires.</p>}
      <div className="sw-composer"><div className="sw-attach-row"><details><summary aria-label="Add Studio attachment">+</summary><div className="sw-attach-menu"><button className="ghost small" type="button" disabled={!sessionId || readonly} onClick={() => uploadRef.current?.click()}>Upload product image</button><label>Choose from Assets<select aria-label="Photo produit Studio" disabled={!sessionId || readonly || production.mediaKind === 'image'} value={production.productAssetId || ''} onChange={e => patch({ productAssetId: Number(e.target.value) || null })}><option value="">No product reference</option>{options?.media.filter(a => a.mime_type.startsWith('image/')).map(a => <option key={a.id} value={a.id}>{a.relative_path.split('/').pop()}</option>)}</select></label><details><summary>Add project context</summary><label>Product Test<select aria-label="Product Test Studio" disabled={readonly} value={productTestId || ''} onChange={e => { const id = Number(e.target.value) || null; patch({ productTestId: id, creativeId: null, newCreative: true, sceneLinks: {} }); onContextChange?.({ productTestId: id, creativeId: null }) }}><option value="">No Product Test</option>{options?.productTests.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Creative<select aria-label="Creative Studio" disabled={readonly} value={creativeId || ''} onChange={e => { const id = Number(e.target.value) || null; patch({ creativeId: id, newCreative: !id, sceneLinks: {} }); onContextChange?.({ productTestId, creativeId: id }) }}><option value="">No linked Creative</option>{options?.creatives.filter(c => !productTestId || c.product_test_id === Number(productTestId)).map(c => <option key={c.id} value={c.id}>{c.angle}</option>)}</select></label></details></div></details>{photo ? <span className="sw-reference-pill"><img src={mediaUrl(photo)} alt="Attached product reference"/>Product reference <button type="button" className="ghost small" disabled={readonly} onClick={() => patch({ productAssetId: null })}>×</button></span> : null}</div><label>Describe the marketing creative you want<textarea aria-label="Brief créatif Studio" rows={3} disabled={!sessionId || readonly} maxLength={1200} value={studio.brief.hook} onChange={e => update(s => ({ ...s, brief: { ...s.brief, hook: e.target.value } }))} placeholder="Create a premium product hero image on a clean bathroom counter." /></label><div className="sw-composer-bottom"><div className="sw-settings"><label>Image / Video<select aria-label="Studio media type" disabled={readonly} value={production.mediaKind} onChange={e => chooseMediaKind(e.target.value)}><option value="image">Image</option><option value="video">Video</option></select></label><label>Modèle<select aria-label="Modèle Studio" disabled={readonly || !models.length} value={model?.id || ''} onChange={e => chooseModel(e.target.value)}>{!model && <option value="">Aucun modèle configuré</option>}{models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>{production.mediaKind === 'image' ? <ModelSettings image model={model} value={production} onChange={(key,value)=>patch({[key]:value})} disabled={readonly} prefix="Studio"/> : <><label>Format<select aria-label="Format Studio" disabled={readonly || !model} value={production.aspectRatio} onChange={e => patch({ aspectRatio: e.target.value })}>{!model?.aspects.includes(production.aspectRatio) && <option>{production.aspectRatio}</option>}{model?.aspects.map(a => <option key={a}>{a}</option>)}</select></label><label>Résolution<select aria-label="Résolution Studio" disabled={readonly || !model} value={production.resolution} onChange={e => patch({ resolution: e.target.value })}>{!model?.resolutions.includes(production.resolution) && <option>{production.resolution}</option>}{model?.resolutions.map(r => <option key={r}>{r}</option>)}</select></label><label className="sw-check"><input type="checkbox" checked={production.generateAudio} disabled={readonly || !model?.audio} onChange={e => patch({ generateAudio: e.target.checked })} />Audio</label></>}</div><button className="primary sw-generate" disabled={!sessionId || readonly || !model || !studio.brief.hook.trim() || hasRunning} onClick={() => prepareQuote()}>{production.mediaKind === 'image' ? 'Generate image' : 'Generate'} <span>{money(estimate)}</span></button></div><p className="sw-small">Prompt-first Studio · optional Templates and project context stay secondary · every paid run still requires an exact cost confirmation.</p></div>
      <div className="sw-transfer"><div className="sw-actions"><button className="ghost" disabled={readonly || !scenes.length || !onOpenCreative} onClick={() => transfer(onOpenCreative)}>Ouvrir dans Create Ad</button><button className="ghost" disabled={readonly || !scenes.length || !onOpenCanvas} onClick={() => onOpenCanvas?.({ ...studioCanvasPayload(studio, work?.scenes, model), sessionId })}>Ouvrir dans Canvas</button></div><p className="sw-small">Create Ad enregistre les scènes dans le Creative choisi. Canvas copie le brouillon et lie les Assets existants, sans dupliquer les fichiers.</p><details><summary>Créer une variation</summary><div className="sw-actions"><select aria-label="Direction de variation Studio" value={variantTemplate} disabled={readonly} onChange={e => setVariantTemplate(e.target.value)}>{STUDIO_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="ghost" disabled={readonly || !sessionId || !onCreateVariation} onClick={() => onCreateVariation?.(createStudioVariation(studio, variantTemplate))}>Créer 1 brouillon séparé</button></div><p className="sw-small">Une nouvelle session, aucun appel de génération. Son propre lot sera chiffré et confirmé; elle ne s’ajoute pas aux scènes de cette publicité.</p></details></div>
    </main></div>
    {quote && <Confirmation quote={quote} busy={busy} onCancel={cancelQuote} onConfirm={confirm} />}
  </section>
}
