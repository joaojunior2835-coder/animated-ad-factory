// Local M6 assembly. No provider calls or financial mutations.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { getDb, getProductionRunExecution, getJobAssetLink, getOrCreateAsset, attachAssetLink, setProductionRunFinalAsset, setProductionRunStatus, freezeProductionRunSpec } from '../db/repository.mjs'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const mediaRoot = () => path.resolve(process.env.FACTORY_MEDIA_ROOT || path.join(appRoot, 'local-media'))
export function localAssetPath(relativePath) {
  if (relativePath === 'mock-video-output.mp4') {
    const file = path.resolve(appRoot, 'public', relativePath)
    if (!fs.existsSync(file)) throw new Error('Mock video file is missing.')
    return file
  }
  const root = fs.realpathSync(mediaRoot())
  const file = fs.realpathSync(path.resolve(root, relativePath))
  if (!file.startsWith(root + path.sep) || !fs.statSync(file).isFile()) throw new Error('Asset file is outside the local media library or missing.')
  return file
}

export function runVideoTool(executable, args, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = '', timedOut = false
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-32000) })
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeout)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => { clearTimeout(timer); if (timedOut) reject(new Error('Local video processing timed out.')); else resolve({ code, stderr }) })
  })
}

export async function videoTool() {
  const configured = getDb().prepare("SELECT value FROM app_settings WHERE key='ffmpeg_path'").get()
  const candidates = [configured && JSON.parse(configured.value), process.env.FFMPEG_PATH, 'ffmpeg']
  // Reuse an installed local binary when PATH has not been configured.
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, 'DICloak', 'vendor', 'ffmpeg', 'bin', 'ffmpeg.exe'))
  for (const candidate of candidates.filter(Boolean)) {
    try { if ((await runVideoTool(candidate, ['-version'], 10000)).code === 0) return candidate } catch {}
  }
  throw new Error('FFmpeg unavailable. Set its executable path in Operator settings.')
}

export async function inspectVideo(file, executable = null) {
  const tool = executable || await videoTool()
  const result = await runVideoTool(tool, ['-hide_banner', '-nostats', '-xerror', '-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:v:0', '-f', 'null', '-'])
  const duration = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(result.stderr)
  const dimensions = /Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/.exec(result.stderr)
  if (result.code !== 0 || !duration || !dimensions) throw new Error('Video is missing, invalid, or cannot be decoded by FFmpeg.')
  return { duration: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]), width: Number(dimensions[1]), height: Number(dimensions[2]), audio: /Audio:/.test(result.stderr), videoCodec: /Video:\s*(\w+)/.exec(result.stderr)?.[1], audioCodec: /Audio:\s*(\w+)/.exec(result.stderr)?.[1] || null, frameRate: Number(/Video:[^\r\n]*?([\d.]+) fps/.exec(result.stderr)?.[1]) || null, decoded: true }
}

export function assemblyInputs(runId) {
  const run = getProductionRunExecution(runId)
  if (!run || !run.spec_frozen_at || run.status === 'superseded') throw new Error('Assembly requires an existing frozen production run.')
  const sources = run.specSnapshot?.execution?.assemblySources
  if (run.specSnapshot?.planning?.fineMethod === 'local_assembly' && Array.isArray(sources)) {
    if (!sources.length || run.jobs.length) throw new Error('Invalid local assembly selection.')
    return { run, clips: sources.map((source) => {
      const linked = getDb().prepare("SELECT a.* FROM asset a JOIN asset_link al ON al.asset_id=a.id WHERE a.id=? AND al.production_run_id=? AND al.role='assembly_input'").get(source.assetId, runId)
      if (!linked || linked.mime_type !== 'video/mp4') throw new Error('Assembly source is not a linked local video.')
      if (source.sourceRunId) {
        const original = getProductionRunExecution(source.sourceRunId)
        if (!original || original.creative_id !== run.creative_id || original.status !== 'complete' || original.final_asset_id !== linked.id) throw new Error('Assembly source lineage is invalid.')
      }
      return { assetId: linked.id, sourceRunId: source.sourceRunId, relativePath: linked.relative_path, file: localAssetPath(linked.relative_path) }
    }) }
  }
  if (!run.jobs.length || run.jobs.some((job) => job.status !== 'complete')) throw new Error('All generation jobs must complete before assembly.')
  const clips = run.jobs.filter((job) => job.capability === 'generate_video').sort((a, b) => (a.inputParams.sequence || a.id) - (b.inputParams.sequence || b.id))
  if (!clips.length) throw new Error('No completed video clips to assemble.')
  return { run, clips: clips.map((job) => {
    const asset = getJobAssetLink(job.id)
    if (!asset) throw new Error('A completed video job has no local Asset.')
    const file = localAssetPath(asset.relative_path)
    return { jobId: job.id, assetId: asset.id, relativePath: asset.relative_path, file }
  }) }
}

