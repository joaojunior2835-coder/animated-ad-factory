import { useEffect, useRef, useState } from 'react'
import { PROVIDERS, providerName } from '../data/providers.js'
import { getMethod } from '../data/adMethods.js'
import { SCENE_FIELDS, SCENE_TYPES, newScene, newVariation, selectedVariation, validateCanvasImport, isCompetitorMethod, parseOutlineToScenes, presetPrefillPatch, canvasReadiness, buildSceneSkeletonPrompt, canvasToMethodData, buildBoardFromScenes, emptyBoard, reorderVariations, reorderScenes, removeVariation as removeVariationFromArray, replaceVariationMedia, sumSceneDurations, parseDeclaredSeconds, durationStatus, findSceneGaps, applyGeneratedScenePrompts, applyAdBriefScenes, normalizeAdBrief } from '../lib/canvasModel.js'
import { buildCanvasPrompt, buildCanvasRepairPrompt, buildSceneImprovePrompt, buildEmptyPromptsImprovePrompt, buildAdBriefPrompt } from '../lib/canvasPrompt.js'
import { uid } from '../lib/brandDocs.js'
import CanvasBoard from './CanvasBoard.jsx'
import AssetTray from './AssetTray.jsx'
import FlowImport from './FlowImport.jsx'
import MediaCleanup from './MediaCleanup.jsx'
import AddResultModal from './AddResultModal.jsx'
import MediaPreview from './MediaPreview.jsx'
import { runAction } from '../lib/ai/orchestrator.js'
import { variationTypeForAction } from '../lib/ai/providerActions.js'
import { getApiHealth, callPlaceholderLlmAction, apiBase, saveMediaToLocal } from '../lib/ai/apiClient.js'
import { normalizeMediaResult, mediaResultToVariation, getMediaResultHealth, isMediaResultSaveable, isMediaResultAttachable } from '../lib/ai/mediaResultContract.js'

const IMAGE_VIDEO_ACTIONS = ['generate_image', 'generate_video', 'generate_image_prompt', 'generate_video_prompt']

const REFERENCE_FIELDS = [
  { key: 'competitor_ad_name', label: 'Competitor ad name' },
  { key: 'competitor_brand', label: 'Competitor brand' },
  { key: 'source_url', label: 'Source URL' },
  { key: 'platform', label: 'Platform' },
  { key: 'ad_duration', label: 'Ad duration' },
  { key: 'notes', label: 'Notes', textarea: true }
]

const DEFAULT_FIELDS = [
  ['default_llm_provider', 'Default LLM'],
  ['default_image_provider', 'Default image'],
  ['default_video_provider', 'Default video'],
  ['default_voice_provider', 'Default voice (reserved)'],
  ['default_music_provider', 'Default music (reserved)']
]

