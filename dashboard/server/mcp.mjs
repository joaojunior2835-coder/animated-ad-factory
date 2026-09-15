// Local MCP (Model Context Protocol) server for the Animated Ad Factory.
//
// This is a thin tool layer over the EXISTING backend code — it imports
// repository.mjs / productTestRepository.mjs / the provider modules directly
// and calls the same functions server/index.mjs's HTTP routes call. It is
// NOT a separate service that re-implements logic, and it does not call
// itself or the main backend over HTTP for anything that has a direct
// in-process function to call instead.
//
// SECURITY:
// - Binds to 127.0.0.1 ONLY. Never 0.0.0.0 — this must not be reachable from
//   the network, same discipline as the main backend on 8787.
// - No API key (FAL_API_KEY or any other) ever appears in a tool response,
//   a log line, or an error message — providers already follow this
//   (falProvider/pollinationsProvider/replicateVideoProvider all return
//   `reason` strings, never the key).
// - Every generation tool saves to local-media/ via the existing pipeline and
//   returns a local URL — never raw base64 or a remote provider URL.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { z } from 'zod'

import { runMigrations } from './db/migrate.mjs'
import {
  getDb,
  listMarketingStudioSessions,
  getMarketingStudioSession,
  upsertMarketingStudioSession,
  createProduct,
  getOrCreateAsset,
  checkDbConnectivity,
} from './db/repository.mjs'
import * as ptRepo from './db/productTestRepository.mjs'
import { getBudgetSummary } from './db/repository.mjs'
import { fetchProductPageText } from './lib/safeFetch.mjs'
import { generateResearchDraft, generateStrategyDraft, validateResearchDraft } from './lib/organicStrategy.mjs'
import { preflightProduction, startProduction } from './lib/productionExecution.mjs'
import { assembleProductionRun } from './lib/assembly.mjs'
import { reviewQueue, reviewCreative, analysisSummary } from './lib/operator.mjs'
import { runPollinations } from './providers/pollinationsProvider.mjs'
import { createMockVideoJob, getMockVideoJob } from './providers/mockVideoProvider.mjs'
import * as falProvider from './providers/falProvider.mjs'
import {
  generatorOptions,
  createGeneratorCreative,
  createQuickGeneratorCreative,
  generatorWorkspace,
  saveGeneratorScenes,
  quoteGenerator,
  startGenerator,
  assembleGenerator,
} from './lib/creativeGenerator.mjs'
import {
  inferStudioFromQuickPrompt,
  formatById,
  generateOmniPrompts,
  generateSceneOutline,
} from '../src/lib/marketingStudioModel.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MEDIA_ROOT = path.resolve(process.env.FACTORY_MEDIA_ROOT || path.join(__dirname, '..', 'local-media'))
const BACKEND_URL = `http://127.0.0.1:${process.env.PORT || 8787}`
const MCP_PORT = Number(process.env.MCP_PORT) || 8789

// The main backend loads .env.local on its own startup; when the MCP server
// is started as a separate process (dev:all) it needs the same values, since
// falProvider reads FAL_API_KEY directly from process.env.
function loadEnvLocal() {
  try {
    const envPath = path.resolve(__dirname, '..', '.env.local')
    const raw = fs.readFileSync(envPath, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const key = t.slice(0, eq).trim()
      let val = t.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (key && process.env[key] === undefined) process.env[key] = val
    }
  } catch {
    // No .env.local — providers stay unconfigured, same as the main backend.
  }
}
loadEnvLocal()

// Schema must be current before any tool touches the database. Idempotent —
// safe to run again even if the main backend already migrated this file.
try {
  runMigrations()
} catch (error) {
  console.error('[mcp] refusing to start: database migrations failed:', error && error.message ? error.message : error)
  process.exit(1)
}
// Two separate Node processes (this one and the main backend) open the same
// factory.db concurrently. better-sqlite3/SQLite's default rollback-journal
// locking handles that, but without a busy_timeout a lock held by the other
// process can surface as an immediate SQLITE_BUSY instead of a short wait.
getDb().pragma('busy_timeout = 5000')

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] })
const errorText = (message) => ({ content: [{ type: 'text', text: String(message) }], isError: true })

function withErrors(fn) {
  return async (args) => {
    try {
      return await fn(args)
    } catch (error) {
      // Never let a tool call crash the connection — a clear message beats a
      // dropped SSE stream.
      return errorText(error && error.message ? error.message : String(error))
    }
  }
}

const server = new McpServer({ name: 'animated-ad-factory', version: '1.0.0' })

// ---------------------------------------------------------------------------
// GENERATION TOOLS
// ---------------------------------------------------------------------------

