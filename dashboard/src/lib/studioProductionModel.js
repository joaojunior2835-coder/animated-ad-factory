// Local Studio drafting. These presets never call a model or invent product claims.
export const STUDIO_PRESETS = [
  { id: 'product_portrait', name: 'Portrait produit', category: 'Produit', description: 'Une présentation nette, une matière, une signature.', tone: 'portrait', shots: ['Présentation du produit sur une surface simple, lumière douce, lent rapprochement de caméra.', 'Gros plan sur un détail réellement visible du produit. Mouvement de caméra discret.', 'Vue finale du produit entier, composition stable et espace libre autour du produit.'] },
  { id: 'daily_ritual', name: 'Rituel quotidien', category: 'Lifestyle', description: 'Le produit dans un cadre simple et naturel.', tone: 'ritual', shots: ['Le produit posé dans un environnement quotidien sobre, lumière naturelle.', 'Approche lente vers le produit. Montrer uniquement ses caractéristiques visibles.', 'Plan large calme, le produit reste le sujet principal. Aucun résultat avant/après.'] },
  { id: 'material_study', name: 'Étude de matière', category: 'Produit', description: 'Détails, lumière et texture en deux plans.', tone: 'material', shots: ['Plan rapproché du produit. La lumière révèle ses matières sans transformer son emballage.', 'Retour au produit entier, mouvement latéral lent et arrière-plan discret.'] },
  { id: 'single_hero', name: 'Un plan, une idée', category: 'Court', description: 'Un seul clip pour tester une direction visuelle.', tone: 'hero', shots: ['Un plan héro du produit entier. Mouvement de caméra lent, fond sobre et lumière latérale.'] },
]

const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null
const cleanString = (value, fallback = '') => typeof value === 'string' ? value : fallback

export function emptyStudioProduction() {
  return { templateId: 'product_portrait', productTestId: null, creativeId: null, newCreative: false, productAssetId: null, modelId: '', resolution: '480p', aspectRatio: '9:16', generateAudio: false, scenes: [], sceneLinks: {} }
}

export function normalizeStudioProduction(value) {
  const base = emptyStudioProduction(), p = value && typeof value === 'object' ? value : {}
  return {
    ...base,
    templateId: STUDIO_PRESETS.some(t => t.id === p.templateId) ? p.templateId : base.templateId,
    productTestId: positiveId(p.productTestId), creativeId: positiveId(p.creativeId), newCreative: p.newCreative === true, productAssetId: positiveId(p.productAssetId),
    modelId: cleanString(p.modelId), resolution: cleanString(p.resolution, base.resolution), aspectRatio: cleanString(p.aspectRatio, base.aspectRatio), generateAudio: p.generateAudio === true,
    scenes: Array.isArray(p.scenes) ? p.scenes.slice(0, 12).map((s, i) => ({ id: cleanString(s?.id, `studio-scene-${i + 1}`), name: cleanString(s?.name, `Scène ${i + 1}`), visualDescription: cleanString(s?.visualDescription), script: cleanString(s?.script), scriptLocked: s?.scriptLocked === true, seconds: Number.isInteger(s?.seconds) ? s.seconds : 5 })) : [],
    sceneLinks: p.sceneLinks && typeof p.sceneLinks === 'object' && !Array.isArray(p.sceneLinks) ? Object.fromEntries(Object.entries(p.sceneLinks).filter(([k, v]) => typeof k === 'string' && typeof v === 'string')) : {},
  }
}

export function proposeStudioScenes(templateId, language = 'fr') {
  const preset = STUDIO_PRESETS.find(p => p.id === templateId) || STUDIO_PRESETS[0]
  return preset.shots.map((shot, i) => ({ id: `${preset.id}-${i + 1}`, name: `${language === 'en' ? 'Scene' : 'Scène'} ${i + 1}`, visualDescription: shot, script: '', scriptLocked: false, seconds: 5 }))
}

// Imported approved dialogue remains a verbatim editable source, including whitespace.
export function importStudioScenes(scenes) {
  return (Array.isArray(scenes) ? scenes : []).slice(0, 12).map((s, i) => ({ id: `imported-${s.sceneNumber || i + 1}`, name: s.purpose || `Scène ${i + 1}`, visualDescription: cleanString(s.visualDescription), script: cleanString(s.dialogueLine), scriptLocked: Boolean(s.scriptLocked || s.locked || s.approved), seconds: Math.max(4, Math.min(15, Number(s.clipDuration) || 5)) }))
}