function ProviderSelect({ value, onChange }) {
  return (
    <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">(default / none)</option>
      {PROVIDERS.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

function renumber(scenes) {
  return scenes.map((s, i) => ({ ...s, scene_number: i + 1 }))
}

export default function CanvasWorkspace({ project, onCanvas, previews, onSetPreview, onApplyCanvasImport, onSyncExportData, onLoadExample, onSelectCompetitor }) {
  const [copied, setCopied] = useState(false)
  const [promptModal, setPromptModal] = useState(false)
  const [paste, setPaste] = useState('')
  const [importErrors, setImportErrors] = useState([])
  const [imported, setImported] = useState(false)
  const [repairCopied, setRepairCopied] = useState(false)
  const [collapsed, setCollapsed] = useState({})
  const [outline, setOutline] = useState('')
  const [outlineMsg, setOutlineMsg] = useState('')
  const [toolMsg, setToolMsg] = useState('')
  const [view, setView] = useState('list')
  const [genResult, setGenResult] = useState(null)
  const [addResultScene, setAddResultScene] = useState(null)
  const [apiHealth, setApiHealth] = useState({ connected: false, providers: {}, openaiModel: '', openrouterModel: '', openaiImageModel: '', openaiImageConfigured: false, checkedAt: '', error: '', loading: false })
  const [apiTest, setApiTest] = useState({ loading: false, text: '', error: '' })
  const [actionLog, setActionLog] = useState([]) // session-only, newest first
  const [logOpen, setLogOpen] = useState(false)
  const [apiConfirm, setApiConfirm] = useState(null) // { run } when a paid call awaits confirmation
  const [genAllOverwrite, setGenAllOverwrite] = useState(false)
  const [genAllBusy, setGenAllBusy] = useState(false)
  const [promptGenMsg, setPromptGenMsg] = useState('')
  const [adBriefInput, setAdBriefInput] = useState('')
  const [adBriefOverwrite, setAdBriefOverwrite] = useState(false)
  const [adBriefBusy, setAdBriefBusy] = useState(false)
  const [adBriefMsg, setAdBriefMsg] = useState('')

  const method = getMethod(project.selected_method)
  const canvas = project.canvas || { competitor_reference: {}, model_defaults: {}, scenes: [] }
  const ref = canvas.competitor_reference || {}
  const defaults = canvas.model_defaults || {}
  const scenes = canvas.scenes || []
  const board = canvas.canvas_board || { nodes: [], edges: [] }
  const assets = canvas.assets || []
  const adBrief = canvas.ad_brief || {}
  const finalTimeline = scenes.map((s) => ({ s, v: selectedVariation(s) })).filter((x) => x.v)

  if (!isCompetitorMethod(project.selected_method)) {
    return (
      <section className="panel">
        <h2>Canvas</h2>
        <div className="note">Canvas is currently optimized for Competitor Video Recreation.</div>
        <p className="hint">Selected method: {method.name}. Switch to Competitor Video Recreation to use the Canvas.</p>
        <button className="primary" onClick={onSelectCompetitor}>
          Use Competitor Video Recreation
        </button>
      </section>
    )
  }

  // --- canvas mutations ---
  const setRef = (k, v) => onCanvas((c) => ({ ...c, competitor_reference: { ...c.competitor_reference, [k]: v } }))
  const setDefault = (k, v) => onCanvas((c) => ({ ...c, model_defaults: { ...c.model_defaults, [k]: v } }))
  const addScene = () => onCanvas((c) => ({ ...c, scenes: [...c.scenes, newScene(c.scenes.length + 1)] }))
  const updateScene = (i, patch) =>
    onCanvas((c) => {
      const next = [...c.scenes]
      next[i] = { ...next[i], ...patch }
      return { ...c, scenes: next }
    })
  const duplicateScene = (i) =>
    onCanvas((c) => {
      const next = [...c.scenes]
      next.splice(i + 1, 0, { ...c.scenes[i], id: uid() })
      return { ...c, scenes: renumber(next) }
    })
  const deleteScene = (i) => onCanvas((c) => ({ ...c, scenes: renumber(c.scenes.filter((_, idx) => idx !== i)) }))
  const moveScene = (i, dir) =>
    onCanvas((c) => {
      const j = i + dir
      if (j < 0 || j >= c.scenes.length) return c
      const next = [...c.scenes]
      ;[next[i], next[j]] = [next[j], next[i]]
      return { ...c, scenes: renumber(next) }
    })

  const isCollapsed = (id) => !!collapsed[id]
  const toggleCollapse = (id) => setCollapsed((m) => ({ ...m, [id]: !m[id] }))
  const setAllCollapsed = (val) => setCollapsed(Object.fromEntries(scenes.map((s) => [s.id, val])))
  const summary = (s) => {
    const t = String(s.what_happens || '').trim()
    return t ? (t.length > 80 ? t.slice(0, 80) + '…' : t) : '(no description)'
  }

  function createFromOutline(mode) {
    const parsed = parseOutlineToScenes(outline)
    if (!parsed.length) {
      setOutlineMsg('No usable lines found. Use lines like "0:00-0:03 Hook: ...".')
      return
    }
    if (mode === 'replace') {
      if (scenes.length > 0 && !window.confirm(`Replace all ${scenes.length} existing scene(s) with ${parsed.length} from the outline?`)) return
      onCanvas((c) => ({ ...c, scenes: renumber(parsed) }))
    } else {
      onCanvas((c) => ({ ...c, scenes: renumber([...c.scenes, ...parsed]) }))
    }
    setOutlineMsg(`${mode === 'replace' ? 'Replaced with' : 'Added'} ${parsed.length} scene(s).`)
    setOutline('')
  }

  function applyDefaultsToAll() {
    if (!scenes.length) return
    if (!window.confirm(`Overwrite provider fields on all ${scenes.length} scene(s) with the canvas defaults?`)) return
    onCanvas((c) => ({
      ...c,
      scenes: c.scenes.map((s) => ({
        ...s,
        llm_provider: c.model_defaults.default_llm_provider || '',
        image_provider: c.model_defaults.default_image_provider || '',
        video_provider: c.model_defaults.default_video_provider || ''
      }))
    }))
  }

  function clearOverrides() {
    if (!scenes.length) return
    if (!window.confirm('Clear the provider fields on all scenes?')) return
    onCanvas((c) => ({ ...c, scenes: c.scenes.map((s) => ({ ...s, llm_provider: '', image_provider: '', video_provider: '' })) }))
  }

  function uploadImage(i, scene, file) {
    if (!file) return
    const r = new FileReader()
    r.onload = () => onSetPreview(scene.id, String(r.result))
    r.readAsDataURL(file)
    updateScene(i, { image_name: file.name })
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildCanvasPrompt(project))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  // Generate Adaptation Prompt: open the preview modal and keep the existing copy behavior.
  function openPromptModal() {
    setPromptModal(true)
    copyPrompt()
  }

  function generateSkeletons() {
    let filled = 0
    onCanvas((c) => ({
      ...c,
      scenes: c.scenes.map((s) => {
        if (String(s.output_prompt || '').trim()) return s
        filled++
        const vp = s.video_provider || c.model_defaults.default_video_provider || ''
        return { ...s, output_prompt: buildSceneSkeletonPrompt(s, vp) }
      })
    }))
    setToolMsg(filled ? `Generated ${filled} output prompt skeleton(s) (empty scenes only).` : 'All scenes already have an output prompt — nothing changed.')
  }

  function syncExport() {
    if (!onSyncExportData) return
    onSyncExportData(canvasToMethodData(project))
    setToolMsg('Synced canvas scenes into competitor export data.')
  }

  function buildBoard() {
    if ((board.nodes || []).length > 0 && !window.confirm('Replace the existing board with a fresh one built from scenes?')) return
    onCanvas((c) => ({ ...c, canvas_board: buildBoardFromScenes(c.scenes, null) }))
    setToolMsg('Board built from scenes.')
  }

  function rebuildBoard() {
    onCanvas((c) => ({ ...c, canvas_board: buildBoardFromScenes(c.scenes, c.canvas_board || emptyBoard()) }))
    setToolMsg('Board rebuilt from scenes (manual status and positions kept).')
  }

  const updateBoardNode = (id, patch) =>
    onCanvas((c) => {
      const b = c.canvas_board || emptyBoard()
      return { ...c, canvas_board: { ...b, nodes: (b.nodes || []).map((n) => (n.id === id ? { ...n, ...patch } : n)) } }
    })

  // --- assets ---
  const addAsset = (asset) => onCanvas((c) => ({ ...c, assets: [...(c.assets || []), asset] }))
  const updateAsset = (id, patch) => onCanvas((c) => ({ ...c, assets: (c.assets || []).map((a) => (a.id === id ? { ...a, ...patch } : a)) }))
  const removeAsset = (id) => onCanvas((c) => ({ ...c, assets: (c.assets || []).filter((a) => a.id !== id) }))

  // --- variations (per scene) ---
  const addVariation = (sceneId) =>
    onCanvas((c) => ({
      ...c,
      scenes: c.scenes.map((s) => {
        if (s.id !== sceneId) return s
        const label = String.fromCharCode(65 + (s.variations || []).length)
        return { ...s, variations: [...(s.variations || []), newVariation(label)] }
      })
    }))
  const updateVariation = (sceneId, varId, patch) =>
    onCanvas((c) => ({ ...c, scenes: c.scenes.map((s) => (s.id === sceneId ? { ...s, variations: (s.variations || []).map((v) => (v.id === varId ? { ...v, ...patch } : v)) } : s)) }))
  const selectVariation = (sceneId, varId) =>
    onCanvas((c) => ({
      ...c,
      scenes: c.scenes.map((s) => {
        if (s.id !== sceneId) return s
        return { ...s, variations: (s.variations || []).map((v) => (v.id === varId ? { ...v, status: 'selected' } : v.status === 'selected' ? { ...v, status: 'generated' } : v)) }
      })
    }))
  // Remove a variation (model reference only — the file on disk is left in place).
  const removeVariation = (sceneId, varId) => onCanvas((c) => ({ ...c, scenes: c.scenes.map((s) => (s.id === sceneId ? { ...s, variations: removeVariationFromArray(s.variations, varId) } : s)) }))
  // Replace a variation's media IN PLACE (same id/position/selection).
  const replaceVariation = (sceneId, varId, mediaPatch) => onCanvas((c) => ({ ...c, scenes: c.scenes.map((s) => (s.id === sceneId ? { ...s, variations: replaceVariationMedia(s.variations, varId, mediaPatch) } : s)) }))
  // Drag-to-reorder within one scene. Order is the source of truth; selection (status) is untouched.
  const reorderVariation = (sceneId, fromId, toId) =>
    onCanvas((c) => ({ ...c, scenes: c.scenes.map((s) => (s.id === sceneId ? { ...s, variations: reorderVariations(s.variations, fromId, toId) } : s)) }))

  // Edit a scene's duration (seconds). Persists via the existing save path.
  const setSceneDuration = (sceneId, seconds) => {
    const n = Number(seconds)
    const val = Number.isFinite(n) && n > 0 ? n : 0
    onCanvas((c) => ({ ...c, scenes: c.scenes.map((s) => (s.id === sceneId ? { ...s, duration_seconds: val } : s)) }))
  }

  // Drag-to-reorder scenes in the Final Timeline. Array order is the timeline order;
  // scene_number stays STABLE and no variation/selection is touched.
  const reorderScene = (fromId, toId) => onCanvas((c) => ({ ...c, scenes: reorderScenes(c.scenes, fromId, toId) }))
  const dragSceneRef = useRef(null)
  const handleSceneDragStart = (sceneId) => {
    dragSceneRef.current = sceneId
  }
  const handleSceneDrop = (sceneId) => {
    const from = dragSceneRef.current
    dragSceneRef.current = null
    if (from && from !== sceneId) reorderScene(from, sceneId)
  }

  const setProviderMode = (mode) => onCanvas((c) => ({ ...c, provider_mode: ['manual', 'mock', 'api'].includes(mode) ? mode : 'manual' }))

  // Selected API provider (separate from provider_mode). Defaults to OpenAI.
  const apiProviderId = ['openai', 'openrouter'].includes(canvas.api_provider_id) ? canvas.api_provider_id : 'openai'
  const setApiProvider = (id) => onCanvas((c) => ({ ...c, api_provider_id: ['openai', 'openrouter'].includes(id) ? id : 'openai' }))
  const providerLabel = (id) => (id === 'openrouter' ? 'OpenRouter' : 'OpenAI')
  const selectedModel = apiProviderId === 'openrouter' ? apiHealth.openrouterModel : apiHealth.openaiModel
  const selectedConfigured = !!(apiHealth.providers && apiHealth.providers[apiProviderId])

  async function refreshHealth() {
    setApiHealth((h) => ({ ...h, loading: true }))
    const r = await getApiHealth()
    setApiHealth({ connected: r.connected, providers: r.providers || {}, openaiModel: r.openai_model || '', openrouterModel: r.openrouter_model || '', openaiImageModel: r.openai_image_model || '', openaiImageConfigured: !!r.openai_image_configured, checkedAt: new Date().toLocaleTimeString(), error: r.error || '', loading: false })
  }

  // --- API Action Log (session-only) + paid-call confirmation ---
  const preview = (s, n = 140) => {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
    return t.length > n ? t.slice(0, n) + '…' : t
  }

  function addLog(entry) {
    const item = {
      id: uid(),
      timestamp: new Date().toLocaleTimeString(),
      action_type: entry.action_type || '',
      provider_id: entry.provider_id || '',
      model: entry.model || '',
      scene_id: entry.scene_id || '',
      scene_number: entry.scene_number || '',
      status: entry.status || 'error',
      request_id: entry.request_id || '',
      prompt_preview: preview(entry.prompt_preview),
      output_preview: preview(entry.output_preview),
      error: entry.error || ''
    }
    setActionLog((log) => [item, ...log].slice(0, 50))
  }

  // Gate every paid OpenAI call behind a confirmation modal. Manual/Mock never reach here.
  function requestApiConfirm(run, message) {
    setApiConfirm({ run, message: message || '' })
  }

  // Auto-check backend health when API mode is selected.
  useEffect(() => {
    if (canvas.provider_mode === 'api') refreshHealth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas.provider_mode])

  // One-shot connectivity probe for the SELECTED API provider. Writes nothing.
  function runApiTest() {
    const providerId = apiProviderId
    requestApiConfirm(async () => {
      const prompt = 'Reply with exactly: Local backend connected.'
      setApiTest({ loading: true, text: '', error: '' })
      const res = await callPlaceholderLlmAction({ provider_id: providerId, action_type: 'generate_text', input_prompt: prompt })
      const ok = !!(res && res.success && res.output_text)
      if (ok) setApiTest({ loading: false, text: res.output_text, error: '' })
      else setApiTest({ loading: false, text: '', error: (res && (res.error || res.message)) || 'No response from backend.' })
      addLog({
        action_type: 'generate_text',
        provider_id: providerId,
        model: (res && res.model) || selectedModel,
        status: ok ? 'success' : 'error',
        request_id: res && res.request_id,
        prompt_preview: prompt,
        output_preview: ok ? res.output_text : '',
        error: ok ? '' : (res && (res.error || res.message)) || 'No response from backend.'
      })
    })
  }

  // Add a variation produced by a generation action (manual save or mock).
  function addGeneratedVariation(sceneId, fields) {
    onCanvas((c) => ({
      ...c,
      scenes: c.scenes.map((s) => {
        if (s.id !== sceneId) return s
        const label = String.fromCharCode(65 + (s.variations || []).length)
        const v = newVariation(label, {
          type: fields.type || variationTypeForAction(fields.action_type),
          provider: fields.provider_id || '',
          prompt: fields.prompt || '',
          external_url: fields.external_url || '',
          local_url: fields.local_url || '',
          storage: fields.storage || '',
          file_name: fields.file_name || '',
          mime_type: fields.mime_type || '',
          file_size: fields.file_size || 0,
          source_type: fields.source_type || '',
          action_type: fields.action_type || '',
          request_id: fields.request_id || '',
          model: fields.model || '',
          created_at: fields.created_at || '',
          notes: fields.notes || '',
          status: 'generated'
        })
        return { ...s, variations: [...(s.variations || []), v] }
      })
    }))
  }

  // Add Existing Result intake: create a variation. Uploaded files can be saved to
  // the local media library (survives reload) or kept as a session-only preview.
  function addExistingResult(sceneId, fields, file, saveLocal) {
    const scene = scenes.find((s) => s.id === sceneId)
    const label = (fields.label || '').trim() || String.fromCharCode(65 + ((scene && scene.variations) || []).length)
    const v = newVariation(label, {
      type: fields.type,
      provider: fields.provider,
      prompt: fields.prompt,
      external_url: fields.external_url,
      notes: fields.notes,
      status: fields.status,
      file_name: file ? file.name : '',
      storage: fields.external_url ? 'external_url' : ''
    })
    onCanvas((c) => ({ ...c, scenes: c.scenes.map((s) => (s.id === sceneId ? { ...s, variations: [...(s.variations || []), v] } : s)) }))
    if (!file) return
    const r = new FileReader()
    r.onload = async () => {
      const dataUrl = String(r.result)
      if (saveLocal) {
        const res = await saveMediaToLocal({ file_name: file.name, mime_type: file.type, data_url: dataUrl, category: 'variation', scene_id: sceneId })
        if (res && res.success) {
          updateVariation(sceneId, v.id, { local_url: res.local_url, storage: 'local_disk', file_name: res.file_name, mime_type: res.mime_type, file_size: res.file_size })
          return
        }
        // Save failed (backend down): fall back to a session-only preview.
      }
      onSetPreview(v.id, dataUrl)
    }
    r.readAsDataURL(file)
  }

  // Replace a variation's image in place: read the picked file, save via the EXISTING
  // media endpoint, then update the SAME variation (id/position/selection preserved).
  function replaceVariationFile(sceneId, varId, file) {
    if (!file) return
    const r = new FileReader()
    r.onload = () => {
      const dataUrl = String(r.result)
      const img = new Image()
      const finish = async (width, height) => {
        const res = await saveMediaToLocal({ file_name: file.name, mime_type: file.type, data_url: dataUrl, category: 'variation', scene_id: sceneId })
        if (!res || !res.success) {
          window.alert((res && res.error) || 'Replace failed to save (is the local backend running?).')
          return
        }
        const result = normalizeMediaResult({
          provider_id: 'manual', source_type: 'flow_import', media_type: 'image',
          local_url: res.local_url, file_name: res.file_name, mime_type: res.mime_type, file_size: res.file_size, storage: 'local_disk', status: 'success'
        })
        const f = mediaResultToVariation(result)
        // Media fields only — keep id, position, selected status, label, prompt, type.
        replaceVariation(sceneId, varId, {
          local_url: f.local_url, external_url: '', storage: f.storage || 'local_disk',
          file_name: f.file_name, mime_type: f.mime_type, file_size: f.file_size, source_type: f.source_type,
          notes: `Flow import ${file.name}${width ? ` (${width}×${height})` : ''}`
        })
      }
      img.onload = () => finish(img.naturalWidth, img.naturalHeight)
      img.onerror = () => finish(0, 0)
      img.src = dataUrl
    }
    r.readAsDataURL(file)
  }

  // Provider chosen for an action: scene override first, then canvas default.
  function providerFor(scene, actionType) {
    if (actionType === 'generate_video' || actionType === 'generate_video_prompt') return scene.video_provider || defaults.default_video_provider || ''
    if (actionType === 'generate_image' || actionType === 'generate_image_prompt') return scene.image_provider || defaults.default_image_provider || ''
    return scene.llm_provider || defaults.default_llm_provider || ''
  }

  // Run a generation action from a board node (Regenerate Image/Video, Generate Variation).
  async function runGeneration(node, actionType) {
    const scene = scenes.find((s) => s.id === node.scene_id)
    if (!scene) return
    const promptText = (node.data && node.data.prompt) || scene.output_prompt || scene.what_happens || ''
    const provider_id = providerFor(scene, actionType)
    const mode = canvas.provider_mode || 'manual'

    const base = {
      open: true,
      scene_id: scene.id,
      scene_number: scene.scene_number,
      action_type: actionType,
      provider_id,
      mode,
      prompt_used: promptText,
      output_text: '',
      output_url: '',
      attached: false,
      manualUrl: '',
      manualNotes: '',
      manualType: variationTypeForAction(actionType)
    }

    // API mode: never auto-writes state — results land in the modal for review.
    if (mode === 'api') {
      // Real text-to-image: OpenAI only, exactly one image, behind a credits confirm.
      if (actionType === 'generate_image' && apiProviderId === 'openai') {
        requestApiConfirm(async () => {
          setGenResult({ ...base, provider_id: 'openai', mode: 'api', loading: true, result: normalizeMediaResult({ provider_id: 'openai', action_type: 'generate_image', mode: 'api', media_type: 'image', status: 'pending', prompt: promptText, scene_id: scene.id }) })
          const res = await callPlaceholderLlmAction({ provider_id: 'openai', action_type: 'generate_image', input_prompt: promptText })
          const data_url = res.data_url || (res.b64_json ? `data:${res.mime_type || 'image/png'};base64,${res.b64_json}` : '')
          const result = normalizeMediaResult({
            provider_id: 'openai', action_type: 'generate_image', mode: 'api', media_type: 'image', prompt: promptText,
            data_url, external_url: res.external_url || '', mime_type: res.mime_type || 'image/png', model: res.model, request_id: res.request_id,
            success: res.success, status: res.success ? 'success' : 'error', message: res.success ? '' : res.error || res.message || 'Local API not reachable.', scene_id: scene.id
          })
          setGenResult({ ...base, provider_id: 'openai', mode: 'api', loading: false, output_text: res.output_text || '', message: res.success ? '' : res.error || res.message || 'Local API not reachable.', result })
          // Record in the API Action Log — never the key or the base64 image blob.
          addLog({
            action_type: 'generate_image',
            provider_id: 'openai',
            model: res.model || apiHealth.openaiImageModel,
            scene_id: scene.id,
            scene_number: scene.scene_number,
            status: res.success ? 'success' : 'error',
            request_id: res.request_id,
            prompt_preview: promptText,
            output_preview: res.success ? `[image ${result.mime_type || 'image/png'}]` : '',
            error: res.success ? '' : res.error || res.message || 'Local API not reachable.'
          })
        }, 'This will use OpenAI image API credits. Continue?')
        return
      }
      if (IMAGE_VIDEO_ACTIONS.includes(actionType)) {
        // Unsupported here: video (always), and image for non-OpenAI providers.
        const isVideo = actionType === 'generate_video' || actionType === 'generate_video_prompt'
        const error = isVideo
          ? 'OpenAI video generation is not connected yet.'
          : apiProviderId === 'openrouter'
            ? 'OpenRouter image/video generation is not connected yet.'
            : 'Image/video generation is not connected yet.'
        const result = normalizeMediaResult({
          provider_id: apiProviderId,
          action_type: actionType,
          mode: 'api',
          media_type: isVideo ? 'video' : 'image',
          status: 'unsupported',
          storage: 'none',
          prompt: promptText,
          error
        })
        setGenResult({ ...base, provider_id: apiProviderId, unsupported: true, message: result.error, result })
        return
      }
      // Text/JSON actions call the real local backend (/api/llm).
      const res = await callPlaceholderLlmAction({ provider_id, action_type: actionType, input_prompt: promptText })
      const result = normalizeMediaResult({
        provider_id, action_type: actionType, mode: 'api', prompt: promptText,
        output_text: res.output_text || '', raw_output: res.raw_text || '', model: res.model, request_id: res.request_id,
        success: res.success, message: res.error || res.message || 'Local API not reachable.', scene_id: scene.id
      })
      setGenResult({
        ...base,
        output_text: res.output_text || '',
        raw_text: res.raw_text,
        parsed_json: res.parsed_json,
        parse_error: res.parse_error,
        message: res.success ? '' : res.error || res.message || 'Local API not reachable.',
        result
      })
      return
    }

    // Manual / Mock: normalize through the contract. Nothing is auto-saved.
    const r = runAction({ project, canvas, scene, provider_id, action_type: actionType, input_prompt: promptText, mode })
    const result = normalizeMediaResult({
      provider_id, action_type: actionType, mode, prompt: r.prompt_used,
      output_text: r.output_text, external_url: r.output_url, success: r.success, message: r.message, scene_id: scene.id
    })
    setGenResult({ ...base, prompt_used: r.prompt_used, output_text: r.output_text, output_url: r.output_url, message: r.message || '', result })
  }

  // Explicit attach: turn the normalized result into a scene variation (no auto-save).
  function addResultAsVariation() {
    if (!genResult || !genResult.result) return
    const fields = mediaResultToVariation(genResult.result)
    if (genResult.manualUrl) {
      fields.external_url = genResult.manualUrl
      fields.storage = 'external_url'
    }
    if (genResult.manualType) fields.type = genResult.manualType
    if (genResult.manualNotes) fields.notes = genResult.manualNotes
    addGeneratedVariation(genResult.scene_id, fields)
    setGenResult((g) => ({ ...g, attached: true }))
  }

  // Save a result's inline data to the Local Media Library (only when it has data_url).
  async function saveResultToLocal() {
    if (!genResult || !genResult.result || !isMediaResultSaveable(genResult.result)) return
    const r = genResult.result
    const res = await saveMediaToLocal({ file_name: r.file_name || `${r.media_type}-result`, mime_type: r.mime_type, data_url: r.data_url, category: 'variation', scene_id: genResult.scene_id })
    if (res && res.success) {
      setGenResult((g) => ({ ...g, result: { ...g.result, local_url: res.local_url, storage: 'local_disk', file_name: res.file_name, mime_type: res.mime_type, file_size: res.file_size, data_url: '' } }))
    }
  }

  async function copyRepair() {
    try {
      await navigator.clipboard.writeText(buildCanvasRepairPrompt(paste, importErrors))
      setRepairCopied(true)
      setTimeout(() => setRepairCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  function doImport() {
    setImported(false)
    setRepairCopied(false)
    let parsed
    try {
      parsed = JSON.parse(paste)
    } catch (e) {
      setImportErrors(['Invalid JSON: ' + e.message])
      return
    }
    const res = validateCanvasImport(parsed)
    if (!res.ok) {
      setImportErrors(res.errors)
      return
    }
    setImportErrors([])
    onApplyCanvasImport(res.scenes, parsed)
    setImported(true)
    setPaste('')
  }

  // --- API "Canvas Brain" actions (OpenAI text/JSON via the local backend) ---
  // Results open the unified API Result Preview modal. Nothing is auto-applied.
  const isApiMode = canvas.provider_mode === 'api'

  async function runBrainAction({ kind, action_type, prompt, scene }) {
    const providerId = apiProviderId
    setGenResult({
      open: true,
      kind,
      action_type,
      provider_id: providerId,
      mode: 'api',
      prompt_used: prompt,
      output_text: '',
      raw_text: '',
      parsed_json: undefined,
      parse_error: '',
      message: '',
      applied: false,
      loading: true,
      scene_id: scene ? scene.id : '',
      scene_number: scene ? scene.scene_number : ''
    })
    const res = await callPlaceholderLlmAction({ provider_id: providerId, action_type, input_prompt: prompt })
    const ok = !!(res && res.success)
    const model = (res && res.model) || selectedModel
    const request_id = res && res.request_id
    setGenResult((g) => {
      if (!g) return g
      if (!ok) {
        return { ...g, loading: false, model, request_id, message: (res && (res.error || res.message)) || 'Local API not reachable.' }
      }
      return {
        ...g,
        loading: false,
        model,
        request_id,
        output_text: res.output_text || res.raw_text || '',
        raw_text: res.raw_text,
        parsed_json: res.parsed_json,
        parse_error: res.parse_error || '',
        message: ''
      }
    })
    addLog({
      action_type,
      provider_id: providerId,
      model,
      scene_id: scene ? scene.id : '',
      scene_number: scene ? scene.scene_number : '',
      status: ok ? 'success' : 'error',
      request_id,
      prompt_preview: prompt,
      output_preview: ok ? (res.output_text || res.raw_text || '') : '',
      error: ok ? '' : (res && (res.error || res.message)) || 'Local API not reachable.'
    })
  }

  function improveScenePrompt(scene) {
    requestApiConfirm(() => runBrainAction({ kind: 'scene_prompt', action_type: 'generate_text', prompt: buildSceneImprovePrompt(project, scene), scene }))
  }

  function improveEmptyPrompts() {
    const empties = scenes.filter((s) => !String(s.output_prompt || '').trim())
    if (!empties.length) {
      setToolMsg('All scenes already have an output prompt — nothing to improve.')
      return
    }
    requestApiConfirm(() => runBrainAction({ kind: 'empty_prompts', action_type: 'generate_json', prompt: buildEmptyPromptsImprovePrompt(project, empties) }))
  }

  function generateAdaptedJson() {
    requestApiConfirm(() => runBrainAction({ kind: 'canvas_json', action_type: 'generate_json', prompt: buildCanvasPrompt(project) }))
  }

  // One-click: generate output_prompt for every (empty, or all if overwrite) scene via
  // the EXISTING OpenAI text/JSON provider, then write back on a clean JSON parse only.
  // Forces provider_id 'openai' for this action; does not change the user's Provider Mode.
  function generateAllScenePrompts() {
    const overwrite = genAllOverwrite
    if (!scenes.length) {
      setPromptGenMsg('No scenes yet — add scenes first.')
      return
    }
    const targets = overwrite ? scenes : scenes.filter((s) => !String(s.output_prompt || '').trim())
    if (!targets.length) {
      setPromptGenMsg('All scenes already have a prompt. Check “overwrite existing” to regenerate them.')
      return
    }
    requestApiConfirm(async () => {
      setGenAllBusy(true)
      setPromptGenMsg(`Generating ${targets.length} scene prompt(s) via OpenAI…`)
      const promptText = buildEmptyPromptsImprovePrompt(project, targets)
      const res = await callPlaceholderLlmAction({ provider_id: 'openai', action_type: 'generate_json', input_prompt: promptText })
      const ok = !!(res && res.success)
      addLog({
        action_type: 'generate_json',
        provider_id: 'openai',
        model: (res && res.model) || apiHealth.openaiModel,
        status: ok ? 'success' : 'error',
        request_id: res && res.request_id,
        prompt_preview: promptText,
        output_preview: ok ? res.output_text || res.raw_text || '' : '',
        error: ok ? '' : (res && (res.error || res.message)) || 'Local API not reachable.'
      })
      const rid = res && res.request_id ? ` (request ${res.request_id})` : ''
      if (!ok) {
        setGenAllBusy(false)
        setPromptGenMsg(`Failed: ${(res && (res.error || res.message)) || 'Local API not reachable.'}${rid}. No scenes changed.`)
        return
      }
      // Apply ONLY on a clean parse — never partially corrupt the canvas.
      const applied = applyGeneratedScenePrompts(scenes, res.parsed_json, overwrite)
      if (!applied.ok) {
        setGenAllBusy(false)
        setPromptGenMsg(`Model returned unparseable output${res.parse_error ? ` (${res.parse_error})` : ''}${rid}. No scenes changed.`)
        return
      }
      onCanvas((c) => ({ ...c, scenes: applyGeneratedScenePrompts(c.scenes, res.parsed_json, overwrite).scenes }))
      setGenAllBusy(false)
      setPromptGenMsg(`Filled ${applied.filled} scene prompt(s)${overwrite ? ' (overwrite)' : ' (empty only)'}${rid}.`)
    }, 'This will use OpenAI API credits to generate scene prompts. Continue?')
  }

  // Ad Brief: paste a /watch competitor breakdown → OpenAI generate_json (text/JSON
  // only) → decoded structure + adapted script + REAL shot prompts written into the
  // EXISTING scenes by scene_number. Forces provider_id 'openai'; does NOT change the
  // user's Provider Mode. Applies state ONLY after a clean parse — never partial.
  function generateAdBrief() {
    const overwrite = adBriefOverwrite
    if (!adBriefInput.trim()) {
      setAdBriefMsg('Paste the /watch competitor breakdown first.')
      return
    }
    requestApiConfirm(async () => {
      setAdBriefBusy(true)
      setAdBriefMsg('Generating ad brief via OpenAI…')
      const promptText = buildAdBriefPrompt(project, adBriefInput)
      const res = await callPlaceholderLlmAction({ provider_id: 'openai', action_type: 'generate_json', input_prompt: promptText })
      const ok = !!(res && res.success)
      addLog({
        action_type: 'generate_json',
        provider_id: 'openai',
        model: (res && res.model) || apiHealth.openaiModel,
        status: ok ? 'success' : 'error',
        request_id: res && res.request_id,
        prompt_preview: promptText,
        output_preview: ok ? res.output_text || res.raw_text || '' : '',
        error: ok ? '' : (res && (res.error || res.message)) || 'Local API not reachable.'
      })
      const rid = res && res.request_id ? ` (request ${res.request_id})` : ''
      if (!ok) {
        setAdBriefBusy(false)
        setAdBriefMsg(`Failed: ${(res && (res.error || res.message)) || 'Local API not reachable.'}${rid}. No scenes or brief changed.`)
        return
      }
      // Apply ONLY on a clean parse — never partially corrupt the canvas.
      const applied = applyAdBriefScenes(scenes, res.parsed_json, overwrite)
      if (!applied.ok) {
        setAdBriefBusy(false)
        setAdBriefMsg(`Model returned an unparseable/invalid brief${res.parse_error ? ` (${res.parse_error})` : ''}${rid}. No scenes or brief changed.`)
        return
      }
      const brief = normalizeAdBrief({ ...res.parsed_json, generated_at: new Date().toISOString(), request_id: res.request_id, model: res.model || apiHealth.openaiModel })
      onCanvas((c) => ({ ...c, scenes: applyAdBriefScenes(c.scenes, res.parsed_json, overwrite).scenes, ad_brief: brief }))
      setAdBriefBusy(false)
      setAdBriefMsg(`Ad brief applied: filled ${applied.filled} scene(s)${applied.created ? `, created ${applied.created}` : ''}${overwrite ? ' (overwrite)' : ' (empty only)'}${rid}.`)
    }, 'This will use OpenAI API credits to generate an ad brief. Continue?')
  }

  // Shared control block — rendered in both List and Board View.
  const renderGenAllPrompts = () => (
    <div className="api-actions" style={{ flexWrap: 'wrap', gap: '8px' }}>
      <button className="primary small" onClick={generateAllScenePrompts} disabled={genAllBusy || scenes.length === 0}>
        {genAllBusy ? 'Generating…' : 'Generate all scene prompts (API)'}
      </button>
      <label className="row" style={{ alignItems: 'center', gap: '4px' }}>
        <input type="checkbox" checked={genAllOverwrite} onChange={(e) => setGenAllOverwrite(e.target.checked)} />
        <span className="hint small">overwrite existing</span>
      </label>
      <span className="hint small">Uses the OpenAI text provider via the local backend; fills empty prompts by default. No provider switch needed.</span>
      {promptGenMsg ? <div className="note">{promptGenMsg}</div> : null}
    </div>
  )

  function repairCanvasJsonWithApi() {
    requestApiConfirm(() => runBrainAction({ kind: 'repair_json', action_type: 'repair_json', prompt: buildCanvasRepairPrompt(paste, importErrors) }))
  }

  // ---- Apply handlers (explicit user action only) ----
  function applyScenePrompt() {
    if (!genResult) return
    const idx = scenes.findIndex((s) => s.id === genResult.scene_id)
    if (idx < 0) return
    updateScene(idx, { output_prompt: String(genResult.output_text || '').trim() })
    setGenResult((g) => ({ ...g, applied: true }))
  }

  function applyEmptyPrompts() {
    if (!genResult) return
    const proposals = (genResult.parsed_json && Array.isArray(genResult.parsed_json.prompts)) ? genResult.parsed_json.prompts : []
    onCanvas((c) => ({
      ...c,
      scenes: c.scenes.map((s) => {
        if (String(s.output_prompt || '').trim()) return s
        const p = proposals.find((x) => Number(x.scene_number) === Number(s.scene_number))
        if (p && String(p.output_prompt || '').trim()) return { ...s, output_prompt: String(p.output_prompt).trim() }
        return s
      })
    }))
    setGenResult((g) => ({ ...g, applied: true }))
  }

  // Copies debug fields for the current result. Never includes any API key.
  function copyDebugInfo() {
    if (!genResult) return
    const lines = [
      `request_id: ${genResult.request_id || '(none)'}`,
      `provider_id: ${genResult.provider_id || '(none)'}`,
      `action_type: ${genResult.action_type || '(none)'}`,
      `model: ${genResult.model || '(unknown)'}`,
      `status: ${genResult.message ? 'error' : 'success'}`,
      `error: ${genResult.message || '(none)'}`,
      `prompt_preview: ${preview(genResult.prompt_used, 500)}`,
      `output_preview: ${preview(genResult.output_text, 500)}`
    ]
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
  }

  function importApiJson() {
    if (!genResult || genResult.parsed_json === undefined) return
    const res = validateCanvasImport(genResult.parsed_json)
    if (!res.ok) {
      setGenResult((g) => ({ ...g, message: 'Validation failed: ' + res.errors.join('; ') }))
      return
    }
    onApplyCanvasImport(res.scenes, genResult.parsed_json)
    setGenResult((g) => ({ ...g, applied: true, message: '' }))
  }

  return (
    <section className="panel">
      <h2>Canvas — Competitor Recreation</h2>
      <p className="hint">Map the competitor ad into scenes, then adapt each to our product. No video is rendered here.</p>

      <div className="row view-toggle">
        <button className={view === 'list' ? 'primary small' : 'ghost small'} onClick={() => setView('list')}>
          List View
        </button>
        <button className={view === 'board' ? 'primary small' : 'ghost small'} onClick={() => setView('board')}>
          Board View
        </button>
      </div>

      {view === 'board' ? (
        <>
          <div className="subpanel">
            <div className="row between">
              <h3>Production Board</h3>
              <div className="row">
                <label className="field inline">
                  <span className="field-label">Provider Mode</span>
                  <select value={canvas.provider_mode || 'manual'} onChange={(e) => setProviderMode(e.target.value)}>
                    <option value="manual">Manual</option>
                    <option value="mock">Mock</option>
                    <option value="api">API</option>
                  </select>
                </label>
                {canvas.provider_mode === 'api' ? (
                  <label className="field inline">
                    <span className="field-label">API Provider</span>
                    <select value={apiProviderId} onChange={(e) => setApiProvider(e.target.value)}>
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </label>
                ) : null}
                <button className="primary small" onClick={buildBoard}>
                  Build Board From Scenes
                </button>
                <button className="ghost small" onClick={rebuildBoard} disabled={(board.nodes || []).length === 0}>
                  Rebuild Board From Scenes
                </button>
              </div>
            </div>
            <p className="hint small">Provider Mode: Manual copies prompts for your own tools; Mock fabricates test outputs; API uses your local backend (placeholder until provider wiring). No keys ever live in the browser.</p>
            {renderGenAllPrompts()}
            {canvas.provider_mode === 'api' ? (
              <div className="api-health">
                <div className="row between">
                  <strong>Local API Server</strong>
                  <div className="row">
                    <button className="ghost small" onClick={runApiTest} disabled={apiTest.loading}>
                      {apiTest.loading ? 'Testing…' : 'Test Selected API Provider'}
                    </button>
                    <button className="ghost small" onClick={refreshHealth} disabled={apiHealth.loading}>
                      {apiHealth.loading ? 'Checking…' : 'Refresh'}
                    </button>
                  </div>
                </div>
                <div className="bn-meta">
                  <span>{apiHealth.connected ? 'connected' : 'not connected'}</span>
                  <span>{apiBase()}</span>
                  <span>selected: {providerLabel(apiProviderId)}</span>
                  {apiHealth.checkedAt ? <span>last checked {apiHealth.checkedAt}</span> : null}
                </div>
                {apiHealth.connected ? (
                  <div className="bn-meta">
                    <span>OpenAI: {apiHealth.providers && apiHealth.providers.openai ? 'configured' : 'not configured'}{apiHealth.openaiModel ? ` (${apiHealth.openaiModel})` : ''}</span>
                    <span>OpenAI image: {apiHealth.openaiImageConfigured ? 'configured' : 'not configured'}{apiHealth.openaiImageModel ? ` (${apiHealth.openaiImageModel})` : ''}</span>
                    <span>OpenRouter: {apiHealth.providers && apiHealth.providers.openrouter ? 'configured' : 'not configured'}{apiHealth.openrouterModel ? ` (${apiHealth.openrouterModel})` : ''}</span>
                  </div>
                ) : null}
                {!apiHealth.connected ? (
                  <div className="note bad">API mode is selected, but the local backend is not connected. Run npm run dev:server or npm run dev:all.</div>
                ) : null}
                {apiHealth.connected && !selectedConfigured ? (
                  <div className="note bad">{providerLabel(apiProviderId)} is selected but not configured. Add {apiProviderId === 'openrouter' ? 'OPENROUTER_API_KEY (and OPENROUTER_MODEL)' : 'OPENAI_API_KEY'} to .env.local and restart the backend, or switch the API Provider.</div>
                ) : null}
                <p className="hint small">Image generation is intentionally manual: bring images in via Import from Flow below — this is not an error or a pending API.</p>
                {apiHealth.error ? <p className="hint small">Last error: {apiHealth.error}</p> : null}
                {apiTest.text ? <div className="note ok">Test ({providerLabel(apiProviderId)}): {apiTest.text}</div> : null}
                {apiTest.error ? <div className="note bad">Test ({providerLabel(apiProviderId)}): {apiTest.error}</div> : null}
              </div>
            ) : null}
            {toolMsg ? <div className="note ok">{toolMsg}</div> : null}
            {(board.nodes || []).length === 0 ? (
              <p className="hint">No board yet. Click "Build Board From Scenes" to generate one from the {scenes.length} scene(s).</p>
            ) : (
              <CanvasBoard
                board={board}
                scenes={scenes}
                assets={assets}
                previews={previews}
                onUpdateNode={updateBoardNode}
                onAddVariation={addVariation}
                onUpdateVariation={updateVariation}
                onSelectVariation={selectVariation}
                onRemoveVariation={removeVariation}
                onReplaceVariation={replaceVariationFile}
                onReorderVariation={reorderVariation}
                onGenerate={runGeneration}
                onAddExistingResult={(sceneId) => setAddResultScene(sceneId)}
              />
            )}
          </div>

          <FlowImport scenes={scenes} onAttach={(sceneId, fields) => addGeneratedVariation(sceneId, fields)} />

          <AssetTray assets={assets} scenes={scenes} previews={previews} onAdd={addAsset} onUpdate={updateAsset} onRemove={removeAsset} onUploadPreview={onSetPreview} />

          <MediaCleanup scenes={scenes} />

          <div className="subpanel">
            <div className="row between">
              <h3>
                <button className="ghost small caret" onClick={() => setLogOpen((v) => !v)} title={logOpen ? 'Collapse' : 'Expand'}>
                  {logOpen ? '▾' : '▸'}
                </button>{' '}
                API Action Log ({actionLog.length})
              </h3>
              {actionLog.length > 0 ? (
                <button className="ghost small" onClick={() => setActionLog([])}>
                  Clear log
                </button>
              ) : null}
            </div>
            <p className="hint small">Session-only record of API calls (newest first). Cleared on reload. No API keys are stored.</p>
            {logOpen ? (
              actionLog.length === 0 ? (
                <p className="hint">No API calls yet this session.</p>
              ) : (
                <div className="action-log">
                  {actionLog.map((l) => (
                    <div key={l.id} className={l.status === 'success' ? 'log-item ok' : 'log-item bad'}>
                      <div className="bn-meta">
                        <span>{l.timestamp}</span>
                        <span className={l.status === 'success' ? 'badge ok' : 'badge bad'}>{l.status}</span>
                        <span>{l.provider_id || '(provider?)'}</span>
                        <span>{l.action_type}</span>
                        {l.model ? <span>model {l.model}</span> : null}
                        {l.scene_number ? <span>Scene {l.scene_number}</span> : null}
                        {l.request_id ? <span>req {l.request_id}</span> : null}
                      </div>
                      {l.prompt_preview ? <p className="hint small">prompt: {l.prompt_preview}</p> : null}
                      {l.output_preview ? <p className="hint small">output: {l.output_preview}</p> : null}
                      {l.error ? <div className="note bad">{l.error}</div> : null}
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </div>

          <div className="subpanel">
            <h3>Final Timeline</h3>
            {(() => {
              const gaps = findSceneGaps(scenes)
              const reasonLabel = (r) => (r === 'no_variations' ? 'no variations' : r === 'no_selection' ? 'no selected variation' : r)
              if (scenes.length === 0) return null
              return gaps.length === 0 ? (
                <div className="note ok">All scenes have a selected variation — timeline is complete.</div>
              ) : (
                <div className="note bad">
                  <strong>⚠️ {gaps.length} scene(s) not export-ready (not shown in the timeline below):</strong>
                  <ul className="missing-list">
                    {gaps.map((g) => (
                      <li key={g.scene_id}>
                        Scene {g.scene_number}: {reasonLabel(g.reason)}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })()}
            {finalTimeline.length === 0 ? (
              <p className="hint">No selected output yet.</p>
            ) : (
              <div className="final-timeline">
                {finalTimeline.map(({ s, v }) => (
                  <div
                    key={s.id}
                    className="timeline-item"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      handleSceneDrop(s.id)
                    }}
                  >
                    <span
                      className="drag-handle"
                      draggable
                      title="Drag to reorder this scene in the timeline"
                      style={{ cursor: 'grab', userSelect: 'none', marginRight: '6px' }}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        try {
                          e.dataTransfer.setData('text/plain', s.id)
                        } catch {
                          /* some browsers restrict setData; not required */
                        }
                        handleSceneDragStart(s.id)
                      }}
                    >
                      ⠿
                    </span>
                    <strong>Scene {s.scene_number}</strong>
                    <span className="hint small">
                      {s.timestamp_start || '?'}–{s.timestamp_end || '?'}
                    </span>
                    <label className="field inline">
                      <span className="field-label">Duration (s)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        style={{ width: '5em' }}
                        value={s.duration_seconds || 0}
                        onChange={(e) => setSceneDuration(s.id, e.target.value)}
                      />
                    </label>
                    <span>Variation {v.label}</span>
                    {v.provider ? <span className="badge">{providerName(v.provider)}</span> : null}
                    {v.local_url ? <span className="badge">local disk</span> : null}
                    {previews[v.id] || v.external_url || v.local_url ? <MediaPreview url={v.external_url} preview={previews[v.id]} local={v.local_url} /> : null}
                    {v.local_url && v.file_name ? <span className="hint small">{v.file_name} (local file)</span> : null}
                    {v.file_name && !v.external_url && !v.local_url ? <span className="hint small">{v.file_name} (session-only)</span> : null}
                    {v.notes ? <span className="hint small">{v.notes}</span> : null}
                  </div>
                ))}
                {(() => {
                  const summed = sumSceneDurations(finalTimeline.map((x) => x.s))
                  const declared = parseDeclaredSeconds((project.product_intake || {}).ad_duration)
                  const st = declared != null ? durationStatus(declared, summed) : null
                  return (
                    <div className="timeline-total note">
                      <strong>Total duration: {summed}s</strong>
                      {st ? (
                        <>
                          {' '}— declared {st.declared}s · difference {st.difference > 0 ? '+' : ''}
                          {st.difference}s{' '}
                          <span className={st.status === 'valid' ? 'media-health health-ok' : 'media-health health-warn'}>{st.status === 'valid' ? 'Valid' : 'Mismatch'}</span>
                        </>
                      ) : (
                        <span className="hint small"> (no declared ad length set — add one in the Product / Offer Brief to compare)</span>
                      )}
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="subpanel">
            <div className="row between">
              <h3>Competitor Reference</h3>
          <button className="ghost small" onClick={onLoadExample}>
            Load Competitor Canvas Example
          </button>
        </div>
        <div className="fields">
          {REFERENCE_FIELDS.map((f) => (
            <label key={f.key} className="field">
              <span className="field-label">{f.label}</span>
              {f.textarea ? (
                <textarea rows={2} value={ref[f.key] || ''} onChange={(e) => setRef(f.key, e.target.value)} />
              ) : (
                <input type="text" value={ref[f.key] || ''} onChange={(e) => setRef(f.key, e.target.value)} />
              )}
            </label>
          ))}
        </div>
      </div>

      <div className="subpanel">
        <h3>Model Defaults (manual for now)</h3>
        <div className="provider-defaults">
          {DEFAULT_FIELDS.map(([k, label]) => (
            <label key={k} className="field">
              <span className="field-label">{label}</span>
              <ProviderSelect value={defaults[k]} onChange={(v) => setDefault(k, v)} />
            </label>
          ))}
        </div>
        <p className="hint small">Voice and music defaults are reserved for future voice/music generation and are not used yet.</p>
        <div className="row">
          <button className="ghost small" onClick={applyDefaultsToAll} disabled={scenes.length === 0}>
            Apply Defaults To All Scenes
          </button>
          <button className="ghost small" onClick={clearOverrides} disabled={scenes.length === 0}>
            Clear Scene Provider Overrides
          </button>
        </div>
      </div>

      <div className="subpanel">
        <h3>Quick Add From Outline</h3>
        <p className="hint small">
          Paste timestamped lines, e.g. <code>0:00-0:03 Hook: creator opens fridge</code>. Each line becomes a scene
          (timestamps, what happens, and scene type from a leading label).
        </p>
        <textarea
          className="stage-text short"
          value={outline}
          placeholder={'0:00-0:03 Hook: creator opens fridge and sees snack temptation\n0:03-0:07 Problem: she looks frustrated after training\n0:07-0:12 Product reveal: ritual drink appears on counter'}
          onChange={(e) => {
            setOutline(e.target.value)
            setOutlineMsg('')
          }}
        />
        {outlineMsg ? <div className="note ok">{outlineMsg}</div> : null}
        <div className="row">
          <button className="primary" onClick={() => createFromOutline('append')} disabled={!outline.trim()}>
            Create Scenes From Outline
          </button>
          <button className="ghost" onClick={() => createFromOutline('replace')} disabled={!outline.trim()}>
            Replace existing scenes
          </button>
        </div>
      </div>

      <div className="subpanel">
        <div className="row between">
          <h3>Scene Board ({scenes.length})</h3>
          <div className="row">
            {scenes.length > 0 ? (
              <>
                <button className="ghost small" onClick={() => setAllCollapsed(true)}>
                  Collapse all
                </button>
                <button className="ghost small" onClick={() => setAllCollapsed(false)}>
                  Expand all
                </button>
              </>
            ) : null}
            <button className="primary small" onClick={addScene}>
              + Add Scene
            </button>
          </div>
        </div>
        {scenes.length === 0 ? <p className="hint">No scenes yet. Add a scene to start mapping the competitor ad.</p> : null}

        {scenes.map((s, i) => {
          const open = !isCollapsed(s.id)
          return (
            <div key={s.id} className={open ? 'scene-card' : 'scene-card collapsed'}>
              <div className="clip-head">
                <div className="scene-head-left">
                  <button className="ghost small caret" onClick={() => toggleCollapse(s.id)} title={open ? 'Collapse' : 'Expand'}>
                    {open ? '▾' : '▸'}
                  </button>
                  <h4>Scene {s.scene_number}</h4>
                  {!open ? (
                    <span className="scene-summary">
                      {s.scene_type ? `[${s.scene_type}] ` : ''}
                      {(s.timestamp_start || '?')}–{(s.timestamp_end || '?')} · {summary(s)}
                    </span>
                  ) : null}
                </div>
                <div className="clip-head-right">
                  <button className="ghost small" onClick={() => moveScene(i, -1)} disabled={i === 0}>
                    ↑
                  </button>
                  <button className="ghost small" onClick={() => moveScene(i, 1)} disabled={i === scenes.length - 1}>
                    ↓
                  </button>
                  <button className="ghost small" onClick={() => duplicateScene(i)}>
                    Duplicate
                  </button>
                  <button className="ghost small" onClick={() => deleteScene(i)}>
                    Delete
                  </button>
                </div>
              </div>

              {open ? (
                <>
                  <div className="scene-image">
                    {previews[s.id] ? (
                      <img src={previews[s.id]} alt={`Scene ${s.scene_number}`} />
                    ) : s.image_name ? (
                      <div className="hint small">Uploaded: {s.image_name} (preview not kept across reloads)</div>
                    ) : (
                      <div className="hint small">No screenshot</div>
                    )}
                    <input type="file" accept="image/*" onChange={(e) => uploadImage(i, s, e.target.files && e.target.files[0])} />
                  </div>

                  <div className="scene-fields">
                    <label className="field">
                      <span className="field-label">Scene type</span>
                      <select value={s.scene_type || ''} onChange={(e) => updateScene(i, presetPrefillPatch(s, e.target.value))}>
                        <option value="">(none)</option>
                        {SCENE_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    {SCENE_FIELDS.map((f) => (
                      <label key={f.key} className="field">
                        <span className="field-label">{f.label}</span>
                        {f.type === 'textarea' ? (
                          <textarea rows={2} value={s[f.key] || ''} onChange={(e) => updateScene(i, { [f.key]: e.target.value })} />
                        ) : (
                          <input type="text" value={s[f.key] || ''} onChange={(e) => updateScene(i, { [f.key]: e.target.value })} />
                        )}
                      </label>
                    ))}
                  </div>

                  <div className="scene-providers">
                    <label className="field">
                      <span className="field-label">LLM provider</span>
                      <ProviderSelect value={s.llm_provider} onChange={(v) => updateScene(i, { llm_provider: v })} />
                    </label>
                    <label className="field">
                      <span className="field-label">Image provider</span>
                      <ProviderSelect value={s.image_provider} onChange={(v) => updateScene(i, { image_provider: v })} />
                    </label>
                    <label className="field">
                      <span className="field-label">Video provider</span>
                      <ProviderSelect value={s.video_provider} onChange={(v) => updateScene(i, { video_provider: v })} />
                    </label>
                  </div>

                  <div className="row api-actions">
                    <button className="ghost small" onClick={() => improveScenePrompt(s)} disabled={!isApiMode}>
                      Improve Output Prompt with API
                    </button>
                    <span className="hint small">Uses OpenAI API credits.{!isApiMode ? ' Set Provider Mode to API (Board View).' : ''}</span>
                  </div>
                </>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="subpanel">
        <h3>Canvas Readiness</h3>
        <p className="hint small">What’s still missing before you generate/export. This does not block editing.</p>
        <ul className="readiness-list">
          {canvasReadiness(project).map((c) => (
            <li key={c.id} className={c.ok ? 'ready-ok' : 'ready-missing'}>
              {c.ok ? '✓' : '✗'} {c.label}
              {c.detail ? <span className="hint small"> — {c.detail}</span> : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="subpanel">
        <h3>Prepare Export</h3>
        <p className="hint small">No AI. Final Export auto-syncs the Canvas, so the manual Sync button is optional. Skeletons fill only empty output prompts.</p>
        {scenes.length > 0 && scenes.some((s) => !String(s.output_prompt || '').trim() && !String(s.adaptation_instruction_for_our_product || '').trim()) ? (
          <div className="note">Some scenes have no prompt/adaptation content. Export will include empty sections.</div>
        ) : null}
        <div className="row">
          <button className="ghost" onClick={generateSkeletons} disabled={scenes.length === 0}>
            Generate Scene Prompt Skeletons
          </button>
          <button className="ghost" onClick={syncExport} disabled={scenes.length === 0}>
            Sync Canvas To Export Data
          </button>
          <button className="ghost" onClick={improveEmptyPrompts} disabled={scenes.length === 0 || !isApiMode}>
            Improve Empty Prompts with API
          </button>
        </div>
        <p className="hint small">Improve Empty Prompts with API writes production prompts for empty scenes (preview + approve). Uses OpenAI API credits.{!isApiMode ? ' Set Provider Mode to API (Board View) to enable.' : ''}</p>
        <p className="hint small">Or one-click fill every scene’s prompt directly:</p>
        {renderGenAllPrompts()}
        {toolMsg ? <div className="note ok">{toolMsg}</div> : null}
      </div>

      <div className="subpanel">
        <h3>Ad Brief — Decode a Competitor /watch Breakdown</h3>
        <p className="hint small">
          Paste the <code>/watch</code> frame-by-frame breakdown + transcript of a competitor video. OpenAI decodes its structure
          and writes an adapted script + REAL shot-by-shot prompts into the scenes below — using your existing Brand Library and
          Product / Offer Brief (no need to re-enter them). Prompts default to short-form vertical (9:16) UGC. Tip: run
          <code>/watch</code> with <code>--scene-threshold ~0.2</code> for soft-cut UGC sources. Uses OpenAI API credits (text/JSON only).
        </p>
        <textarea
          className="stage-text"
          value={adBriefInput}
          placeholder="Paste /watch output here (timestamped frame-by-frame breakdown + transcript)…"
          onChange={(e) => {
            setAdBriefInput(e.target.value)
            setAdBriefMsg('')
          }}
        />
        <div className="api-actions" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <button className="primary small" onClick={generateAdBrief} disabled={adBriefBusy || !isApiMode || !adBriefInput.trim()}>
            {adBriefBusy ? 'Generating…' : 'Generate Ad Brief'}
          </button>
          <label className="row" style={{ alignItems: 'center', gap: '4px' }}>
            <input type="checkbox" checked={adBriefOverwrite} onChange={(e) => setAdBriefOverwrite(e.target.checked)} />
            <span className="hint small">overwrite existing scenes</span>
          </label>
          <span className="hint small">Writes into the existing scenes by scene_number; fills empty scenes by default.{!isApiMode ? ' Set Provider Mode to API (Board View) to enable.' : ''}</span>
        </div>
        {adBriefMsg ? <div className="note">{adBriefMsg}</div> : null}
        {(adBrief.decoded_structure && adBrief.decoded_structure.length) || String(adBrief.adapted_script || '').trim() || (adBrief.dont_copy && adBrief.dont_copy.length) || (adBrief.preserve && adBrief.preserve.length) ? (
          <div className="ad-brief-view">
            {adBrief.decoded_structure && adBrief.decoded_structure.length ? (
              <>
                <h4>Decoded structure</h4>
                <ul className="readiness-list">
                  {adBrief.decoded_structure.map((b, i) => (
                    <li key={i}>
                      <strong>{b.beat_name || `Beat ${i + 1}`}</strong>
                      {b.timestamp_range ? ` (${b.timestamp_range})` : ''}
                      {b.what_competitor_does ? ` — ${b.what_competitor_does}` : ''}
                      {b.why_it_works ? <span className="hint small"> · why: {b.why_it_works}</span> : null}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {String(adBrief.adapted_script || '').trim() ? (
              <>
                <h4>Adapted script</h4>
                <pre className="prompt-preview">{adBrief.adapted_script}</pre>
              </>
            ) : null}
            {adBrief.dont_copy && adBrief.dont_copy.length ? (
              <p className="hint small">
                <strong>Don’t copy:</strong> {adBrief.dont_copy.join('; ')}
              </p>
            ) : null}
            {adBrief.preserve && adBrief.preserve.length ? (
              <p className="hint small">
                <strong>Preserve:</strong> {adBrief.preserve.join('; ')}
              </p>
            ) : null}
            {adBrief.generated_at ? (
              <p className="hint small">
                Generated {new Date(adBrief.generated_at).toLocaleString()}
                {adBrief.model ? ` · ${adBrief.model}` : ''}
                {adBrief.request_id ? ` · req ${adBrief.request_id}` : ''}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="subpanel">
        <h3>Generate Adaptation</h3>
        <p className="hint small">Builds one prompt (brand docs, brief, script, competitor reference, scenes, providers) to paste into any AI. No API call.</p>
        <div className="row">
          <button className="primary" onClick={openPromptModal}>
            {copied ? 'Copied ✓' : 'Generate Adaptation Prompt'}
          </button>
          <button className="primary" onClick={generateAdaptedJson} disabled={!isApiMode}>
            Generate Adapted Canvas JSON with API
          </button>
        </div>
        <p className="hint small">Generate Adapted Canvas JSON with API sends the same prompt to OpenAI and returns JSON you can preview and import. Uses OpenAI API credits.{!isApiMode ? ' Set Provider Mode to API (Board View) to enable.' : ''}</p>
      </div>

      <div className="subpanel">
        <h3>Import Adapted Canvas JSON</h3>
        <p className="hint small">Paste the AI’s JSON. It updates the scenes and competitor method data; it does not touch brand docs or the brief.</p>
        <textarea className="stage-text short" value={paste} placeholder="Paste adapted canvas JSON here..." onChange={(e) => { setPaste(e.target.value); setImportErrors([]); setImported(false) }} />
        {importErrors.length > 0 ? (
          <div className="note bad">
            {importErrors.map((er, idx) => (
              <div key={idx}>{er}</div>
            ))}
          </div>
        ) : null}
        {imported ? <div className="note ok">Imported — scenes updated.</div> : null}
        <div className="row">
          <button className="primary" onClick={doImport} disabled={!paste.trim()}>
            Import Adapted Canvas JSON
          </button>
          {importErrors.length > 0 ? (
            <button className="ghost" onClick={copyRepair}>
              {repairCopied ? 'Repair prompt copied ✓' : 'Copy Repair Prompt'}
            </button>
          ) : null}
          {importErrors.length > 0 && isApiMode ? (
            <button className="ghost" onClick={repairCanvasJsonWithApi}>
              Repair JSON with API
            </button>
          ) : null}
        </div>
        {importErrors.length > 0 && isApiMode ? <p className="hint small">Repair JSON with API sends the invalid JSON + errors to OpenAI and returns repaired JSON to preview/import. Uses OpenAI API credits.</p> : null}
      </div>
        </>
      )}

      {addResultScene ? (
        <AddResultModal
          sceneNumber={(scenes.find((s) => s.id === addResultScene) || {}).scene_number}
          onSave={(fields, file, saveLocal) => addExistingResult(addResultScene, fields, file, saveLocal)}
          onClose={() => setAddResultScene(null)}
        />
      ) : null}

      {genResult && genResult.open ? (
        <div className="modal-overlay" onClick={() => setGenResult(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{genResult.kind ? 'API Result Preview' : 'Generation Result'}</h3>
              <button className="ghost small" onClick={() => setGenResult(null)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <div className="bn-meta">
                <span>Provider: {genResult.provider_id ? providerName(genResult.provider_id) : '(none)'}</span>
                <span>Mode/source: {genResult.result ? genResult.result.source_type : genResult.mode}</span>
                <span>Action: {genResult.action_type}</span>
                {genResult.result ? <span>Media: {genResult.result.media_type}</span> : null}
                {genResult.result ? <span>Status: {genResult.result.status}</span> : null}
                {genResult.model || (genResult.result && genResult.result.model) ? <span>Model: {genResult.model || genResult.result.model}</span> : null}
                {genResult.scene_number ? <span>Scene {genResult.scene_number}</span> : null}
                {genResult.request_id || (genResult.result && genResult.result.request_id) ? <span>Request: {genResult.request_id || genResult.result.request_id}</span> : null}
              </div>
              {genResult.result && (genResult.result.local_url || genResult.result.external_url || genResult.result.data_url) ? (
                <>
                  <MediaPreview url={genResult.result.external_url} preview={genResult.result.data_url} local={genResult.result.local_url} />
                  <div className="media-health">{getMediaResultHealth(genResult.result)}</div>
                </>
              ) : null}
              {genResult.loading ? <div className="note">Calling OpenAI… this uses API credits.</div> : null}
              <p className="hint small">Prompt sent</p>
              <pre className="prompt-preview">{genResult.prompt_used || '(empty)'}</pre>
              {genResult.output_text ? (
                <>
                  <p className="hint small">Output</p>
                  <pre className="prompt-preview">{genResult.output_text}</pre>
                </>
              ) : null}
              {genResult.output_url ? <div className="note ok">Output URL: {genResult.output_url}</div> : null}
              {genResult.parsed_json !== undefined ? (
                <>
                  <p className="hint small">Parsed JSON ✓ (preview only — not applied)</p>
                  <pre className="prompt-preview">{JSON.stringify(genResult.parsed_json, null, 2)}</pre>
                </>
              ) : null}
              {genResult.parse_error ? <div className="note bad">JSON parse error: {genResult.parse_error}</div> : null}
              {genResult.unsupported ? <div className="note bad">{genResult.message}</div> : null}
              {!genResult.unsupported && genResult.mode === 'api' && genResult.message ? <div className="note bad">{genResult.message}</div> : null}

              {(genResult.mode === 'manual' || (genResult.mode === 'api' && !genResult.unsupported)) && !genResult.kind ? (
                <>
                  <label className="field">
                    <span className="field-label">Result URL (paste your generated result)</span>
                    <input type="text" placeholder="Result URL" value={genResult.manualUrl} onChange={(e) => setGenResult({ ...genResult, manualUrl: e.target.value })} />
                  </label>
                  <label className="field">
                    <span className="field-label">Result type</span>
                    <select value={genResult.manualType} onChange={(e) => setGenResult({ ...genResult, manualType: e.target.value })}>
                      <option value="image">image</option>
                      <option value="video">video</option>
                      <option value="prompt">prompt</option>
                      <option value="other">other</option>
                    </select>
                  </label>
                  <label className="field">
                    <span className="field-label">Result notes</span>
                    <input type="text" placeholder="Result notes" value={genResult.manualNotes} onChange={(e) => setGenResult({ ...genResult, manualNotes: e.target.value })} />
                  </label>
                </>
              ) : null}
              {genResult.attached ? <div className="note ok">Added as a variation on Scene {genResult.scene_number}.</div> : null}
              {genResult.applied ? <div className="note ok">Applied to your canvas. Review and adjust as needed — nothing else was overwritten.</div> : null}

              <div className="row">
                <button className="primary" onClick={() => navigator.clipboard.writeText(genResult.prompt_used || '').catch(() => {})}>
                  Copy Prompt
                </button>
                {genResult.output_text ? (
                  <button className="ghost" onClick={() => navigator.clipboard.writeText(genResult.output_text || '').catch(() => {})}>
                    Copy Output
                  </button>
                ) : null}
                {genResult.mode === 'api' && !genResult.unsupported ? (
                  <button className="ghost" onClick={copyDebugInfo}>
                    Copy Debug Info
                  </button>
                ) : null}
                {genResult.kind === 'scene_prompt' && !genResult.applied && genResult.output_text ? (
                  <button className="primary" onClick={applyScenePrompt}>
                    Apply to scene
                  </button>
                ) : null}
                {genResult.kind === 'empty_prompts' && !genResult.applied && genResult.parsed_json !== undefined ? (
                  <button className="primary" onClick={applyEmptyPrompts}>
                    Apply Prompts To Empty Scenes
                  </button>
                ) : null}
                {(genResult.kind === 'canvas_json' || genResult.kind === 'repair_json') && !genResult.applied && genResult.parsed_json !== undefined ? (
                  <button className="primary" onClick={importApiJson}>
                    Import JSON
                  </button>
                ) : null}
                {!genResult.kind && genResult.result && isMediaResultAttachable(genResult.result) && !genResult.attached ? (
                  <button className="primary" onClick={addResultAsVariation}>
                    Add As Scene Variation
                  </button>
                ) : null}
                {!genResult.kind && genResult.result && isMediaResultSaveable(genResult.result) ? (
                  <button className="ghost" onClick={saveResultToLocal}>
                    Save To Local Media Library
                  </button>
                ) : null}
                <button className="ghost" onClick={() => setGenResult(null)}>
                  {(genResult.kind && !genResult.applied) || (genResult.result && isMediaResultAttachable(genResult.result) && !genResult.attached) ? 'Cancel' : 'Close'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {apiConfirm ? (
        <div className="modal-overlay" onClick={() => setApiConfirm(null)}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Use OpenAI API credits?</h3>
              <button className="ghost small" onClick={() => setApiConfirm(null)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <p>{apiConfirm.message || 'This will use OpenAI API credits. Continue?'}</p>
              <div className="row">
                <button
                  className="primary"
                  onClick={() => {
                    const run = apiConfirm.run
                    setApiConfirm(null)
                    if (run) run()
                  }}
                >
                  Continue
                </button>
                <button className="ghost" onClick={() => setApiConfirm(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {promptModal ? (
        <div className="modal-overlay" onClick={() => setPromptModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Adaptation Prompt</h3>
              <button className="ghost small" onClick={() => setPromptModal(false)}>
                Close
              </button>
            </div>
            <div className="modal-body">
              <p className="hint small">Check that brand docs, product/offer brief, competitor reference, scenes, and providers are included.</p>
              <pre className="prompt-preview">{buildCanvasPrompt(project)}</pre>
              <div className="row">
                <button className="primary" onClick={copyPrompt}>
                  {copied ? 'Copied ✓' : 'Copy Prompt'}
                </button>
                <button className="ghost" onClick={() => setPromptModal(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