server.registerTool(
  'generate_image',
  {
    title: 'Generate image (fal.ai FLUX Schnell)',
    description:
      'Legacy direct fal.ai image generation is disabled (production_required). Paid media must use an approved, ' +
      'supported M5 production plan and start_production with explicit confirmation and budget reservation.',
    inputSchema: {
      prompt: z.string().min(1).describe('The image prompt.'),
      aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3']).optional().describe('Defaults to 1:1 if omitted.'),
      confirmed: z.boolean().describe('Must be true before this paid fal.ai request is dispatched.'),
    },
  },
  withErrors(async ({ prompt, aspectRatio, confirmed }) => {
    if (confirmed !== true) return errorText('confirmation_required: set confirmed:true to make this paid fal.ai image request.')
    const result = await falProvider.generateImage({ prompt, aspectRatio, mediaRoot: MEDIA_ROOT, confirmed })
    if (!result.ok) return errorText(`Image generation failed: ${result.reason}`)
    return text({ localUrl: result.localUrl, width: result.width, height: result.height, model: result.model, fileSize: result.fileSize })
  })
)

server.registerTool(
  'generate_video',
  {
    title: 'Generate video (fal.ai WAN 2.1 image-to-video)',
    description:
      'Legacy direct fal.ai video generation is disabled (production_required). Use an approved Seedance M5 ' +
      'production plan and start_production with explicit confirmation and budget reservation.',
    inputSchema: {
      prompt: z.string().min(1).describe('The video motion/scene prompt.'),
      imageUrl: z.string().min(1).describe('Start frame image — a local /media/... URL or a public http(s) URL.'),
      duration: z.number().positive().optional().describe('Clip duration in seconds.'),
      aspectRatio: z.enum(['9:16', '16:9', '1:1']).optional(),
      confirmed: z.boolean().describe('Must be true before this paid fal.ai request is dispatched.'),
    },
  },
  withErrors(async ({ prompt, imageUrl, duration, aspectRatio, confirmed }) => {
    if (confirmed !== true) return errorText('confirmation_required: set confirmed:true to make this paid fal.ai video request.')
    const result = await falProvider.generateVideo({ prompt, imageUrl, duration, aspectRatio, mediaRoot: MEDIA_ROOT, confirmed })
    if (!result.ok) return errorText(`Video generation failed: ${result.reason}`)
    return text({ localUrl: result.localUrl, duration: result.duration, model: result.model, fileSize: result.fileSize })
  })
)

server.registerTool(
  'generate_image_pollinations',
  {
    title: 'Generate image (Pollinations)',
    description:
      'Pollinations generation is disabled: its credit-based pricing and M5 accounting are not configured. ' +
      'This tool returns COST_UNKNOWN when a key is present; it never submits a generation.',
    inputSchema: {
      prompt: z.string().min(1).describe('The image prompt.'),
      aspectRatio: z.enum(['9:16', '16:9', '1:1', '4:3']).optional(),
    },
  },
  withErrors(async ({ prompt, aspectRatio }) => {
    const result = await runPollinations({ action_type: 'generate_image', input_prompt: prompt, aspect_ratio: aspectRatio, media_root: MEDIA_ROOT })
    if (!result.success) return errorText(`Pollinations image generation failed: ${result.error}`)
    return text({ localUrl: result.local_url, mimeType: result.mime_type, fileSize: result.file_size, model: result.model })
  })
)

const MOCK_POLL_INTERVAL_MS = 500
const MOCK_POLL_TIMEOUT_MS = 30_000

server.registerTool(
  'generate_video_mock',
  {
    title: 'Generate mock video (testing only, no cost)',
    description:
      'Generate a mock video for testing the pipeline — returns a local placeholder video, no real AI generation, ' +
      'no cost, no API key required. Use this to test workflows without spending real credits. Waits for the ' +
      'simulated generation delay (a few seconds) and returns the local URL once ready, or a still-generating ' +
      'note if it somehow exceeds a 30-second wait.',
    inputSchema: {
      prompt: z.string().optional().describe('Prompt text — recorded but has no effect on the mock output.'),
      duration: z.number().positive().optional(),
    },
  },
  withErrors(async ({ prompt, duration }) => {
    const created = createMockVideoJob({ prompt, duration, file_size: 0 })
    const deadline = Date.now() + MOCK_POLL_TIMEOUT_MS
    for (;;) {
      const status = getMockVideoJob(created.jobId)
      if (status.status === 'done') {
        return text({ localUrl: status.result.local_url, mimeType: status.result.mime_type, model: status.result.model })
      }
      if (status.status === 'error') return errorText(`Mock video generation failed: ${status.error}`)
      if (Date.now() > deadline) return text({ jobId: created.jobId, status: 'generating', note: 'Still generating after 30s — this should not normally happen for the mock provider.' })
      await new Promise((resolve) => setTimeout(resolve, MOCK_POLL_INTERVAL_MS))
    }
  })
)

const quickVideoScene = (args = {}) => ({
  name: args.name || 'Quick video',
  prompt: args.prompt || '',
  provider: args.provider || 'mock',
  mode: args.mode || 'text-to-video',
  seconds: Number(args.duration || args.seconds || 5),
  resolution: args.resolution || '480p',
  aspectRatio: args.aspectRatio || '9:16',
  generateAudio: Boolean(args.generateAudio ?? args.generate_audio ?? false),
  quantity: Number(args.quantity || 1),
  startAssetId: args.startAssetId ? Number(args.startAssetId) : null,
})