// Finish a manual/external run without creating any generation Job.
export async function completeExternalRun(runId, assetId) {
  const eligible = () => {
    const run = getProductionRunExecution(Number(runId))
    if (!run || run.production_method !== 'manual_external' || run.jobs.length || !['planned', 'executing'].includes(run.status)) throw new Error('Import final video requires an unfinished manual-external run with no generation jobs.')
    return run
  }
  eligible()
  const asset = getDb().prepare('SELECT * FROM asset WHERE id=?').get(assetId)
  if (!asset) throw new Error('Select a local video Asset.')
  const source = localAssetPath(asset.relative_path), tool = await videoTool()
  await inspectVideo(source, tool)
  const imports = path.join(mediaRoot(), 'imports')
  fs.mkdirSync(imports, { recursive: true })
  const work = fs.mkdtempSync(path.join(imports, 'work-')), output = path.join(work, 'final.mp4')
  let retained = null
  try {
  const result = await runVideoTool(tool, ['-y', '-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output])
  if (result.code !== 0) throw new Error('Could not convert imported video to browser-compatible MP4.')
  const metadata = await inspectVideo(output, tool), bytes = fs.readFileSync(output)
  const completed = getDb().transaction(() => {
    const run = eligible()
    if (!run.spec_frozen_at) freezeProductionRunSpec(run.id, { ...run.specSnapshot, schemaVersion: 1, planning: { ...run.specSnapshot?.planning, manualExternal: true }, execution: { provider: 'manual', inputAssetIds: [asset.id], frozenAt: new Date().toISOString() } })
    const final = getOrCreateAsset({ contentHash: createHash('sha256').update(bytes).digest('hex'), relativePath: path.relative(mediaRoot(), output).replace(/\\/g, '/'), mimeType: 'video/mp4', fileSize: bytes.length, width: metadata.width, height: metadata.height, durationSeconds: metadata.duration, source: 'generated', provider: 'local-ffmpeg' })
    localAssetPath(getDb().prepare('SELECT relative_path FROM asset WHERE id=?').get(final.id).relative_path)
    setProductionRunFinalAsset(run.id, final.id)
    setProductionRunStatus(run.id, 'complete', true)
    return { assetId: final.id, runId: run.id }
  }).immediate()
  retained = localAssetPath(getDb().prepare('SELECT relative_path FROM asset WHERE id=?').get(completed.assetId).relative_path)
  return completed
  } finally {
    if (output !== retained) fs.rmSync(output, { force: true })
    if (!fs.readdirSync(work).length) fs.rmdirSync(work)
  }
}

export async function assembleProductionRun(runId) {
  runId = Number(runId)
  if (!Number.isSafeInteger(runId) || runId <= 0) throw new Error('Invalid production run.')
  const folder = path.join(mediaRoot(), 'assembly', String(runId))
  fs.mkdirSync(folder, { recursive: true })
  const lock = path.join(folder, 'assembly.lock')
  let work = null, retainedOutput = null
  try {
    // Serialize stale-lock recovery across the backend and MCP processes.
    getDb().transaction(() => {
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, 'utf8'))
      let running = true
      try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') running = false }
      if (running || !pid) throw new Error('Assembly is already running. Wait for completion.')
      fs.unlinkSync(lock)
    }
    const descriptor = fs.openSync(lock, 'wx')
    fs.writeFileSync(descriptor, String(process.pid)); fs.closeSync(descriptor)
    }).immediate()
  } catch (error) { throw new Error(error.code === 'EEXIST' ? 'Assembly is already running.' : error.message) }
  try {
    const run = getProductionRunExecution(runId)
    if (run?.status === 'complete' && run.final_asset_id) {
      const asset = getDb().prepare('SELECT * FROM asset WHERE id=?').get(run.final_asset_id)
      localAssetPath(asset.relative_path)
      return { asset, reused: true }
    }
    const { clips } = assemblyInputs(runId)
    const tool = await videoTool()
    // A renderer orphaned by an app restart cannot overwrite the next attempt.
    work = fs.mkdtempSync(path.join(folder, 'work-'))
    for (let i = 0; i < clips.length; i++) {
      const metadata = await inspectVideo(clips[i].file, tool)
      const output = path.join(work, `clip-${i}.mp4`)
      const args = ['-y', '-hide_banner', '-protocol_whitelist', 'file,pipe', '-i', clips[i].file]
      if (!metadata.audio) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo')
      args.push('-map', '0:v:0', '-map', metadata.audio ? '0:a:0' : '1:a:0', '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-af', 'apad', '-t', String(metadata.duration), '-movflags', '+faststart', output)
      if ((await runVideoTool(tool, args)).code !== 0) throw new Error(`Could not normalize clip ${i + 1}. Check the source video.`)
    }
    const manifest = path.join(work, 'clips.txt')
    fs.writeFileSync(manifest, clips.map((_, i) => `file 'clip-${i}.mp4'`).join('\n'))
    const output = path.join(work, 'final.mp4')
    if ((await runVideoTool(tool, ['-y', '-hide_banner', '-f', 'concat', '-safe', '1', '-i', manifest, '-c', 'copy', '-movflags', '+faststart', output])).code !== 0) throw new Error('Final video assembly failed.')
    const metadata = await inspectVideo(output, tool)
    const bytes = fs.readFileSync(output)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const relativePath = path.relative(mediaRoot(), output).replace(/\\/g, '/')
    const completed = getDb().transaction(() => {
      const current = assemblyInputs(runId)
      if (JSON.stringify(current.clips) !== JSON.stringify(clips)) throw new Error('Assembly inputs changed; run assembly again.')
      if (current.run.final_asset_id) throw new Error('A final Asset was selected while assembly was running; it was not replaced.')
      const result = getOrCreateAsset({ contentHash, relativePath, mimeType: 'video/mp4', fileSize: bytes.length, width: metadata.width, height: metadata.height, durationSeconds: metadata.duration, source: 'generated', provider: 'local-ffmpeg' })
      const asset = getDb().prepare('SELECT * FROM asset WHERE id=?').get(result.id)
      localAssetPath(asset.relative_path)
      attachAssetLink(asset.id, { productionRunId: runId }, 'final_output')
      setProductionRunFinalAsset(runId, asset.id)
      setProductionRunStatus(runId, 'complete', true)
      return { asset, reused: false }
    }).immediate()
    retainedOutput = localAssetPath(completed.asset.relative_path)
    return completed
  } finally {
    // Delete only this invocation's private scratch directory/files, never
    // source Assets or an earlier renderer's outputs. Keep the committed MP4.
    try {
      if (work && path.dirname(work) === folder && path.basename(work).startsWith('work-')) {
        for (const entry of fs.readdirSync(work)) {
          const file = path.join(work, entry)
          if (file !== retainedOutput) fs.rmSync(file, { force: true })
        }
        if (!fs.readdirSync(work).length) fs.rmdirSync(work)
      }
    } finally { fs.unlinkSync(lock) }
  }
}
