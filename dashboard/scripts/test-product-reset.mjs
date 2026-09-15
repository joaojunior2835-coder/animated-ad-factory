// P0 Creative Product Reset regressions. Isolated DB/media; no real provider calls.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'aaf-product-reset-'))
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dashboardRoot = path.resolve(__dirname, '..')
process.env.FACTORY_DB_PATH = path.join(temp, 'factory.db')
process.env.FACTORY_MEDIA_ROOT = path.join(temp, 'media')
process.env.MOCK_VIDEO_DELAY_MS = '0'
process.env.PRODUCTION_POLL_INTERVAL_MS = '50'
for (const key of ['FAL_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'POLLINATIONS_API_KEY', 'REPLICATE_API_TOKEN']) process.env[key] = ''
fs.mkdirSync(process.env.FACTORY_MEDIA_ROOT, { recursive: true })

const { runMigrations, openDatabase } = await import('../server/db/migrate.mjs')
runMigrations({ dbPath: process.env.FACTORY_DB_PATH, log: { log() {} } })
const repo = await import('../server/db/repository.mjs')
const pt = await import('../server/db/productTestRepository.mjs')
const generator = await import('../server/lib/creativeGenerator.mjs')
const dispatcher = await import('../server/lib/dispatcher.mjs')
repo.setDb(openDatabase(process.env.FACTORY_DB_PATH))

let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`) }
const db = () => repo.getDb()

const videoScene = (patch = {}) => ({
  name: 'Quick scene',
  prompt: 'Handheld UGC shot of a woman holding a skincare product in a bright bedroom.',
  provider: 'mock',
  mode: 'text-to-video',
  seconds: 5,
  resolution: '480p',
  aspectRatio: '9:16',
  generateAudio: false,
  quantity: 1,
  startAssetId: null,
  ...patch,
})
const imageScene = (patch = {}) => ({
  kind: 'image',
  name: 'Quick image',
  prompt: 'Minimal studio product photograph on a clean stone surface.',
  provider: 'mock',
  model: 'mock-image',
  mode: 'text-to-image',
  imageSize: 'square',
  outputFormat: 'png',
  quantity: 1,
  ...patch,
})
const snapshotText = (runId) => JSON.stringify(repo.getProductionRunExecution(runId).specSnapshot)

let mcpProcess = null
let client = null
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitHealth(url) {
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(url); if (response.ok) return }
    catch {}
    await wait(150)
  }
  throw new Error(`MCP health did not become ready at ${url}`)
}

try {
  const legacyProductId = repo.createProduct({ name: 'Red apple smoke validation' })
  const legacyTest = pt.createProductTestForProduct({ productId: legacyProductId, market: 'FR', language: 'en' })
  const legacyCreativeId = generator.createGeneratorCreative({ productTestId: legacyTest.id, angle: 'DISPOSABLE final Seedance audio-off validation' }).creativeId
  generator.saveGeneratorScenes(legacyCreativeId, { revision: 0, scenes: [videoScene({ prompt: 'Red apple smoke validation should never leak.' })] })

  await check('Quick Video creates hidden lineage without selecting legacy Product Test or Creative', () => {
    const quick = generator.createQuickGeneratorCreative({ workspace: 'video', title: 'MCP quick video' })
    assert.notEqual(quick.creativeId, legacyCreativeId)
    const workspace = generator.saveGeneratorScenes(quick.creativeId, { revision: 0, scenes: [videoScene()] })
    assert.equal(workspace.scenes.length, 1)
    assert.equal(workspace.creative.angle, 'MCP quick video')
    assert.doesNotMatch(JSON.stringify(workspace), /Red apple smoke validation|DISPOSABLE final Seedance/)
  })

  await check('Clean quick production snapshot and provider input contain only current prompt/settings', async () => {
    const quick = generator.createQuickGeneratorCreative({ workspace: 'video', title: 'Clean quick video' })
    let workspace = generator.saveGeneratorScenes(quick.creativeId, { revision: 0, scenes: [videoScene()] })
    const quoted = generator.quoteGenerator(quick.creativeId, { revision: workspace.revision, sceneIds: [workspace.scenes[0].id] })
    assert.equal(quoted.quote.totalMinor, 0)
    const text = snapshotText(quoted.quote.runIds[0])
    assert.match(text, /Handheld UGC shot/)
    assert.doesNotMatch(text, /Red apple smoke validation|DISPOSABLE final Seedance/)
    await generator.startGenerator(quick.creativeId, { ...quoted.quote, confirmed: true })
    workspace = generator.generatorWorkspace(quick.creativeId)
    const input = workspace.scenes[0].details.run.jobs[0].inputParams
    assert.equal(input.prompt, videoScene().prompt)
    assert.equal(input.generate_audio, false)
    assert.doesNotMatch(JSON.stringify(input), /Red apple smoke validation|DISPOSABLE final Seedance/)
  })

  await check('Image generations are append-only in workspace history across regenerations', async () => {
    const quick = generator.createQuickGeneratorCreative({ workspace: 'image', title: 'Quick image history' })
    let workspace = generator.saveGeneratorScenes(quick.creativeId, { revision: 0, scenes: [imageScene()] })
    let quoted = generator.quoteGenerator(quick.creativeId, { revision: workspace.revision, sceneIds: [workspace.scenes[0].id] })
    await generator.startGenerator(quick.creativeId, { ...quoted.quote, confirmed: true })
    await dispatcher.reconcileInFlightJobs()
    workspace = generator.generatorWorkspace(quick.creativeId)
    const firstAsset = workspace.scenes[0].media.id
    workspace = generator.saveGeneratorScenes(quick.creativeId, { revision: workspace.revision, scenes: [{ ...workspace.scenes[0], prompt: 'Second retained image generation.' }] })
    quoted = generator.quoteGenerator(quick.creativeId, { revision: workspace.revision, sceneIds: [workspace.scenes[0].id] })
    await generator.startGenerator(quick.creativeId, { ...quoted.quote, confirmed: true })
    await dispatcher.reconcileInFlightJobs()
    workspace = generator.generatorWorkspace(quick.creativeId)
    assert.ok(workspace.scenes[0].media.id)
    assert.ok(workspace.scenes[0].history.some((entry) => entry.runId || entry.assetId))
    assert.ok(workspace.scenes[0].historyOutputs.some((asset) => asset.id === firstAsset))
  })

  await check('Primary navigation contract has one Canvas and keeps legacy project tools out of primary', async () => {
    const nav = await import('../src/lib/workspaceNavigation.js')
    assert.deepEqual(nav.PRIMARY_WORKSPACES.map((item) => item.label), ['Image', 'Video', 'Remix', 'Marketing Studio', 'Canvas', 'Assets'])
    assert.equal(nav.PRIMARY_WORKSPACES.filter((item) => /canvas/i.test(item.label)).length, 1)
    assert.ok(!nav.PRIMARY_WORKSPACES.some((item) => /Product Tests|Audience|Ad Methods|Script Import|Frame Prompts/i.test(item.label)))
    assert.ok(nav.SUPPORTING_WORKSPACES.some((item) => item.key === 'product_tests'))
  })

  await check('MCP exposes creative parity tools and can persist a scene plan into dashboard state', async () => {
    const mcpPort = 8794
    mcpProcess = spawn(process.execPath, ['server/mcp.mjs'], {
      cwd: dashboardRoot,
      env: { ...process.env, MCP_PORT: String(mcpPort), PORT: '65530' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    await waitHealth(`http://127.0.0.1:${mcpPort}/health`)
    client = new Client({ name: 'product-reset-test', version: '1' })
    await client.connect(new SSEClientTransport(new URL(`http://127.0.0.1:${mcpPort}/sse`)))
    const tools = (await client.listTools()).tools.map((tool) => tool.name)
    for (const name of ['creative_list_models', 'creative_list_assets', 'creative_import_asset', 'creative_generate_image', 'creative_generate_video', 'creative_plan_scenes', 'creative_generate_scenes', 'creative_create_remix', 'creative_get_generation', 'creative_assemble']) assert.ok(tools.includes(name), `missing MCP tool ${name}`)
    const planned = await client.callTool({ name: 'creative_plan_scenes', arguments: { brief: 'Create a 20-second UGC ad with hook, demo, and natural CTA.', provider: 'mock' } })
    assert.notEqual(planned.isError, true)
    const payload = JSON.parse(planned.content[0].text)
    assert.ok(payload.creativeId)
    assert.ok(payload.sceneCount >= 3)
    const workspace = generator.generatorWorkspace(payload.creativeId)
    assert.equal(workspace.scenes.length, payload.sceneCount)
    assert.match(JSON.stringify(workspace.scenes), /hook|demo|CTA|UGC/i)
  })

  console.log(`Product reset: ${passed}/${passed} PASS; 0 real provider calls`)
} finally {
  try { await client?.close?.() } catch {}
  if (mcpProcess) {
    await new Promise((resolve) => {
      mcpProcess.once('exit', resolve)
      mcpProcess.kill()
      setTimeout(resolve, 1000)
    })
  }
  repo.closeDb()
  if (path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