const quickImageScene = (args = {}) => ({
  kind: 'image',
  name: args.name || 'Quick image',
  prompt: args.prompt || '',
  provider: args.provider || 'mock',
  model: args.model || (args.provider === 'fal' ? 'flux-schnell' : 'mock-image'),
  mode: 'text-to-image',
  imageSize: args.imageSize || args.image_size || 'square',
  outputFormat: args.outputFormat || args.output_format || 'png',
  quantity: Number(args.quantity || 1),
})

const remixState = (args = {}) => ({
  editMode: args.mode === 'motion_transfer' ? 'motion_transfer' : 'product_swap',
  sourceAssetId: args.referenceVideoAssetId ? Number(args.referenceVideoAssetId) : null,
  preparedAssetId: args.preparedAssetId ? Number(args.preparedAssetId) : null,
  audioAssetId: args.audioAssetId ? Number(args.audioAssetId) : null,
  images: (args.referenceImageAssetIds || []).map((assetId, index) => ({ assetId: Number(assetId), role: index === 0 ? 'PRODUCT' : 'OTHER' })),
  keep: args.mode === 'motion_transfer'
    ? ['Camera movement', 'Timing / pacing', 'Action', 'Framing']
    : ['Camera movement', 'Timing / pacing', 'Scene order', 'Creator', 'Background', 'Lighting style'],
  change: args.mode === 'motion_transfer' ? ['Appearance/product from references'] : ['Product'],
  instructions: args.instruction || '',
  transcript: '',
  script: '',
  scriptApproved: false,
  observations: '',
  analysis: null,
})

function cleanCreativeId(args = {}, workspace = 'video') {
  if (args.creativeId) return Number(args.creativeId)
  if (args.projectContext?.creativeId) return Number(args.projectContext.creativeId)
  if (args.projectContext?.productTestId) {
    return createGeneratorCreative({ productTestId: Number(args.projectContext.productTestId), angle: args.title || `MCP ${workspace} draft` }).creativeId
  }
  return createQuickGeneratorCreative({ workspace, title: args.title || `MCP quick ${workspace}` }).creativeId
}

function saveFreshScenes(creativeId, scenes) {
  const workspace = generatorWorkspace(creativeId)
  return saveGeneratorScenes(creativeId, { revision: workspace.revision, scenes })
}

// ---------------------------------------------------------------------------
// CREATIVE WORKSTATION TOOLS — same service layer as the dashboard UI.
// ---------------------------------------------------------------------------

server.registerTool('creative_list_models', {
  title: 'Creative list models',
  description: 'Return the dashboard model registry/capabilities used by Image, Video, Remix, Studio, and Canvas. Read-only.',
  inputSchema: {},
}, withErrors(async () => {
  const options = await generatorOptions()
  return text({ models: options.models, capabilities: options.capabilities, imageModels: options.imageModels, falConfigured: options.falConfigured, fx: options.fx })
}))

server.registerTool('creative_list_assets', {
  title: 'Creative list assets',
  description: 'Search/select local Assets visible to the creative workspaces. Read-only.',
  inputSchema: { mimePrefix: z.string().optional(), limit: z.number().int().positive().max(100).optional() },
}, withErrors(async ({ mimePrefix, limit }) => {
  const options = await generatorOptions()
  const items = options.media.filter((asset) => !mimePrefix || String(asset.mime_type || '').startsWith(mimePrefix)).slice(0, limit || 50)
  return text({ assets: items })
}))

server.registerTool('creative_import_asset', {
  title: 'Creative import asset',
  description: 'Register an existing file already under local-media as an Asset, using the same safe local-media boundary as the dashboard.',
  inputSchema: { relativePath: z.string().min(1), mimeType: z.string().min(1), source: z.string().optional() },
}, withErrors(async ({ relativePath, mimeType, source }) => {
  const rel = String(relativePath || '').replace(/^\/+/, '').replace(/\\/g, '/')
  const abs = path.resolve(MEDIA_ROOT, rel)
  const rootWithSep = MEDIA_ROOT.endsWith(path.sep) ? MEDIA_ROOT : MEDIA_ROOT + path.sep
  if (abs !== MEDIA_ROOT && !abs.startsWith(rootWithSep)) return errorText('Refused to register outside local-media/.')
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return errorText('Asset file does not exist under local-media/.')
  const buf = fs.readFileSync(abs)
  const asset = getOrCreateAsset({ contentHash: createHash('sha256').update(buf).digest('hex'), relativePath: rel, mimeType, fileSize: buf.length, source: source || 'mcp_import' })
  return text({ asset })
}))

