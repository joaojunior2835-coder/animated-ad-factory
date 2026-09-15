import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { apiBase, saveMediaToLocal } from '../lib/ai/apiClient.js'
import { inferStudioFromQuickPrompt, generateSceneOutline, generateOmniPrompts } from '../lib/marketingStudioModel.js'
import { VideoPreview, OperatorSettings } from './OperatorWorkspace.jsx'
import './CreativeGenerator.css'
import ReferenceRemix, { newRemix, RemixComparison, ReuseRemixScene } from './ReferenceRemix.jsx'
import ModelSettings from './ModelSettings.jsx'

const money = n => n == null ? 'Unavailable' : `€${(n / 100).toFixed(2)}`
async function request(path, body) {
  const r = await fetch(apiBase() + path, { method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const value = await r.json(); if (!r.ok || value.ok === false) throw new Error(value.error || 'Request failed.'); return value
}
const api = (path, body) => request('/api/operator/generator/' + path, body)
const mediaUrl = a => apiBase() + (a.relative_path === 'mock-video-output.mp4' ? '/' : '/media/') + a.relative_path.split('/').map(encodeURIComponent).join('/')
const blank = () => ({ name: 'Product scene', prompt: '', provider: 'mock', mode: 'text-to-video', seconds: 5, resolution: '480p', aspectRatio: '9:16', generateAudio: false, quantity:1, startAssetId: null })
const remixDraft = provider => ({...blank(),name:'Reference remix',provider,mode:'reference-to-video',remix:newRemix()})
const draft = s => ({ id: s.id, name: s.name, prompt: s.prompt, provider: s.provider, mode: s.mode, seconds: s.seconds, resolution: s.resolution, aspectRatio: s.aspectRatio, generateAudio: s.generateAudio, quantity:s.quantity??1, startAssetId: s.startAssetId, ...(s.remix ? {remix:s.remix} : {}) })
const unavailable = e => /FX/i.test(e) ? 'FX rate unavailable. Enter a verified rate in Operator settings.' : /BUDGET|budget/i.test(e) ? 'Insufficient budget. Check the iteration budget in Product Tests.' : /PROVIDER_NOT|not_configured/i.test(e) ? 'Provider not configured. Check Provider status below.' : e
const remixReady = s => Boolean(s.remix?.sourceAssetId && s.remix?.preparedAssetId && s.remix?.analysis && (s.remix.instructions.trim() || s.prompt.trim()))
const generationReady = s => s.remix ? remixReady(s) : Boolean(s.prompt.trim() && (s.mode!=='image-to-video' || s.startAssetId))
const isInternalQuickCreative = (options, saved) => {
  const creative = options?.creatives?.find(c => String(c.id) === String(saved?.creativeId))
  const product = options?.productTests?.find(p => String(p.id) === String(creative?.product_test_id || saved?.productTestId))
  return Boolean(creative && product?.name === 'Quick Create' && /Quick Create draft/i.test(creative.concept_summary || ''))
}

const CreativeGenerator = forwardRef(function CreativeGenerator({ studio, onReview, onProductTests, context, onContextChange, workspace='create_ad' }, ref) {
  const [options, setOptions] = useState(null), [work, setWork] = useState(null), [scenes, setScenes] = useState([])
  const [productId, setProductId] = useState(''), [creativeId, setCreativeId] = useState(''), [title, setTitle] = useState(''), [productName, setProductName] = useState(''), [brief, setBrief] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [quote, setQuote] = useState(null), [estimate, setEstimate] = useState(null)
  const [videoMode, setVideoMode] = useState('auto')
  const lock = useRef(false), current = useRef(null), selection = useRef('')
  const modal = useRef(null), starting = useRef(false)
  const quickCreating = useRef(false)
  const forceFreshQuick = useRef(false)
  const imageDrafts=useRef([])
  const activeTask=useRef(null),dirtyRef=useRef(false)
  const [entry,setEntry] = useState(() => localStorage.getItem('generator-entry') || 'scratch')
  const quickMode = ['video', 'remix'].includes(workspace)
  const chooseEntry = value => { setEntry(value); localStorage.setItem('generator-entry',value) }
  useEffect(()=>{if(workspace==='remix')chooseEntry('remix');else if(workspace==='video')chooseEntry('scratch')},[workspace])
  useEffect(() => {
    if (!quote) return
    const onKey = e => {
      if (e.key === 'Escape' && !lock.current) setQuote(null)
      if (e.key === 'Tab') {
        const buttons = modal.current?.querySelectorAll('button:not(:disabled)')
        if (!buttons?.length) return
        const first=buttons[0], last=buttons[buttons.length-1]
        if (e.shiftKey && document.activeElement===first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement===last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown',onKey); return () => document.removeEventListener('keydown',onKey)
  }, [quote])
  const accept = w => { imageDrafts.current=w.scenes.filter(s=>s.kind==='image');const visible={...w,scenes:w.scenes.filter(s=>s.kind!=='image')};current.current = visible; setWork(visible); setScenes(visible.scenes.map(draft)); dirtyRef.current=false;setDirty(false) }
  const refreshOptions = async () => { const o = await api('options'); setOptions(o); return o }
  const mediaSignature = work?.scenes.map(s => s.media?.id || '').join(',')
  useEffect(() => { if (mediaSignature) refreshOptions().catch(e => setError(e.message)) }, [mediaSignature])
  useEffect(() => { let alive = true; refreshOptions().then(o => {
    if (!alive) return
    if (quickMode) {
      let saved = {}
      try { saved = JSON.parse(sessionStorage.getItem(`quick-generator:${workspace}:${apiBase()}`) || '{}') } catch {}
      if (saved.creativeId && !isInternalQuickCreative(o, saved)) {
        sessionStorage.removeItem(`quick-generator:${workspace}:${apiBase()}`)
        forceFreshQuick.current = true
        return
      }
      const backendSaved = o.quickSelections?.[workspace]
      const selected = isInternalQuickCreative(o, saved) ? saved : backendSaved
      if (selected && isInternalQuickCreative(o, selected)) {
        sessionStorage.setItem(`quick-generator:${workspace}:${apiBase()}`, JSON.stringify(selected))
        setProductId(String(selected.productTestId || ''))
        setCreativeId(String(selected.creativeId || ''))
      } else if (saved.creativeId) {
        sessionStorage.removeItem(`quick-generator:${workspace}:${apiBase()}`)
      }
      return
    }
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(`generator-selection:${apiBase()}`) || '{}') } catch {}
    if(context?.productTestId) saved={productId:String(context.productTestId),creativeId:String(context.creativeId||'')}
    if (o.productTests.some(p => String(p.id) === saved.productId)) { setProductId(saved.productId); setCreativeId(saved.creativeId || '') }
    else if (o.productTests.length) setProductId(String(o.productTests[0].id))
  }).catch(e => setError(e.message)); return () => { alive = false } }, [])
  useEffect(() => {
    if (!quickMode || !options || creativeId || quickCreating.current) return
    let saved = {}
    try { saved = JSON.parse(sessionStorage.getItem(`quick-generator:${workspace}:${apiBase()}`) || '{}') } catch {}
    if (saved.creativeId && !isInternalQuickCreative(options, saved)) {
      sessionStorage.removeItem(`quick-generator:${workspace}:${apiBase()}`)
      forceFreshQuick.current = true
    }
    if (forceFreshQuick.current) {
      quickCreating.current = true
      act(async () => {
        const r = await api('quick-creative', { workspace, title: workspace === 'remix' ? 'Quick remix draft' : 'Quick video draft' })
        const initial = workspace === 'remix' ? remixDraft(options.models[0]?.id || 'mock') : blank()
        await api(`${r.creativeId}/scenes`, { revision: 0, scenes: [initial] })
        await refreshOptions()
        sessionStorage.setItem(`quick-generator:${workspace}:${apiBase()}`, JSON.stringify({ productTestId: r.productTestId, creativeId: r.creativeId }))
        setProductId(String(r.productTestId))
        setCreativeId(String(r.creativeId))
      }).finally(() => { quickCreating.current = false; forceFreshQuick.current = false })
      return
    }
    const backendSaved = options.quickSelections?.[workspace]
    if (isInternalQuickCreative(options, saved)) return
    if (backendSaved && isInternalQuickCreative(options, backendSaved)) {
      sessionStorage.setItem(`quick-generator:${workspace}:${apiBase()}`, JSON.stringify(backendSaved))
      setProductId(String(backendSaved.productTestId || ''))
      setCreativeId(String(backendSaved.creativeId || ''))
      return
    }
    if (saved.creativeId) sessionStorage.removeItem(`quick-generator:${workspace}:${apiBase()}`)
    quickCreating.current = true
    act(async () => {
      const r = await api('quick-creative', { workspace, title: workspace === 'remix' ? 'Quick remix draft' : 'Quick video draft' })
      const initial = workspace === 'remix' ? remixDraft(options.models[0]?.id || 'mock') : blank()
      await api(`${r.creativeId}/scenes`, { revision: 0, scenes: [initial] })
      await refreshOptions()
      sessionStorage.setItem(`quick-generator:${workspace}:${apiBase()}`, JSON.stringify({ productTestId: r.productTestId, creativeId: r.creativeId }))
      setProductId(String(r.productTestId))
      setCreativeId(String(r.creativeId))
    }).finally(() => { quickCreating.current = false })
  }, [quickMode, options, creativeId, workspace])
  useEffect(() => {
    selection.current = creativeId; current.current = null; setWork(null); setScenes([]); setDirty(false); setQuote(null); setError(''); setEstimate(null)
    try { if (options && !quickMode) localStorage.setItem(`generator-selection:${apiBase()}`, JSON.stringify({ productId, creativeId })) } catch {}
    if(options && !quickMode)onContextChange?.({productTestId:productId,creativeId})
    if (!creativeId) return
    const load = async () => { try { const r = await api(creativeId); if (selection.current === creativeId) accept(r.workspace) } catch(e) { setError(e.message) } }
    load()
  }, [creativeId, productId])
  useEffect(() => {
    if (!creativeId || dirty) return
    let alive = true
    const timer = setInterval(async () => { if (lock.current && !starting.current) return; try { const r = await api(creativeId); if (alive && selection.current === creativeId) { if (starting.current) setWork({...r.workspace,scenes:r.workspace.scenes.filter(s=>s.kind!=='image')}); else if (!lock.current) accept(r.workspace) } } catch(e) { if (alive) setError(e.message) } }, 2500)
    return () => { alive = false; clearInterval(timer) }
  }, [creativeId, dirty])
  const act = async fn => {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    const task=(async()=>{try { await fn() } catch(e) { setError(unavailable(e.message)); setQuote(null) } finally { lock.current = false; setBusy(false) }})()
    activeTask.current=task;await task
  }
  const save = async () => {
    const needsPreparation = s => s.remix && remixReady(s) && !['Queued','Generating','Reconciliation required'].includes(current.current.scenes.find(v=>v.id===s.id)?.status) && (!s.remix.scriptApproved || !s.remix.promptContext || !s.prompt.trim() || !s.remix.script.trim())
    if (!dirty && !scenes.some(needsPreparation)) return current.current
    const prepared = await Promise.all(scenes.map(async s => {
      if (!s.remix || !remixReady(s) || ['Queued','Generating','Reconciliation required'].includes(current.current.scenes.find(v=>v.id===s.id)?.status)) return s
      // Prepare through the existing local builder; paid consent is still the
      // separate one-use cost confirmation. Preserve current Advanced edits.
      if (!s.remix.promptContext || !s.prompt.trim() || !s.remix.script.trim()) {
        const built = await api(`${creativeId}/remix-prompt`, { scene:s })
        return {...s,prompt:built.prompt,remix:{...s.remix,script:built.script,promptContext:built.promptContext,scriptApproved:true}}
      }
      return s.remix.scriptApproved ? s : {...s,remix:{...s.remix,scriptApproved:true}}
    }))
    const { workspace } = await api(`${creativeId}/scenes`, { revision: current.current.revision, scenes:[...prepared,...imageDrafts.current] })
    accept(workspace); return current.current
  }
  useImperativeHandle(ref,()=>({flushDraft:async()=>{
    if(starting.current)return
    if(lock.current){await activeTask.current;if(dirtyRef.current)throw new Error('Draft could not be saved. Resolve the displayed error before switching.');return}
    if(dirty){lock.current=true;try{await save()}finally{lock.current=false}}
  }}))
  useEffect(() => {
    if (!dirty || busy || !work || error) return
    const timer = setTimeout(() => act(save), 1000)
    return () => clearTimeout(timer)
  }, [dirty, scenes, busy, error])
  useEffect(() => {
    if (!work?.scenes.length || dirty) { setEstimate(null); return }
    let alive = true
    api(`${creativeId}/estimate`, { sceneIds: work.scenes.map(s => s.id) }).then(r => { if (alive) setEstimate(r) }).catch(e => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [work?.revision, creativeId, dirty])
  const edit = next => { dirtyRef.current=true;setScenes(next); setDirty(true); setQuote(null); setError('') }
  const change = (index, field, value) => edit(scenes.map((s,i) => i === index ? { ...s, [field]: value, ...(s.remix ? {remix:{...s.remix,scriptApproved:false,...(field==='generateAudio'?{promptContext:''}:{})}} : {}) } : s))
  const move = (index, delta) => { const next = [...scenes]; [next[index], next[index+delta]] = [next[index+delta], next[index]]; edit(next) }
  const propose = source => {
    const prepared = source || inferStudioFromQuickPrompt(brief || [options.productTests.find(p => String(p.id) === productId)?.name, work.creative.angle, work.creative.concept_summary].filter(Boolean).join(', '), options.productTests.find(p=>String(p.id)===productId)?.language || 'fr')
    const outline = prepared.scenes?.length ? prepared.scenes : generateSceneOutline(prepared)
    const prompts = prepared.prompts?.length ? prepared.prompts : generateOmniPrompts(prepared, outline)
    const additions = prompts.map((p,i) => ({ ...blank(), name: outline[i]?.purpose || `Scene ${i+1}`, prompt: p.promptText || outline[i]?.visualDescription || '', seconds: Math.max(4,Math.min(15,Number(p.duration)||5)) }))
    if (!additions.length) throw new Error('No scene proposal is available. Add scenes manually.')
    edit([...scenes, ...additions].slice(0,12))
  }
  const askGenerate = indexes => act(async () => {
    const w = await save()
    const response = await api(`${creativeId}/quote`, { revision: w.revision, sceneIds: indexes.map(i => w.scenes[i].id) })
    accept(response.workspace); setQuote(response.quote)
  })
  const confirm = () => act(async () => {
    const pending = quote; setQuote(null); starting.current=true
    try {
      const result = await api(`${creativeId}/start`, { confirmed: true, token: pending.token, revision: pending.revision })
      const blocked = result.outcomes?.find(r => r.outcome !== 'started')
      if (blocked) throw new Error(blocked.reason || 'Production could not start. Check scene status.')
    } finally { starting.current=false; const r = await api(creativeId); accept(r.workspace) }
  })
  const resultAction = (index, values) => act(async () => { const w = await save(); const r = await api(`${creativeId}/result`, { revision: w.revision, sceneId: w.scenes[index].id, ...values }); accept(r.workspace) })
  const upload = (index, file) => act(async () => {
    if (!file) return
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 15*1024*1024) throw new Error('Choose a PNG, JPEG or WebP image under 15 MB.')
    const data = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })
    const saved = await saveMediaToLocal({ data_url: data, file_name: file.name, mime_type: file.type, category: 'asset', project_id: `creative-${creativeId}` })
    if (!saved.success) throw new Error(saved.error || 'Image upload failed.')
    const relativePath = decodeURIComponent(new URL(saved.local_url, window.location.href).pathname.replace(/^\/media\//,''))
    const registered = await request('/api/assets/register-external', { relativePath, mimeType: file.type })
    await refreshOptions(); change(index, 'startAssetId', registered.item.id)
  })
  const ready = scenes.map((s,i) => ({s,i, live:work?.scenes.find(v => v.id === s.id)})).filter(({s,live}) => generationReady(s) && !['Queued','Generating','Reconciliation required','Complete'].includes(live?.status)).map(v => v.i)
  const approved = work?.scenes.filter(s => s.approved).length || 0
  const splitRemix = index => act(async()=>{
    const s=scenes[index], sentences=s.remix.script.match(/[^.!?\n]+[.!?]?/g)||[s.remix.script], chunks=[]
    let part=''
    for(const sentence of sentences){if(part && (part+' '+sentence).trim().split(/\s+/).length>30){chunks.push(part.trim());part=''}part+=' '+sentence.trim()}
    if(part.trim())chunks.push(part.trim())
    if(chunks.length<2)throw new Error('This script fits one segment. Add a longer script with separate sentences to split it.')
    if(scenes.length+chunks.length-1>12)throw new Error('Use at most 12 scenes; shorten this script or remove unused drafts.')
    const parts=[]
    for(const [n,script] of chunks.entries()){
      const words=script.split(/\s+/).length
      if(words>38)throw new Error('Split very long sentences into shorter beats before segmenting.')
      const next={...draft(s),id:n===0?s.id:undefined,name:`${s.name} · part ${n+1}`,seconds:Math.min(15,Math.max(4,Math.ceil(words/2.5))),remix:{...s.remix,script,scriptApproved:false,instructions:s.remix.instructions+`\nSegment ${n+1} of ${chunks.length}. Maintain product, cast, location and visual continuity across this ad.`}}
      const built=await request(`/api/operator/generator/${creativeId}/remix-prompt`,{scene:next});next.prompt=built.prompt;next.remix.promptContext=built.promptContext;parts.push(next)
    }
    edit([...scenes.slice(0,index),...parts,...scenes.slice(index+1)])
  })
  const useRemixCreative = index => act(async()=>{
    let w=await save();w=(await api(`${creativeId}/result`,{revision:w.revision,sceneId:w.scenes[index].id,approved:true})).workspace
    accept(w);const r=await api(`${creativeId}/assemble`,{revision:w.revision});accept(r.workspace);await refreshOptions()
  })
  const finalCurrent = work?.final && JSON.stringify(work.final.sources) === JSON.stringify(work.scenes.filter(s => s.approved).map(s => ({sceneId:s.id,assetId:s.media.id,sourceRunId:s.runId||null})))
  const download = asset => act(async () => { const r = await fetch(mediaUrl(asset)); if (!r.ok) throw new Error('Local video is unavailable.'); const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href=url; a.download='final-ad.mp4'; a.click(); setTimeout(() => URL.revokeObjectURL(url),10000) })
  const resetQuickDraft = () => { sessionStorage.removeItem(`quick-generator:${workspace}:${apiBase()}`); setProductId(''); setCreativeId(''); setWork(null); setScenes([]); setQuote(null); setEstimate(null); setError('') }
  const currentVideoDraft = scenes[0] || blank()
  const videoPrompt = scenes.length > 1 ? brief : (currentVideoDraft.prompt || brief)
  const videoCapability = options?.capabilities.find(m => m.capability === 'generate_video' && m.provider === currentVideoDraft.provider)
  const videoStartAsset = options?.media.find(a => a.id === currentVideoDraft.startAssetId)
  const ensureOneVideoScene = value => {
    const base = scenes[0] || blank()
    edit(scenes.length ? [{ ...base, prompt: value }, ...scenes.slice(1)] : [{ ...base, prompt: value }])
  }
  const setVideoPrompt = value => { setBrief(value); if (scenes.length <= 1) ensureOneVideoScene(value) }
  const videoWantsScenes = text => {
    const lower = String(text || '').toLowerCase()
    const seconds = Number((lower.match(/(\d+)\s*(?:second|seconds|sec|s|seconde|secondes)/) || [])[1])
    return seconds > 15 || /\b(hook|demo|demonstration|cta|ugc|ad|advert|publicit|scenes?|plans?)\b/.test(lower)
  }
  const autoPlanVideo = () => {
    const text = videoPrompt.trim()
    if (!text) throw new Error('Describe the video before generating.')
    const prepared = inferStudioFromQuickPrompt(text, options.productTests.find(p => String(p.id) === productId)?.language || 'fr')
    const outline = prepared.scenes?.length ? prepared.scenes : generateSceneOutline(prepared)
    const prompts = prepared.prompts?.length ? prepared.prompts : generateOmniPrompts(prepared, outline)
    const additions = prompts.map((p,i) => ({ ...blank(), provider: currentVideoDraft.provider, mode: currentVideoDraft.mode, seconds: Math.max(4,Math.min(15,Number(p.duration)||currentVideoDraft.seconds||5)), resolution: currentVideoDraft.resolution, aspectRatio: currentVideoDraft.aspectRatio, generateAudio: currentVideoDraft.generateAudio, quantity: currentVideoDraft.quantity || 1, startAssetId: currentVideoDraft.startAssetId || null, name: outline[i]?.purpose || `Scene ${i+1}`, prompt: p.promptText || outline[i]?.visualDescription || text }))
    if (!additions.length) throw new Error('No scene proposal is available. Add scenes manually.')
    edit(additions.slice(0,12))
  }
  const videoPrimaryGenerate = () => {
    try {
      if ((videoMode === 'auto' || videoMode === 'multi') && videoWantsScenes(videoPrompt) && scenes.length <= 1) return autoPlanVideo()
      return askGenerate(ready.length ? ready : scenes.map((_, i) => i))
    } catch(e) { setError(e.message) }
  }
  useEffect(() => {
    if (workspace !== 'video' || !quickMode || !creativeId || !work || dirty || busy) return
    let transfer = {}
    try { transfer = JSON.parse(sessionStorage.getItem(`quick-transfer:video:${apiBase()}`) || '{}') } catch {}
    const assetId = Number(transfer.assetId)
    if (!assetId || scenes.some(scene => Number(scene.startAssetId) === assetId)) {
      if (assetId) sessionStorage.removeItem(`quick-transfer:video:${apiBase()}`)
      return
    }
    act(async () => {
      const w = current.current
      const incoming = { ...blank(), name: 'Image start frame', mode: 'image-to-video', startAssetId: assetId }
      const replaceBlank = w.scenes.length === 1 && !String(w.scenes[0].prompt || '').trim() && !w.scenes[0].runId && !w.scenes[0].selectedAssetId
      const r = await api(`${creativeId}/scenes`, { revision: w.revision, scenes: replaceBlank ? [{ ...w.scenes[0], ...incoming }] : [...w.scenes, incoming] })
      sessionStorage.removeItem(`quick-transfer:video:${apiBase()}`)
      accept(r.workspace)
    })
  }, [workspace, quickMode, creativeId, work?.revision, dirty, busy, scenes])
  return <section className={`generator cg-workspace-${workspace} ${quickMode ? 'cg-quick-mode' : ''}`} data-testid="creative-generator">
    <header className="cg-header"><div><span className="cg-eyebrow">CREATE</span><h2>{workspace==='remix'?'Remix':workspace==='video'?'Create Video':'Create Ad'}</h2><p>{workspace==='remix'?'Reference video + reference images + one instruction.':workspace==='video'?'Attach media if needed, describe the video, choose settings, Generate.':'Shape an idea. Choose your scenes. Make it move.'}</p></div>{quickMode?<button className="ghost cg-new-compact" disabled={busy || quickCreating.current} onClick={resetQuickDraft}>{workspace==='remix'?'New remix draft':'New'}</button>:<button className="ghost" onClick={onProductTests}>Product setup</button>}</header>
    <div className="cg-entry-paths"><button className="ghost" aria-pressed={entry==='scratch'} onClick={()=>chooseEntry('scratch')}>Build From Scratch<br/><small>Product → scenes → finished ad</small></button><button className="ghost" aria-pressed={entry==='remix'} onClick={()=>chooseEntry('remix')}>Remix Reference Ad<br/><small>Reference video → your product → a new ad</small></button></div>
    {error && <div role="alert" className="note bad">{error} <button className="ghost small" disabled={busy} onClick={() => act(async () => { if (dirty && !window.confirm('Reload saved scenes and discard unsaved edits?')) return; await refreshOptions(); if(creativeId) accept((await api(creativeId)).workspace) })}>Reload saved state</button></div>}
    {!options ? <p>Loading your workspace…</p> : <>
      {workspace==='video'&&work&&<section className="cg-video-primary" aria-label="Video creation composer"><div className="cg-video-stage">{work.scenes.some(s=>s.media)?<div className="cg-video-history">{work.scenes.filter(s=>s.media).slice(-4).map((s,i)=><div key={`${s.id}-${i}`}><VideoPreview asset={s.media} compact/><small>{s.name}</small></div>)}</div>:<div className="cg-placeholder">Your generated videos and recent outputs will appear here. Start by describing the shot or ad you want.</div>}</div><div className="cg-video-composer"><div className="cg-attach-row"><details><summary aria-label="Add video attachment">+</summary><div className="cg-attach-menu"><label className="field">Upload image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>upload(0,e.target.files[0])}/></label><label className="field">Choose from Assets<select aria-label="Video composer start frame" disabled={busy} value={currentVideoDraft.startAssetId||''} onChange={e=>change(0,'startAssetId',Number(e.target.value)||null)}><option value="">No start frame</option>{options.media.filter(a=>a.mime_type.startsWith('image/')).map(a=><option key={a.id} value={a.id}>{a.relative_path.split('/').pop()}</option>)}</select></label><details><summary>Add context</summary><div className="cg-selectors-link"><label className="field">Product<select aria-label="Product Test" value={productId} disabled={busy || dirty} onChange={e => { setProductId(e.target.value); setCreativeId('') }}><option value="">No Product Test</option>{options.productTests.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="field">Creative<select aria-label="Creative" value={creativeId} disabled={busy || dirty} onChange={e => { setCreativeId(e.target.value); sessionStorage.setItem(`quick-generator:${workspace}:${apiBase()}`, JSON.stringify({ productTestId: productId, creativeId: e.target.value, linked: true })) }}><option value="">No linked Creative</option>{options.creatives.filter(c => String(c.product_test_id) === productId).map(c=><option key={c.id} value={c.id}>{c.angle}</option>)}</select></label></div></details></div></details>{videoStartAsset&&<span className="cg-reference-pill"><img src={mediaUrl(videoStartAsset)} alt="Attached start frame"/>Product reference <button type="button" className="ghost small" onClick={()=>change(0,'startAssetId',null)}>×</button></span>}</div><label className="field cg-video-prompt">Describe the video you want<textarea aria-label="Video prompt" value={videoPrompt} disabled={busy} rows={3} placeholder="Create a 20-second French UGC ad with a hook, product demo and natural CTA." onChange={e=>setVideoPrompt(e.target.value)}/></label><div className="cg-video-controls"><label className="field">Structure<select aria-label="Video structure" value={videoMode} onChange={e=>setVideoMode(e.target.value)} disabled={busy}><option value="auto">Auto</option><option value="single">Single clip</option><option value="multi">Multi-scene</option></select></label><label className="field">Model<select aria-label="Video model" disabled={busy} value={currentVideoDraft.provider} onChange={e=>change(0,'provider',e.target.value)}>{options.models.map(m=><option key={m.id} value={m.id}>{m.label} · {m.providerLabel}</option>)}</select></label><ModelSettings model={videoCapability} value={currentVideoDraft} onChange={(key,value)=>change(0,key,value)} disabled={busy} prefix="Video"/><button className="primary cg-video-generate" disabled={busy || !videoPrompt.trim()} onClick={videoPrimaryGenerate}>{scenes.length>1?'Generate all':'Generate'}<small>{dirty?'Quote before confirmation':money(estimate?.totalMinor)}</small></button></div><p className="hint small">Structure defaults to Auto: short shot prompts stay one clip; longer ad/script prompts with hook, demo, CTA or durations beyond one clip become editable scenes first.</p></div></section>}
      <div className="cg-selectors subpanel"><label className="field">Product<select aria-label="Product Test" value={productId} disabled={busy || dirty} onChange={e => { setProductId(e.target.value); setCreativeId('') }}><option value="">Choose a product</option>{options.productTests.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="field">Ad concept<select aria-label="Creative" value={creativeId} disabled={busy || dirty} onChange={e => setCreativeId(e.target.value)}><option value="">Choose or create an ad</option>{options.creatives.filter(c => String(c.product_test_id) === productId).map(c => <option key={c.id} value={c.id}>{c.angle}</option>)}</select></label>
        <details><summary>New product</summary><label className="field">Product name<input value={productName} onChange={e => setProductName(e.target.value)} /></label><button className="ghost" disabled={busy || !productName.trim()} onClick={() => act(async () => { const r=await request('/api/product-tests',{newProduct:{name:productName.trim()},market:'FR',language:'fr',currency:'EUR'}); await refreshOptions(); setProductId(String(r.item.id)); setCreativeId(''); setProductName('') })}>Create product</button></details>
        <div><label className="field">New ad title<input aria-label="New Creative title" placeholder="A simple product demonstration" value={title} onChange={e => setTitle(e.target.value)} /></label><button className="ghost" disabled={busy || dirty || !productId || !title.trim()} onClick={() => act(async () => { const r=await api('creatives',{productTestId:Number(productId),angle:title}); if(entry==='remix')await api(`${r.creativeId}/scenes`,{revision:0,scenes:[remixDraft(options.models[0]?.id || 'mock')]}); if(workspace==='video')await api(`${r.creativeId}/scenes`,{revision:0,scenes:[blank()]}); await refreshOptions(); setCreativeId(String(r.creativeId)); setTitle('') })}>Create ad</button></div>
      </div>
      {!work ? <div className="cg-empty cg-empty-start">{workspace==='video'?'Create your first video: choose a product, name the ad, then write one prompt and generate with Mock or Seedance.':workspace==='remix'?'Create or choose an ad, then drop a reference video, add product images, write one instruction and generate.':'Choose or create an ad to begin.'}</div> : null}
      {work && <>
        <div className="cg-summary"><h3>{quickMode ? (workspace==='remix'?'Quick remix':'Quick video') : work.creative.angle}</h3>{!quickMode&&<p>{work.creative.concept_summary || work.creative.hook_text}</p>}<div className="cg-stats"><span>{scenes.length} scenes</span><span>{work.scenes.filter(s=>s.status==='Complete').length} complete</span><span>{approved} / {scenes.length} approved</span><span>Estimate: {money(estimate?.totalMinor)}</span>{!quickMode&&<><span>Recorded: {money(work.recordedMinor)}</span><span>Iteration budget: {money(work.budget.budgetCeilingMinor)}</span></>}</div>{!quickMode&&<small>Recorded costs may use catalog estimates, not verified provider invoices.</small>}</div>
        {entry==='scratch'&&workspace==='video'&&videoMode==='auto'&&<div className="subpanel cg-auto-scenes"><label className="field">Ad brief / script<input value={brief} onChange={e => setBrief(e.target.value)} placeholder="Create a 20-second UGC ad. Hook, demo, natural CTA…" /></label><div className="cg-actions"><button className="primary" disabled={busy || scenes.length>=12 || !brief.trim()} onClick={() => { try { propose() } catch(e){setError(e.message)} }}>Auto-plan scenes</button>{studio && <button className="ghost" disabled={busy || scenes.length>=12} onClick={() => { try { propose(studio) } catch(e){setError(e.message)} }}>Import Marketing Studio scenes</button>}<small>Local editable scene planning. No AI credits used.</small></div></div>}
        {entry==='scratch'&&workspace!=='video'&&<div className="subpanel"><label className="field">One-line brief (optional)<input value={brief} onChange={e => setBrief(e.target.value)} placeholder="A cinematic ad showing why this product is useful" /></label><div className="cg-actions"><button className="ghost" disabled={busy || scenes.length>=12} onClick={() => { try { propose() } catch(e){setError(e.message)} }}>Generate Scenes From Creative</button>{studio && <button className="ghost" disabled={busy || scenes.length>=12} onClick={() => { try { propose(studio) } catch(e){setError(e.message)} }}>Import Marketing Studio scenes</button>}<small>Editable local proposals. No AI credits used.</small></div></div>}
        <div className="cg-actions cg-toolbar"><button className="primary" disabled={busy || !ready.length} onClick={() => askGenerate(ready)}>Generate all ready scenes</button>{entry==='remix'?<button className="ghost" disabled={busy||scenes.length>=12} onClick={()=>edit([...scenes,remixDraft(options.models[0]?.id || 'mock')])}>Add remix scene</button>:<button className="ghost" disabled={busy || scenes.length>=12} onClick={() => edit([...scenes,blank()])}>Add scene</button>}<button className="ghost" disabled={busy || !dirty} onClick={() => act(save)}>Save scenes</button><span role="status">{busy ? 'Working…' : dirty ? 'Saving edits…' : 'Saved locally'}</span></div>
        <div className="cg-scenes">{scenes.map((s,i) => {
          const live=work.scenes.find(v=>v.id===s.id), held=live?.status==='Reconciliation required', running=['Generating','Queued'].includes(live?.status), locked=busy||held||running
          const price=estimate?.rows.find(r=>r.sceneId===s.id), start=options.media.find(a=>a.id===s.startAssetId)
          return <article className={`cg-scene ${s.remix?'remix-scene':''}`} key={s.id||`new-${i}`} data-testid={`generator-scene-${i+1}`}>
            <div className="cg-scene-heading"><h3>Scene {i+1}</h3><span className={`cg-status ${held?'held':live?.approved?'approved':''}`} role="status">{live?.approved?'Approved':live?.displayStatus||live?.status||'Ready'}</span><div className="cg-actions"><button className="ghost small" aria-label={`Move scene ${i+1} up`} disabled={busy||i===0} onClick={()=>move(i,-1)}>↑</button><button className="ghost small" aria-label={`Move scene ${i+1} down`} disabled={busy||i===scenes.length-1} onClick={()=>move(i,1)}>↓</button><button className="ghost small" disabled={busy||scenes.length>=12} onClick={()=>edit([...scenes,{...draft(s),id:undefined}])}>Duplicate</button><button className="ghost small" disabled={busy||!!live?.runId||!!live?.selectedAssetId} onClick={()=>edit(scenes.filter((_,n)=>n!==i))}>Delete</button></div></div>
            <div className="cg-scene-body"><div>
              <label className="field">Scene name / purpose<input aria-label={`Scene ${i+1} name`} disabled={locked} value={s.name} onChange={e=>change(i,'name',e.target.value)} /></label>
              {!s.remix&&<label className="field">Generation prompt<textarea aria-label={`Scene ${i+1} prompt`} disabled={locked} value={s.prompt} onChange={e=>change(i,'prompt',e.target.value)} rows={4}/></label>}
              {s.remix&&<ReferenceRemix scene={s} options={options} locked={locked} creativeId={creativeId} onChange={next=>edit(scenes.map((v,n)=>n===i?next:v))} act={act} request={request} refreshOptions={refreshOptions} onSegments={()=>splitRemix(i)}/>}
              <div className="cg-controls"><label className="field">Generation type<select aria-label={`Scene ${i+1} generation type`} disabled={locked||!!s.remix} value={s.mode} onChange={e=>change(i,'mode',e.target.value)}>{s.remix&&<option value="reference-to-video">Reference to video</option>}<option value="text-to-video">Text to video</option><option value="image-to-video">Image to video</option></select></label>
                <label className="field">Model<select aria-label={`Scene ${i+1} model`} disabled={locked} value={s.provider} onChange={e=>change(i,'provider',e.target.value)}>{!options.models.some(m=>m.id===s.provider)&&<option value={s.provider}>Unavailable — configure provider</option>}{options.models.map(m=><option key={m.id} value={m.id}>{m.label} · {m.providerLabel}</option>)}</select></label>
                <ModelSettings model={options.capabilities.find(m=>m.capability==='generate_video'&&m.provider===s.provider)} value={s} onChange={(key,value)=>change(i,key,value)} disabled={locked} prefix={`Scene ${i+1}`} reference={!!s.remix}/></div>
              {s.mode==='image-to-video'&&<div className="subpanel"><label className="field">Upload start image<input type="file" accept="image/png,image/jpeg,image/webp" disabled={locked} onChange={e=>upload(i,e.target.files[0])}/></label><label className="field">Choose start frame from Media Library<select aria-label={`Scene ${i+1} start frame`} disabled={locked} value={s.startAssetId||''} onChange={e=>change(i,'startAssetId',Number(e.target.value)||null)}><option value="">Choose a local image</option>{options.media.filter(a=>a.mime_type.startsWith('image/')).map(a=><option key={a.id} value={a.id}>{a.relative_path.split('/').pop()}</option>)}</select></label>{start&&<img className="cg-start-frame" src={mediaUrl(start)} alt={`Scene ${i+1} start frame`}/>}<small>{options.imageUnavailableReason}</small></div>}
              <p>Estimated cost: <strong>{dirty?'Updating…':(s.remix&&!s.remix.scriptApproved?'Add references and an instruction':money(price?.minor))}</strong>{price?.error&&(!s.remix||s.remix.scriptApproved)&&<span className="note bad"> {price.error}</span>}</p>
              {held?<div className="note bad" role="alert">Billing status uncertain — do not retry automatically. The existing request requires manual reconciliation. No replacement generation is available here.</div>:<div className="cg-actions"><button className="primary" disabled={locked||!generationReady(s)} onClick={()=>askGenerate([i])}>{s.remix?(live?.media?'Regenerate remix':'Generate remix'):(live?.media?'Regenerate scene':'Generate scene')}</button>{live?.media&&<><button className="ghost" disabled={locked||dirty||!live.current||live.approved} onClick={()=>resultAction(i,{approved:true})}>{s.remix?'Use as Scene':'Approve scene'}</button>{s.remix&&<button className="ghost" disabled={locked||dirty||!live.current} onClick={()=>useRemixCreative(i)}>Use as Creative</button>}<button className="ghost" disabled={locked||dirty||!live.approved} onClick={()=>resultAction(i,{approved:false})}>Needs regeneration</button></>}</div>}
              {s.remix&&live?.media&&<ReuseRemixScene creatives={options.creatives} currentCreativeId={creativeId} productId={productId} locked={locked||dirty||!live.current} onReuse={values=>act(async()=>{const w=await save();const r=await api(`${creativeId}/reuse`,{revision:w.revision,sceneId:w.scenes[i].id,...values});await refreshOptions();setCreativeId(String(r.creativeId))})}/>}
              {live?.status==='Failed'&&<p className="note bad" role="alert">Generation failed. Check the details before requesting a new, separately confirmed generation.</p>}
              {live?.media&&!live.current&&<p className="note warn">Settings changed. The preview is the previous generation. Regenerate and approve the new result.</p>}
              <details><summary>Use existing video / generation history</summary><label className="field">Scene video from Media Library<select disabled={locked||dirty} value="" onChange={e=>e.target.value&&resultAction(i,{assetId:Number(e.target.value)})}><option value="">Choose a local video (no generation)</option>{options.media.filter(a=>a.mime_type==='video/mp4').map(a=><option key={a.id} value={a.id}>{a.relative_path.split('/').pop()}</option>)}</select></label><p>{live?.history?.length||0} previous version(s) retained.</p>{live?.details&&<pre>{JSON.stringify({attempts:live.details.attempts,costs:live.details.costs},null,2)}</pre>}</details>
            </div><div className="cg-preview"><div>{s.remix?<RemixComparison original={options.media.find(a=>a.id===s.remix.sourceAssetId)} output={live?.media} onDownload={download} busy={busy}/>:live?.media?<VideoPreview asset={live.media} compact/>:<div className="cg-placeholder">{running?'Generation is running. You can leave this page and return.':'Your generated scene will appear here.'}</div>}{Number(s.quantity)>1&&live?.outputs?.length>0&&<div className="cg-output-choices" aria-label={`Scene ${i+1} outputs`}>{live.outputs.map((a,n)=><button key={`${a.id}:${a.job_id||n}`} className="ghost" aria-pressed={live.media?.id===a.id} disabled={locked||dirty} onClick={()=>resultAction(i,{assetId:a.id})}>Output {n+1}{live.media?.id===a.id?' · Selected':''}</button>)}</div>}</div></div></div>
          </article>
        })}</div>
        {!scenes.length&&<div className="cg-empty">{entry==='remix'?'Add a remix scene, drop a reference ad and choose what should change.':'Add a scene or generate an editable proposal to begin.'}</div>}
        <section className="cg-final subpanel"><div className="cg-actions"><h3>Final Ad</h3><button className="primary" disabled={busy||dirty||!approved||!options.ffmpeg} onClick={()=>act(async()=>{const w=await save(); const r=await api(`${creativeId}/assemble`,{revision:w.revision});accept(r.workspace);await refreshOptions()})}>{busy?'Working…':'Assemble final ad'}</button><span>{approved} approved scene(s) · visible order · local / free</span></div>
          <p>Only approved scenes are included. Assembly outputs a vertical 720×1280 MP4.</p>
          {work.final?.finalAsset&&<>{!finalCurrent&&<p className="note warn">Scene selection or order changed. This is the previous final ad; assemble again for the current selection.</p>}<VideoPreview asset={work.final.finalAsset} compact/><div className="cg-actions"><button className="ghost" disabled={busy} onClick={()=>download(work.final.finalAsset)}>Download final MP4</button><button className="ghost" onClick={onReview}>Send to review</button></div><p>Review state: {work.creative.approval_status}</p></>}
        </section>
      </>}
      <details className="subpanel"><summary>Provider status & settings</summary><p>fal.ai: {options.falConfigured?'Configured ✓':'Unavailable — FAL_API_KEY must exist in dashboard/.env.local'}</p><p>Seedance 2.0 Fast: {options.falConfigured?'Available ✓':'Unavailable'}</p><p>Image generation: open Image for safely priced FLUX generation. {options.imageUnavailableReason}</p><p>FFmpeg: {options.ffmpeg?'Available ✓':'Unavailable — configure the installed executable below'}</p><p>USD → EUR: {options.fx?`Stored rate ${options.fx.rate} · ${options.fx.source || 'manual'} (not a live refresh)`:'Unavailable — enter a verified rate below'}</p><OperatorSettings/><button className="ghost" disabled={busy} onClick={()=>act(refreshOptions)}>Refresh provider status</button></details>
    </>}
    {quote&&<div className="cg-modal-backdrop"><section className="cg-modal" ref={modal} role="dialog" aria-modal="true" aria-label="Confirm scene generation"><h3>Generate {quote.sceneIds.length} scene(s) for approximately {money(quote.totalMinor)}?</h3><p>Scenes: {quote.sceneIds.length} · Outputs / Jobs: {quote.outputCount || quote.sceneIds.length} · One submission attempt per output</p><p>Estimated total: <strong>{money(quote.totalMinor)}</strong></p><p>Models: {[...new Set(work.scenes.filter(s=>quote.sceneIds.includes(s.id)).map(s=>(options.models.find(m=>m.id===s.provider)?.label || 'Unavailable')+(s.remix?' Reference':'')))].join(', ')}</p><p>Resolution: {[...new Set(work.scenes.filter(s=>quote.sceneIds.includes(s.id)).map(s=>s.resolution))].join(', ')}</p>{work.scenes.filter(s=>quote.sceneIds.includes(s.id)&&s.remix).map(s=><p key={s.id}>{s.name}: 1 reference video · {s.remix.images.length} images · {s.remix.audioAssetId?1:0} audio reference · {s.seconds}s output · audio {s.generateAudio?'on':'off'}. Reference pricing includes input + output duration and nominal resolution area; actual dimensions/invoice can differ.</p>)}<p>Expected maximum new reservation: {money(quote.totalMinor)}. Remaining iteration ceiling: {money(quote.preflight.budgetCeilingMinor-quote.preflight.currentSettledSpendMinor-quote.preflight.activeReservedMinor)}.</p><p>This is a catalog estimate, not a guaranteed provider invoice. Each paid Job still passes atomic budget reservation. A regeneration is a new paid request.</p><div className="cg-actions"><button autoFocus className="ghost" disabled={busy} onClick={()=>setQuote(null)}>Cancel</button><button className="primary" disabled={busy} onClick={confirm}>Confirm generation</button></div></section></div>}
  </section>
})
export default CreativeGenerator