export function buildStudioGenerationScene(scene, studio, capability) {
  const p = normalizeStudioProduction(studio.production)
  if (!capability || !capability.configured || !capability.priced || capability.capability !== 'generate_video') throw new Error('Choisissez un modèle vidéo configuré et tarifé.')
  const mode = p.productAssetId ? 'image-to-video' : 'text-to-video'
  if (!capability.modes?.includes(mode)) throw new Error('Ce modèle ne prend pas en charge la photo produit. Choisissez un modèle image vers vidéo.')
  if (!capability.aspects?.includes(p.aspectRatio) || !capability.resolutions?.includes(p.resolution) || !capability.durations?.includes(scene.seconds)) throw new Error('Les réglages ne correspondent plus au modèle. Vérifiez format, résolution et durée.')
  if (p.generateAudio && !capability.audio) throw new Error('Ce modèle ne prend pas en charge la génération audio.')
  if (!scene.visualDescription.trim()) throw new Error('Ajoutez une instruction visuelle à chaque scène.')
  if (!studio.product?.name?.trim() || !studio.product?.description?.trim()) throw new Error('Renseignez le nom et les faits produit.')
  const language = studio.brief?.language === 'en' ? 'English' : 'French'
  const prompt = [
    `Product: ${studio.product.name}. Supplied product facts: ${studio.product.description}.`,
    p.productAssetId ? 'Use the attached product photograph as the starting image. Preserve its visible design and packaging as guidance; do not invent additional product features.' : 'Visual concept without a product reference. Exact product identity is not specified by an image.',
    scene.visualDescription,
    studio.brief?.hook ? `Creative direction supplied by the operator: ${studio.brief.hook}` : '',
    studio.product.claimBoundary ? `Claim boundaries: ${studio.product.claimBoundary}` : '',
    'Do not invent performance claims, statistics, testimonials, before/after results or text on the packaging.',
    p.generateAudio && scene.script ? `Speak the following ${language} script exactly, without rewriting:\n${scene.script}\n[End of exact operator script]` : 'No dialogue, narration or music. Silent visual clip.',
  ].filter(Boolean).join('\n\n')
  if (prompt.length > 6000) throw new Error('La scène dépasse la limite de 6 000 caractères. Raccourcissez les instructions visuelles ou le brief; le script reste inchangé.')
  return { name: scene.name, prompt, provider: capability.provider, mode, seconds: scene.seconds, resolution: p.resolution, aspectRatio: p.aspectRatio, generateAudio: p.generateAudio, startAssetId: p.productAssetId, quantity: 1 }
}

export function studioSceneSignature(scene) {
  return JSON.stringify([...['name', 'prompt', 'provider', 'mode', 'seconds', 'resolution', 'aspectRatio', 'generateAudio', 'startAssetId'].map(k => scene[k] ?? null), scene.quantity ?? 1])
}

export function savedStudioGeneratorScene(scene) {
  const common = { id: scene.id, name: scene.name, prompt: scene.prompt, provider: scene.provider, mode: scene.mode }
  if (scene.kind === 'image') return { ...common, kind: scene.kind, model: scene.model, imageSize: scene.imageSize, outputFormat: scene.outputFormat, quantity: scene.quantity }
  return { ...common, seconds: scene.seconds, resolution: scene.resolution, aspectRatio: scene.aspectRatio, generateAudio: scene.generateAudio, startAssetId: scene.startAssetId, quantity: scene.quantity ?? 1, ...(scene.remix ? { remix: scene.remix } : {}) }
}

export function prepareStudioSceneSave(workspace, draftScenes, compiled, links = {}) {
  if (draftScenes.length !== new Set(draftScenes.map(s => s.id)).size) throw new Error('Les identifiants des scènes doivent être uniques.')
  const next = workspace.scenes.map(s => ({ ...s })), indices = []
  for (const [i, scene] of draftScenes.entries()) {
    const mappedId = links[scene.id]
    const index = typeof mappedId === 'string' && mappedId ? next.findIndex(s => s.id === mappedId) : -1
    if (index < 0) { indices.push(next.length); next.push(compiled[i]); continue }
    const prior = workspace.scenes[index], changed = studioSceneSignature(prior) !== studioSceneSignature(compiled[i])
    if (changed && (prior.approved || ['Queued', 'Generating', 'Reconciliation required'].includes(prior.status))) throw new Error(`« ${scene.name} » est approuvée ou en cours. Créez une variation dans un nouveau Creative pour conserver cette version.`)
    indices.push(index); next[index] = { ...next[index], ...compiled[i] }
  }
  if (next.length > 12) throw new Error('Ce Creative dépasserait 12 scènes. Choisissez un nouveau Creative pour cette proposition.')
  return { scenes: next, indices, changed: next.length !== workspace.scenes.length || next.some((s, i) => !workspace.scenes[i] || studioSceneSignature(s) !== studioSceneSignature(workspace.scenes[i])) }
}

export function studioCanvasPayload(studio, liveScenes = [], capability) {
  const p = normalizeStudioProduction(studio.production)
  return { source: 'marketing_studio', creativeId: p.creativeId, productTestId: p.productTestId, productAssetId: p.productAssetId, modelId: p.modelId, resolution: p.resolution, aspectRatio: p.aspectRatio, generateAudio: p.generateAudio, language: studio.brief?.language === 'en' ? 'en' : 'fr', scenes: p.scenes.map((s, i) => {
    const live = liveScenes.find(v => v.id === p.sceneLinks[s.id])
    let compiled = null
    try { compiled = buildStudioGenerationScene(s, studio, capability) } catch { /* Incomplete drafts can still be opened in Canvas. */ }
    const current = live?.current !== false && compiled && studioSceneSignature(compiled) === studioSceneSignature(live || {})
    return { ...s, sceneNumber: i + 1, sceneId: live?.id || null, assetId: current ? live?.media?.id || null : null, prompt: compiled?.prompt || s.visualDescription, startAssetId: p.productAssetId, sourceRunId: current ? live?.runId || null : null }
  }) }
}

// Alternative ad drafts are separate sessions, never appended as sequential shots.
export function createStudioVariation(studio, templateId) {
  const current = normalizeStudioProduction(studio.production), proposed = proposeStudioScenes(templateId, studio.brief?.language)
  const scenes = current.scenes.length ? current.scenes.map((s, i) => ({ ...s, visualDescription: proposed[i % proposed.length].visualDescription })) : proposed
  return { ...studio, production: { ...current, templateId, creativeId: null, newCreative: true, sceneLinks: {}, scenes } }
}