server.registerTool('creative_generate_image', {
  title: 'Creative generate image',
  description: 'Create or update a clean Image quick draft, quote it, and optionally start generation through M5 when confirmed:true is supplied.',
  inputSchema: {
    prompt: z.string().min(1),
    provider: z.string().optional(),
    model: z.string().optional(),
    imageSize: z.string().optional(),
    outputFormat: z.string().optional(),
    quantity: z.number().int().positive().max(4).optional(),
    creativeId: z.number().int().positive().optional(),
    projectContext: z.object({ productTestId: z.number().int().positive().optional(), creativeId: z.number().int().positive().optional() }).optional(),
    confirmed: z.boolean().optional(),
  },
}, withErrors(async (args) => {
  const creativeId = cleanCreativeId(args, 'image')
  const workspace = saveFreshScenes(creativeId, [quickImageScene(args)])
  const imageScenes = workspace.scenes.filter((scene) => scene.kind === 'image')
  const quote = quoteGenerator(creativeId, { revision: workspace.revision, sceneIds: imageScenes.map((scene) => scene.id) }).quote
  if (args.confirmed !== true) return text({ creativeId, quote, workspace: generatorWorkspace(creativeId), note: 'confirmation_required_before_dispatch' })
  await startGenerator(creativeId, { confirmed: true, token: quote.token, revision: quote.revision })
  return text({ creativeId, workspace: generatorWorkspace(creativeId) })
}))

server.registerTool('creative_generate_video', {
  title: 'Creative generate video',
  description: 'Create or update a clean Video quick draft, quote it, and optionally start generation through M5 when confirmed:true is supplied.',
  inputSchema: {
    prompt: z.string().min(1),
    provider: z.string().optional(),
    mode: z.enum(['text-to-video', 'image-to-video']).optional(),
    duration: z.number().int().positive().optional(),
    seconds: z.number().int().positive().optional(),
    resolution: z.string().optional(),
    aspectRatio: z.string().optional(),
    generateAudio: z.boolean().optional(),
    generate_audio: z.boolean().optional(),
    quantity: z.number().int().positive().max(4).optional(),
    startAssetId: z.number().int().positive().optional(),
    creativeId: z.number().int().positive().optional(),
    projectContext: z.object({ productTestId: z.number().int().positive().optional(), creativeId: z.number().int().positive().optional() }).optional(),
    confirmed: z.boolean().optional(),
  },
}, withErrors(async (args) => {
  const creativeId = cleanCreativeId(args, 'video')
  const workspace = saveFreshScenes(creativeId, [quickVideoScene(args)])
  const sceneIds = workspace.scenes.filter((scene) => scene.kind !== 'image').map((scene) => scene.id)
  const quote = quoteGenerator(creativeId, { revision: workspace.revision, sceneIds }).quote
  if (args.confirmed !== true) return text({ creativeId, quote, workspace: generatorWorkspace(creativeId), note: 'confirmation_required_before_dispatch' })
  await startGenerator(creativeId, { confirmed: true, token: quote.token, revision: quote.revision })
  return text({ creativeId, workspace: generatorWorkspace(creativeId) })
}))

server.registerTool('creative_plan_scenes', {
  title: 'Creative plan scenes',
  description: 'Persist an editable scene plan into the same Video workspace the dashboard opens. Local/free; never dispatches generation.',
  inputSchema: {
    brief: z.string().min(1),
    targetDuration: z.number().int().positive().optional(),
    provider: z.string().optional(),
    creativeId: z.number().int().positive().optional(),
    projectContext: z.object({ productTestId: z.number().int().positive().optional(), creativeId: z.number().int().positive().optional() }).optional(),
  },
}, withErrors(async (args) => {
  const creativeId = cleanCreativeId(args, 'video')
  const inferred = inferStudioFromQuickPrompt(args.brief, 'en')
  const outline = generateSceneOutline({ ...inferred, targetDuration: args.targetDuration || 20 })
  const prompts = generateOmniPrompts(inferred, outline)
  const scenes = prompts.map((prompt, index) => quickVideoScene({
    name: outline[index]?.purpose || `Scene ${index + 1}`,
    prompt: prompt.promptText || outline[index]?.visualDescription || args.brief,
    provider: args.provider || 'mock',
    duration: Math.max(4, Math.min(15, Number(prompt.duration) || 5)),
  }))
  const workspace = saveFreshScenes(creativeId, scenes)
  return text({ creativeId, sceneCount: workspace.scenes.length, workspace })
}))

server.registerTool('creative_create_remix', {
  title: 'Creative create remix',
  description: 'Create a reference-first Remix draft in the dashboard. Local/free until creative_generate_scenes is called with confirmed:true.',
  inputSchema: {
    referenceVideoAssetId: z.number().int().positive(),
    referenceImageAssetIds: z.array(z.number().int().positive()).optional(),
    instruction: z.string().min(1),
    mode: z.enum(['motion_transfer', 'object_swap']).optional(),
    provider: z.string().optional(),
    duration: z.number().int().positive().optional(),
    resolution: z.string().optional(),
    aspectRatio: z.string().optional(),
    creativeId: z.number().int().positive().optional(),
    projectContext: z.object({ productTestId: z.number().int().positive().optional(), creativeId: z.number().int().positive().optional() }).optional(),
  },
}, withErrors(async (args) => {
  const creativeId = cleanCreativeId(args, 'remix')
  const scene = quickVideoScene({ ...args, name: 'Reference remix', mode: 'reference-to-video', prompt: args.instruction, aspectRatio: args.aspectRatio || 'auto' })
  scene.remix = remixState(args)
  const workspace = saveFreshScenes(creativeId, [scene])
  return text({ creativeId, workspace })
}))

