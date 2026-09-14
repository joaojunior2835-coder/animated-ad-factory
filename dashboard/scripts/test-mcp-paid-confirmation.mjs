import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

delete process.env.FAL_API_KEY

const { generateImage, generateVideo } = await import('../server/providers/falProvider.mjs')

assert.deepEqual(await generateImage({ prompt: 'test' }), { ok: false, reason: 'confirmation_required' })
assert.deepEqual(await generateVideo({ prompt: 'test', imageUrl: 'https://example.com/frame.png' }), { ok: false, reason: 'confirmation_required' })

assert.deepEqual(await generateImage({ prompt: 'test', confirmed: true }), { ok: false, reason: 'FAL_API_KEY_NOT_CONFIGURED' })
assert.deepEqual(await generateVideo({ prompt: 'test', imageUrl: 'https://example.com/frame.png', confirmed: true }), { ok: false, reason: 'FAL_API_KEY_NOT_CONFIGURED' })

const here = path.dirname(fileURLToPath(import.meta.url))
const mcpSource = fs.readFileSync(path.resolve(here, '../server/mcp.mjs'), 'utf8')
assert.match(mcpSource, /generateImage\(\{ prompt, aspectRatio, mediaRoot: MEDIA_ROOT, confirmed \}\)/)
assert.match(mcpSource, /generateVideo\(\{ prompt, imageUrl, duration, aspectRatio, mediaRoot: MEDIA_ROOT, confirmed \}\)/)
assert.equal((mcpSource.match(/confirmed: z\.boolean\(\)\.describe\('Must be true before this paid fal\.ai request is dispatched\.'\)/g) || []).length, 2)

console.log('PASS  MCP paid fal.ai image/video require explicit confirmation before provider dispatch')
