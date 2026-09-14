// Local reference preparation and editable creative guidance. No AI/provider calls.
import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { getDb, getOrCreateAsset } from '../db/repository.mjs'
import { mediaRoot, localAssetPath, videoTool, runVideoTool, inspectVideo } from './assembly.mjs'

export const REFERENCE_ROLES = ['PRODUCT','PACKAGING','CHARACTER','OUTFIT','BACKGROUND','LOCATION','APP_SCREEN','STYLE','OTHER']
export const REMIX_MODES = ['product_swap','character_swap','background_swap','outfit','motion_transfer','full_remix']
const assert = (ok, message) => { if (!ok) throw new Error(message) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const text = (value, max = 6000) => { assert(typeof value === 'string' && value.length <= max, 'Reference text is too long.'); return value }
const settingKey = id => `reference_media_${id}`
function record(a, metadata) {
  const bytes = fs.readFileSync(localAssetPath(a.relative_path))
  const contentHash=hash(bytes), stored=getDb().prepare('SELECT value FROM app_settings WHERE key=?').get(settingKey(a.id))
  const previous=stored ? JSON.parse(stored.value) : {}
  const retained=previous.contentHash===contentHash ? previous : {}
  const value = { ...retained, ...metadata, contentHash, fileSize: bytes.length }
  if (metadata.sourceAssetId) value.sourceAssetIds=[...new Set([...(retained.sourceAssetIds || []),metadata.sourceAssetId])]
  getDb().prepare("INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')").run(settingKey(a.id), JSON.stringify(value))
  return value
}
export function referenceAsset(id, kind, prepared = false) {
  const a = getDb().prepare('SELECT * FROM asset WHERE id=?').get(Number(id))
  const types = { video: ['video/mp4','video/quicktime'], image: ['image/png','image/jpeg','image/webp'], audio: ['audio/mpeg','audio/wav','audio/x-wav'] }
  assert(a && types[kind]?.includes(a.mime_type), `Choose an existing local reference ${kind}.`)
  const file = localAssetPath(a.relative_path), bytes = fs.readFileSync(file)
  const limit = kind === 'video' ? (prepared ? 50 : 100) : kind === 'image' ? 30 : 15
  assert(bytes.length > 0 && bytes.length < limit * 1024 * 1024, `Reference ${kind} must be under ${limit} MB.`)
  const stored = getDb().prepare('SELECT value FROM app_settings WHERE key=?').get(settingKey(a.id))
  const metadata = stored ? JSON.parse(stored.value) : null
  if (prepared) assert(metadata?.contentHash === hash(bytes) && a.content_hash === metadata.contentHash, 'Reference changed or has not been analyzed. Re-upload changed files and analyze / validate references before generation.')
  return { ...a, file, bytes, metadata }
}
function register(file, mimeType, metadata = {}) {
  const bytes = fs.readFileSync(file)
  const result = getOrCreateAsset({ contentHash: hash(bytes), relativePath: path.relative(mediaRoot(), file).replace(/\\/g,'/'), mimeType, fileSize: bytes.length, durationSeconds: metadata.duration, width: metadata.width, height: metadata.height, source: 'uploaded', provider: 'local-reference' })
  const a = getDb().prepare('SELECT * FROM asset WHERE id=?').get(result.id)
  if (Object.keys(metadata).length) record(a, metadata)
  return a
}
export async function uploadReference(req, url) {
  const mime = String(req.headers['content-type'] || '').split(';')[0]
  const extensions = { 'video/mp4':'.mp4','video/quicktime':'.mov','image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','audio/mpeg':'.mp3','audio/wav':'.wav','audio/x-wav':'.wav' }
  assert(extensions[mime], 'Upload MP4/MOV, PNG/JPEG/WebP, or MP3/WAV.')
  const kind = mime.split('/')[0], max = (kind === 'video' ? 100 : kind === 'image' ? 30 : 15) * 1024 * 1024
  let size = 0; const chunks = []
  for await (const chunk of req) { size += chunk.length; assert(size < max, `Reference ${kind} is too large.`); chunks.push(chunk) }
  assert(size, 'Empty reference file.')
  const bytes = Buffer.concat(chunks), folder = path.join(mediaRoot(),'references')
  fs.mkdirSync(folder,{recursive:true})
  const file = path.join(folder, hash(bytes) + extensions[mime])
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes, {flag:'wx'})
  return { asset: register(file,mime), kind }
}
export async function validateReferenceAsset(id, kind) {
  const a = referenceAsset(id,kind), tool = await videoTool()
  if (kind === 'video') return { asset: {id:a.id}, metadata: record(a,await inspectVideo(a.file,tool)) }
  const r = await runVideoTool(tool,['-hide_banner','-nostats','-xerror','-protocol_whitelist','file,pipe','-i',a.file,...(kind === 'image' ? ['-map','0:v:0','-frames:v','1'] : ['-map','0:a:0']),'-f','null','-'])
  assert(r.code === 0, `Reference ${kind} cannot be decoded.`)
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr)
  const metadata = { decoded:true, duration:d ? Number(d[1])*3600+Number(d[2])*60+Number(d[3]) : null }
  if (kind === 'audio') assert(metadata.duration > 0 && metadata.duration <= 15, 'Reference audio must be at most 15 seconds.')
  return { asset: {id:a.id}, metadata:record(a,metadata) }
}
const analyses = new Map()
export async function analyzeReference(input) {
  const key=JSON.stringify([input.assetId,input.start || 0,input.end])
  if (!analyses.has(key)) analyses.set(key,analyzeLocalReference(input).finally(()=>analyses.delete(key)))
  return analyses.get(key)
}
async function analyzeLocalReference({ assetId, start = 0, end }) {
  const a = referenceAsset(assetId,'video'), tool = await videoTool(), metadata = await inspectVideo(a.file,tool)
  assert(metadata.duration > 0 && metadata.duration <= 180, 'Analyze a reference ad up to 180 seconds long.')
  start = Number(start); end = end == null ? Math.min(metadata.duration,15) : Number(end)
  assert(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end <= metadata.duration + .02 && end-start >= 2 && end-start <= 15, 'Choose a 2–15 second reference segment within the original video.')
  const folder = path.join(mediaRoot(),'references',`${hash(a.bytes)}-${start}-${end}`)
  fs.mkdirSync(folder,{recursive:true})
  const clip = path.join(folder,'reference.mp4')
  if (!fs.existsSync(clip)) {
    // Prepare 640² pixel area (within fal input bounds), preserving composition.
    const ratio = metadata.width/metadata.height
    const w = Math.ceil(Math.sqrt(414720*ratio)/2)*2, h = Math.ceil(Math.sqrt(414720/ratio)/2)*2
    assert(ratio >= .4 && ratio <= 2.5, 'Reference aspect ratio must be between 0.4 and 2.5.')
    const scratch=path.join(folder,`prepare-${randomUUID()}.mp4`)
    try {
      const r = await runVideoTool(tool,['-y','-hide_banner','-protocol_whitelist','file,pipe','-ss',String(start),'-i',a.file,'-t',String(end-start),'-map','0:v:0','-map','0:a:0?','-vf',`scale=${w}:${h},setsar=1`,'-r','24','-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',scratch])
      assert(r.code === 0,'Reference clip preparation failed.')
      await inspectVideo(scratch,tool)
      fs.renameSync(scratch,clip)
    } finally { fs.rmSync(scratch,{force:true}) }
  }
  const preparedMeta = await inspectVideo(clip,tool)
  assert(preparedMeta.duration >= 2 && preparedMeta.duration <= 15,'Prepared reference duration is outside provider limits. Adjust the segment end slightly and analyze again.')
  const prepared = register(clip,'video/mp4',{...preparedMeta,sourceAssetId:a.id,start,end,prepared:true})
  record(a,metadata)
  const sceneScan = await runVideoTool(tool,['-hide_banner','-protocol_whitelist','file,pipe','-i',a.file,'-vf',"select='gt(scene,0.35)',showinfo",'-an','-f','null','-'])
  const cuts = [...sceneScan.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m=>Number(m[1])).filter(t=>t>.3 && t<metadata.duration-.3).slice(0,20)
  const boundaries = [0,...cuts.filter((t,i,arr)=>!i || t-arr[i-1]>.5),metadata.duration]
  const beats = boundaries.slice(0,-1).map((t,i)=>({start:t,end:boundaries[i+1],label:cuts.length ? `Detected shot ${i+1}` : 'Continuous shot — annotate creative beats',description:''}))
  const frames=[]
  for (let i=0;i<6;i++) {
    const time=Math.min(metadata.duration-.05,metadata.duration*(i+.5)/6),file=path.join(folder,`frame-${i}.jpg`)
    if (!fs.existsSync(file)) { const r=await runVideoTool(tool,['-y','-hide_banner','-protocol_whitelist','file,pipe','-ss',String(time),'-i',a.file,'-frames:v','1','-vf','scale=320:-2',file]); assert(r.code===0,'Reference frame extraction failed.') }
    const frame=register(file,'image/jpeg');frames.push({assetId:frame.id,relative_path:frame.relative_path,time})
  }
  return {sourceAssetId:a.id,preparedAssetId:prepared.id,start,end,metadata,preparedMetadata:preparedMeta,frames,beats,transcriptionAvailable:false,semanticAnalysisAvailable:false,notes:'Local decode, metadata, representative frames and visual-cut detection. Subjects, claims, camera intent and transcript require operator review; no automatic vision/transcription provider is used.'}
}
export function referenceInputs(params) {
  assert(params.generation_mode === 'reference_to_video','Reference generation mode is required.')
  const videoIds=params.reference_video_ids,imageIds=params.reference_image_ids || [],audioIds=params.reference_audio_ids || []
  assert(Array.isArray(videoIds) && videoIds.length===1,'Use one prepared reference video.')
  assert(Array.isArray(imageIds) && imageIds.length<=9,'Use up to nine reference images.')
  assert(Array.isArray(audioIds) && audioIds.length<=1,'Use up to one reference audio clip.')
  assert(new Set([...videoIds,...imageIds,...audioIds]).size===videoIds.length+imageIds.length+audioIds.length,'Duplicate references are not allowed.')
  const videos=videoIds.map(id=>referenceAsset(id,'video',true)),images=imageIds.map(id=>referenceAsset(id,'image',true)),audios=audioIds.map(id=>referenceAsset(id,'audio',true))
  const duration=videos.reduce((sum,a)=>sum+a.metadata.duration,0)
  assert(videos.every(a=>a.metadata.prepared && a.metadata.width*a.metadata.height>=409600 && a.metadata.width*a.metadata.height<=834*1112) && duration>=2 && duration<=15,'Analyze and prepare a valid 2–15 second reference video.')
  assert(audios.every(a=>a.metadata.duration>0 && a.metadata.duration<=15),'Reference audio exceeds 15 seconds.')
  return {videos,images,audios,inputSeconds:duration}
}
export function normalizeRemix(raw = {}) {
  assert(REMIX_MODES.includes(raw.editMode),'Choose a remix mode.')
  const images=(raw.images || []).map(ref=>{assert(REFERENCE_ROLES.includes(ref.role),'Choose a supported reference role.');referenceAsset(ref.assetId,'image');return {assetId:Number(ref.assetId),role:ref.role}})
  assert(images.length<=9,'Use up to nine reference images.')
  const keep=(raw.keep || []).map(v=>text(v,100)),change=(raw.change || []).map(v=>text(v,100))
  assert(keep.length<=12 && change.length<=12,'Too many guidance selections.')
  return {editMode:raw.editMode,sourceAssetId:Number(raw.sourceAssetId)||null,preparedAssetId:Number(raw.preparedAssetId)||null,audioAssetId:Number(raw.audioAssetId)||null,images,keep,change,instructions:text(raw.instructions || ''),transcript:text(raw.transcript || '',12000),script:text(raw.script || '',12000),scriptApproved:raw.scriptApproved===true,promptContext:typeof raw.promptContext==='string'?raw.promptContext:'',observations:text(raw.observations || ''),analysis:raw.analysis || null}
}
export function remixParams(s) {
  const r=s.remix
  assert(r?.scriptApproved && r.script.trim(),'Review and approve the adapted script before generation.')
  assert(r.promptContext === remixPromptContext(s),'Reference guidance, script or audio changed. Rebuild the prompt and review it before generation.')
  const params={generation_mode:'reference_to_video',reference_video_ids:[r.preparedAssetId],reference_image_ids:r.images.map(a=>a.assetId),reference_audio_ids:r.audioAssetId ? [r.audioAssetId] : []}
  const inputs=referenceInputs(params)
  assert(inputs.videos[0].metadata.sourceAssetIds?.includes(r.sourceAssetId),'Prepared clip does not belong to the selected original. Analyze the reference again.')
  return params
}
export function remixPromptContext(scene) {
  const r=scene.remix
  return hash(JSON.stringify([r.editMode,r.sourceAssetId,r.preparedAssetId,r.audioAssetId,r.images,r.keep,r.change,r.instructions,r.observations,r.script,r.analysis?.beats,scene.generateAudio]))
}
export function referenceAliases(images) {
  const counts={}
  return images.map((ref,i)=>{const name=ref.role==='APP_SCREEN' ? 'AppScreen' : ref.role[0]+ref.role.slice(1).toLowerCase();counts[name]=(counts[name]||0)+1;return {...ref,alias:`@${name}${counts[name]>1 ? counts[name] : ''}`,token:`@Image${i+1}`}})
}
export function buildRemixPrompt(scene, productName, creative = {}) {
  const r=normalizeRemix(scene.remix),aliases=referenceAliases(r.images)
  const beats=(r.analysis?.beats || []).slice(0,24).map(b=>`${b.start}–${b.end}s: ${b.label}. ${b.description || ''}`).join('\n')
  const script=r.script.trim() || [`Meet ${productName}.`,creative.hook_text || `See ${productName} in everyday use.`,`Show the product details clearly.`,`Discover ${productName}.`].join('\n')
  let prompt=[`Create a new ${r.editMode.replaceAll('_',' ')} ad for ${productName}. Use @Video1 as structural, motion and pacing reference; interpret guidance, not a pixel-perfect edit.`,
    ...aliases.map(a=>`${a.token} supplies the ${a.role.toLowerCase().replaceAll('_',' ')} reference (${a.alias}).`),
    `KEEP guidance: ${r.keep.join(', ') || 'use the reference beat structure'}.`, `CHANGE guidance: ${r.change.join(', ') || 'adapt to the current product'}.`,r.instructions,r.observations,
    beats && `Operator-reviewed beat outline:\n${beats}`,
    'Adapt the creative framework to the current product. Do not reproduce competitor brands, logos, unsupported claims, testimonials or exact source dialogue. Do not invent product benefits.',
    scene.generateAudio ? `New adapted dialogue / audio direction:\n${script}${r.audioAssetId ? '\nUse @Audio1 for the requested audio style, not unapproved source words.' : ''}` : 'Silent output. The adapted script is planning/caption guidance for later use, not spoken dialogue.',
  ].filter(Boolean).join('\n\n')
  prompt=prompt.replaceAll('@ReferenceVideo','@Video1')
  for(const a of [...aliases].sort((a,b)=>b.alias.length-a.alias.length)) prompt=prompt.replaceAll(a.alias,a.token)
  assert(prompt.length<=6000,'Prompt is too long. Shorten guidance or generate separate script segments; nothing has been submitted.')
  return {prompt,script,aliases,promptContext:remixPromptContext({...scene,remix:{...r,script}})}
}