server.registerTool('creative_generate_scenes', {
  title: 'Creative generate scenes',
  description: 'Quote and dispatch selected ready scenes through existing M5 safety. Requires confirmed:true before any paid provider request.',
  inputSchema: { creativeId: z.number().int().positive(), sceneIds: z.array(z.string()).optional(), confirmed: z.boolean() },
}, withErrors(async ({ creativeId, sceneIds, confirmed }) => {
  if (confirmed !== true) return errorText('confirmed:true is required before production can spend money.')
  const workspace = generatorWorkspace(creativeId)
  const selected = sceneIds?.length ? sceneIds : workspace.scenes.filter((scene) => !['Complete', 'Queued', 'Generating', 'Reconciliation required'].includes(scene.status)).map((scene) => scene.id)
  const quote = quoteGenerator(creativeId, { revision: workspace.revision, sceneIds: selected }).quote
  const result = await startGenerator(creativeId, { confirmed: true, token: quote.token, revision: quote.revision })
  return text({ creativeId, quote, result, workspace: generatorWorkspace(creativeId) })
}))

server.registerTool('creative_get_generation', {
  title: 'Creative get generation',
  description: 'Read the current dashboard creative draft, scenes, statuses, results, history and final asset. Read-only.',
  inputSchema: { creativeId: z.number().int().positive() },
}, withErrors(async ({ creativeId }) => text(generatorWorkspace(creativeId))))

server.registerTool('creative_assemble', {
  title: 'Creative assemble',
  description: 'Assemble approved scene Assets into a final local MP4 using the same M6 path as the dashboard. Local/free.',
  inputSchema: { creativeId: z.number().int().positive() },
}, withErrors(async ({ creativeId }) => {
  const workspace = generatorWorkspace(creativeId)
  const result = await assembleGenerator(creativeId, { revision: workspace.revision })
  return text(result)
}))

// ---------------------------------------------------------------------------
// PRODUCT TEST TOOLS
// ---------------------------------------------------------------------------

server.registerTool(
  'list_product_tests',
  {
    title: 'List Product Tests',
    description: 'List all Product Tests with their status, iteration count, creative count, and actual generation spend so far (settled, real-currency).',
    inputSchema: {},
  },
  withErrors(async () => {
    const tests = ptRepo.listProductTests()
    const withSpend = tests.map((t) => {
      const iterations = ptRepo.listIterationsForTest(t.id)
      let spendMinor = 0
      let currency = t.currency || 'EUR'
      for (const it of iterations) {
        const summary = getBudgetSummary(it.id)
        spendMinor += summary.currentSettledSpendMinor
        currency = summary.currency
      }
      return { id: t.id, code: t.code, productName: t.product_name, status: t.status, market: t.market, language: t.language, iterationCount: t.iteration_count, creativeCount: t.creative_count, generationSpendMinor: spendMinor, currency }
    })
    return text(withSpend)
  })
)

server.registerTool(
  'get_product_test',
  {
    title: 'Get a Product Test with full lineage',
    description: 'Get a Product Test by id with its policy snapshot, iterations, creatives, production runs, and current budget state for each iteration.',
    inputSchema: { productTestId: z.number().int().positive() },
  },
  withErrors(async ({ productTestId }) => {
    const productTest = ptRepo.getProductTestWithLineage(productTestId)
    if (!productTest) return errorText(`No product test with id ${productTestId}.`)
    const iterations = ptRepo.listIterationsForTest(productTestId).map((it) => ({
      ...it,
      creatives: ptRepo.listCreativesForIteration(it.id),
      budget: getBudgetSummary(it.id),
    }))
    return text({ productTest, iterations })
  })
)

