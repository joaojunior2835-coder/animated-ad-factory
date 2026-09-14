// Deliberately local synthetic image fixture, never an AI/provider call.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { imageJobInput } from './falImageModel.mjs'
import { videoTool, runVideoTool } from '../lib/assembly.mjs'

const pending = new Map()

export function createMockImageJob(params) {
  const input = imageJobInput(params)
  return { jobId: `mock-image:${input.image_size.width}:${input.image_size.height}:${randomUUID()}`, status: 'IN_QUEUE' }
}
export async function getMockImageJob(id, mediaRoot) {
  const key = `${path.resolve(mediaRoot)}:${id}`
  if (pending.has(key)) return pending.get(key)
  const promise = renderMockImage(id, mediaRoot)
  pending.set(key, promise)
  try { return await promise } finally { pending.delete(key) }
}
async function renderMockImage(id, mediaRoot) {
  const match = /^mock-image:(\d+):(\d+):([a-f0-9-]{36})$/.exec(String(id))
  if (!match) throw new Error('Unknown local image request.')
  const width = Number(match[1]), height = Number(match[2])
  if (width < 64 || height < 64 || width > 2048 || height > 2048) throw new Error('Invalid local image dimensions.')
  const relative = `generated/mock-image-${match[3]}.png`, file = path.join(mediaRoot, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file)) {
    const color=match[3].replaceAll('-','').slice(0,6)
    const temporary = `${file}.${randomUUID()}.png`
    try {
      const r = await runVideoTool(await videoTool(), ['-hide_banner','-nostdin','-f','lavfi','-i',`color=c=0x${color}:s=${width}x${height}`,'-frames:v','1','-threads','1','-update','1',temporary])
      if (r.code !== 0) throw new Error(`Local mock image fixture failed: ${r.stderr.slice(-1200)}`)
      // Pollers never observe an unfinished PNG. Only this request's scratch file is removed.
      if (!fs.existsSync(file)) fs.renameSync(temporary, file)
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
  }
  return { status: 'COMPLETED', result: { local_url: `/media/${relative}`, mime_type: 'image/png', width, height, file_size: fs.statSync(file).size, provider: 'mock', model: 'mock-image', cost_basis: 'local_mock' } }
}