server.registerTool(
  'create_product_test',
  {
    title: 'Create a Product Test',
    description:
      'Create a new Product Test for a product. Creates the Product and the ProductTest together, freezes the ' +
      'default test policy into it, and computes the contribution margin from the prices given (informational ' +
      'only — never blocks creation, even a negative margin).',
    inputSchema: {
      productName: z.string().min(1),
      productUrl: z.string().optional(),
      supplierUrl: z.string().optional(),
      market: z.string().min(1),
      language: z.string().min(1),
      sellingPriceMinor: z.number().int(),
      productCostMinor: z.number().int(),
      shippingCostMinor: z.number().int(),
      currency: z.string().optional(),
      notes: z.string().optional(),
    },
  },
  withErrors(async (args) => {
    const productId = createProduct({ name: args.productName, productUrl: args.productUrl || null, supplierUrl: args.supplierUrl || null, notes: args.notes || null })
    const productTest = ptRepo.createProductTestForProduct({
      productId,
      market: args.market,
      language: args.language,
      sellingPriceMinor: args.sellingPriceMinor,
      productCostMinor: args.productCostMinor,
      shippingCostMinor: args.shippingCostMinor,
      currency: args.currency || 'EUR',
    })
    const margin = ptRepo.computeContributionMargin({
      sellingPriceMinor: args.sellingPriceMinor,
      productCostMinor: args.productCostMinor,
      shippingCostMinor: args.shippingCostMinor,
      policy: productTest.policy,
    })
    return text({ productTest, margin })
  })
)

server.registerTool(
  'generate_research',
  {
    title: 'Generate AI product research',
    description:
      'Use AI (Groq) to research a Product Test and produce a structured research draft: what the product is, ' +
      'the primary customer avatar, key moments, emotional triggers, and organic potential — never a numeric ' +
      'score. Optionally fetches the product\'s own page (SSRF-guarded) and treats its text as untrusted source ' +
      'material. Writes nothing to the database — returns the draft for review before generate_strategy/' +
      'approve_strategy.',
    inputSchema: {
      productTestId: z.number().int().positive(),
      useSourcePage: z.boolean().optional().describe('If true, fetch the product\'s own page and use its content as source material.'),
      confirmed: z.boolean().describe('Explicit permission to use AI provider credits.'),
    },
  },
  withErrors(async ({ productTestId, useSourcePage, confirmed }) => {
    if (confirmed !== true) return errorText('confirmation_required')
    const productTest = ptRepo.getProductTestWithLineage(productTestId)
    if (!productTest) return errorText(`No product test with id ${productTestId}.`)
    let fetchResult = null
    if (useSourcePage) {
      const url = productTest.product_url || productTest.supplier_url
      if (url) fetchResult = await fetchProductPageText(url)
    }
    const result = await generateResearchDraft({ productTest, fetchResult })
    if (!result.ok) return errorText(`Research generation failed: ${result.error}`)
    return text({ draft: result.draft, sourceFetchOk: !!(fetchResult && fetchResult.ok), sourceFetchReason: fetchResult && !fetchResult.ok ? fetchResult.reason : null })
  })
)

server.registerTool(
  'generate_strategy',
  {
    title: 'Generate AI strategy draft',
    description:
      'Given a research draft (possibly human-edited), use AI to propose a test matrix of angles and executions ' +
      '— roughly 3 angles x 4 executions for a targetCount of 12. Never proposes a price. Writes nothing to the ' +
      'database — returns the draft for review before approve_strategy.',
    inputSchema: {
      researchDraft: z.record(z.string(), z.any()).describe('A research draft, from generate_research (possibly edited).'),
      confirmed: z.boolean().describe('Explicit permission to use AI provider credits.'),
      targetCount: z.number().int().positive().optional().describe('Defaults to 12.'),
      mode: z.enum(['exploratory', 'confirmatory']).optional().describe('Defaults to exploratory.'),
    },
  },
  withErrors(async ({ researchDraft, targetCount, mode, confirmed }) => {
    if (confirmed !== true) return errorText('confirmation_required')
    const result = await generateStrategyDraft({ researchDraft, targetCount: targetCount || 12, mode: mode || 'exploratory' })
    if (!result.ok) return errorText(`Strategy generation failed: ${result.error}`)
    return text({ draft: result.draft, duplicateWarnings: result.duplicateWarnings })
  })
)

server.registerTool(
  'approve_strategy',
  {
    title: 'Approve a strategy draft (creates real data)',
    description:
      'Approve a strategy draft, atomically creating a real Iteration and all its Creatives in the database. ' +
      'This is IRREVERSIBLE — the Iteration and Creatives persist once created. Only call this after the user ' +
      'has reviewed the research and strategy drafts and explicitly asked you to proceed.',
    inputSchema: {
      productTestId: z.number().int().positive(),
      mode: z.enum(['exploratory', 'confirmatory']),
      researchDraft: z.record(z.string(), z.any()),
      strategyRows: z.array(z.record(z.string(), z.any())).min(1).describe('Flattened rows: [{angle, format, hookFamily, hookText, coreScenario, differentiationNote, defaultProductionMethod}, ...]'),
      policyOverrides: z.record(z.string(), z.any()).optional(),
    },
  },
  withErrors(async (args) => {
    const check = validateResearchDraft(args.researchDraft)
    if (!check.valid) return errorText(`researchDraft is invalid: ${check.errors.join('; ')}`)
    const iterationId = ptRepo.approveStrategyForProductTest({
      productTestId: args.productTestId,
      mode: args.mode,
      researchDraft: args.researchDraft,
      strategyRows: args.strategyRows,
      policyOverrides: args.policyOverrides || {},
      targetCount: args.strategyRows.length,
    })
    const iteration = ptRepo.getIterationWithLineage(iterationId)
    const creatives = ptRepo.listCreativesForIteration(iterationId)
    return text({ iteration, creatives })
  })
)

server.registerTool(
  'list_creatives',
  {
    title: 'List Creatives for an Iteration',
    description: 'List all Creatives for an Iteration with their angle, format, hook, approval status, and production run/publication counts.',
    inputSchema: { iterationId: z.number().int().positive() },
  },
  withErrors(async ({ iterationId }) => text(ptRepo.listCreativesForIteration(iterationId)))
)

server.registerTool(
  'get_production_plan_status',
  {
    title: 'Get production plan status for an Iteration',
    description:
      'Preflight every planned, unfrozen ProductionRun in an Iteration: which are ready to start, which are ' +
      'blocked and why (missing provider, missing asset, FX rate missing), current settled spend and active ' +
      'reservations against the Iteration\'s budget target/ceiling. Read-only — never dispatches anything.',
    inputSchema: { iterationId: z.number().int().positive() },
  },
  withErrors(async ({ iterationId }) => text(preflightProduction(iterationId, 'all_eligible')))
)

server.registerTool(
  'start_production',
  {
    title: 'Start production dispatch (REAL SPEND — requires confirmation)',
    description:
      'Start production dispatch for specific ProductionRuns in an Iteration: freezes their specs and begins ' +
      'real Job execution against real providers (Replicate, fal.ai, etc.), which spends real money for any ' +
      'paid provider. This is NOT reversible once dispatched. Do not call this tool unless the user has ' +
      'explicitly confirmed they want production to start — pass confirmed:true only after that explicit ' +
      'confirmation, never proactively or by inference.',
    inputSchema: {
      iterationId: z.number().int().positive(),
      productionRunIds: z.union([z.array(z.number().int().positive()), z.literal('all_eligible')]),
      confirmed: z.boolean().describe('Must be true. Set this only after the user has explicitly confirmed they want to spend on real production.'),
    },
  },
  withErrors(async ({ iterationId, productionRunIds, confirmed }) => {
    if (confirmed !== true) {
      return errorText('confirmed must be true, and only after the user has explicitly said to proceed. This call spends real money once dispatched — it was not started.')
    }
    const selected = productionRunIds === 'all_eligible' ? preflightProduction(iterationId, 'all_eligible').runs.filter((run) => run.state === 'READY').map((run) => run.runId) : productionRunIds
    const result = await startProduction(iterationId, selected)
    return text(result)
  })
)

// ---------------------------------------------------------------------------
// MARKETING STUDIO TOOLS
// ---------------------------------------------------------------------------

server.registerTool('assemble_production_run', {
  description: 'Assemble completed local video Assets in scene order. Local/free, idempotent; never generates or retries paid jobs.',
  inputSchema: { productionRunId: z.number().int().positive() },
}, withErrors(async ({ productionRunId }) => text(await assembleProductionRun(productionRunId))))

server.registerTool('get_review_queue', {
  description: 'Latest completed final video per creative, with review state and lineage. Read only.', inputSchema: {},
}, withErrors(async () => text(reviewQueue())))

server.registerTool('review_creative', {
  description: 'Record an operator review of a completed final video. Revision does not generate or spend. Approval makes this run publication-ready.',
  inputSchema: { creativeId: z.number().int().positive(), productionRunId: z.number().int().positive(), decision: z.enum(['approved', 'rejected', 'regenerating']), note: z.string().max(4000).optional() },
}, withErrors(async (args) => text(reviewCreative(args))))

server.registerTool('get_analysis_summary', {
  description: 'Deterministic analysis using the latest cumulative metric snapshot per publication. Includes explicit sufficiency rules and missing data.',
  inputSchema: { productTestId: z.number().int().positive().optional(), iterationId: z.number().int().positive().optional(), creativeId: z.number().int().positive().optional() },
}, withErrors(async (args) => text(analysisSummary(args))))

server.registerTool(
  'list_studio_sessions',
  {
    title: 'List Marketing Studio sessions',
    description: 'List all Marketing Studio sessions (ad creative packages) with id, name, and timestamps. Does not include the full studio payload — use get_studio_prompts for one session\'s content.',
    inputSchema: {},
  },
  withErrors(async () => text(listMarketingStudioSessions()))
)

server.registerTool(
  'create_studio_session',
  {
    title: 'Create a Marketing Studio session (Quick Mode)',
    description:
      'Create a new Marketing Studio session from a one-line description — infers product, format, characters, ' +
      'and a scene outline automatically (the same Quick Mode logic the dashboard UI uses), then saves it. ' +
      'Returns the new session id.',
    inputSchema: {
      quickPrompt: z.string().min(1).describe('e.g. "Podcast francais 30s pour Calme, boisson anti-stress, cible femmes 25-45, ton authentique"'),
      language: z.enum(['fr', 'en']).optional(),
    },
  },
  withErrors(async ({ quickPrompt, language }) => {
    const inferred = inferStudioFromQuickPrompt(quickPrompt, language)
    const format = formatById(inferred.format)
    const now = Date.now()
    const id = `ms_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const name = `${inferred.product.name} · ${format ? format.name : 'Marketing Studio'}`
    const saved = upsertMarketingStudioSession({ id, name, studioJson: inferred })
    return text({ id: saved.id, name: saved.name, format: inferred.format, sceneCount: inferred.scenes.length })
  })
)

server.registerTool(
  'get_studio_prompts',
  {
    title: 'Get generated prompts for a Studio session',
    description:
      'Get the generated Gemini Omni Flash / Seedance prompts for a Marketing Studio session\'s current scenes ' +
      '— clip prompts ready to paste into Google Flow, one per scene.',
    inputSchema: { sessionId: z.string().min(1) },
  },
  withErrors(async ({ sessionId }) => {
    const session = getMarketingStudioSession(sessionId)
    if (!session) return errorText(`No Marketing Studio session with id ${sessionId}.`)
    const studio = session.studioJson
    const scenes = Array.isArray(studio.scenes) && studio.scenes.length ? studio.scenes : generateSceneOutline(studio)
    const prompts = generateOmniPrompts(studio, scenes)
    return text({ sessionName: session.name, format: studio.format, prompts })
  })
)

// ---------------------------------------------------------------------------
// ASSET TOOLS
// ---------------------------------------------------------------------------

server.registerTool(
  'list_media_library',
  {
    title: 'List local media library files',
    description: 'List files in the local media library (local-media/), optionally scoped to a subfolder (e.g. "temp" or "projects/default/assets").',
    inputSchema: { folder: z.string().optional() },
  },
  withErrors(async ({ folder }) => {
    const rel = String(folder || '').replace(/^\/+/, '')
    const target = path.resolve(MEDIA_ROOT, rel)
    const rootWithSep = MEDIA_ROOT.endsWith(path.sep) ? MEDIA_ROOT : MEDIA_ROOT + path.sep
    if (target !== MEDIA_ROOT && !target.startsWith(rootWithSep)) return errorText('Refused to list outside local-media/.')
    if (!fs.existsSync(target)) return text([])

    const out = []
    const walk = (dir, depth) => {
      if (depth > 4) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, depth + 1)
        else {
          const stat = fs.statSync(full)
          out.push({ path: path.relative(MEDIA_ROOT, full).split(path.sep).join('/'), sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() })
        }
      }
    }
    walk(target, 0)
    return text(out)
  })
)

server.registerTool(
  'get_health',
  {
    title: 'Check provider/backend health',
    description: 'Check which providers are configured and operational (booleans only — never key values), and whether the database is reachable. Calls the main backend\'s real /health endpoint on 127.0.0.1.',
    inputSchema: {},
  },
  withErrors(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/health`)
      if (res.ok) return text(await res.json())
    } catch {
      // Main backend may not be running — fall back to this process's own view.
    }
    return text({ ok: true, status: 'MCP server up; main backend on 8787 unreachable', db: checkDbConnectivity() })
  })
)

// ---------------------------------------------------------------------------
// HTTP transport — SSE. Binds to 127.0.0.1 only.
// ---------------------------------------------------------------------------

const transports = new Map()

const httpServer = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = new URL(req.url, `http://127.0.0.1:${MCP_PORT}`)

  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true, status: 'MCP server running', activeSessions: transports.size }))
    return
  }

  if (req.method === 'GET' && url.pathname === '/sse') {
    ;(async () => {
      try {
        const transport = new SSEServerTransport('/messages', res)
        transports.set(transport.sessionId, transport)
        transport.onclose = () => transports.delete(transport.sessionId)
        await server.connect(transport)
        console.log(`[mcp] SSE session established: ${transport.sessionId}`)
      } catch (error) {
        console.error('[mcp] error establishing SSE stream:', error && error.message ? error.message : error)
        if (!res.headersSent) {
          res.writeHead(500)
          res.end('Error establishing SSE stream')
        }
      }
    })()
    return
  }

  if (req.method === 'POST' && url.pathname === '/messages') {
    const sessionId = url.searchParams.get('sessionId')
    const transport = sessionId ? transports.get(sessionId) : null
    if (!transport) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('No active SSE session for that sessionId. Connect to /sse first.')
      return
    }
    transport.handlePostMessage(req, res).catch((error) => {
      console.error('[mcp] error handling message:', error && error.message ? error.message : error)
      if (!res.headersSent) {
        res.writeHead(500)
        res.end('Error handling message')
      }
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: false, error: 'Not found' }))
})

// 127.0.0.1 only — never 0.0.0.0. This process must not be reachable from
// the network, same as the main backend.
httpServer.listen(MCP_PORT, '127.0.0.1', () => {
  console.log(`MCP server running at http://127.0.0.1:${MCP_PORT}/sse`)
})

process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})
process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
