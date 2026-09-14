import fs from 'node:fs'
import { uploadReference, analyzeReference, validateReferenceAsset } from './referenceRemix.mjs'
import { promptForRemix, reuseGeneratorScene } from './creativeGenerator.mjs'
import { getDb, getFxRate, setFxRate } from '../db/repository.mjs'
import { reviewQueue, reviewCreative, approveManualPlan, analysisSummary, runDetails } from './operator.mjs'
import { assembleProductionRun, completeExternalRun, videoTool, runVideoTool } from './assembly.mjs'
import { generatorOptions, createGeneratorCreative, generatorWorkspace, saveGeneratorScenes, estimateGenerator, quoteGenerator, startGenerator, chooseGeneratorResult, assembleGenerator } from './creativeGenerator.mjs'
import { quoteCanvas, startCanvas, canvasProductionStatus } from './canvasProduction.mjs'

export async function operatorRoute(req, res, url, send) {
  if (!url.pathname.startsWith('/api/operator/')) return false
  try {
    if (req.method === 'POST' && url.pathname === '/api/operator/references/upload') { send(res,200,{ok:true,...await uploadReference(req,url)}); return true }
    let body = {}
    if (req.method === 'POST') {
      let bytes = 0, text = ''
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 1000000) throw new Error('Request too large.'); text += chunk }
      body = JSON.parse(text || '{}')
    }
    let data
    const route = url.pathname.slice('/api/operator/'.length)
    const canvas=/^canvas\/([a-zA-Z0-9_-]+)\/(quote|start|status)$/.exec(route)
    if(canvas){
      if(req.method==='POST'&&canvas[2]==='quote')data=quoteCanvas(canvas[1],body)
      else if(req.method==='POST'&&canvas[2]==='start')data=await startCanvas(canvas[1],body)
      else if(req.method==='GET'&&canvas[2]==='status')data=canvasProductionStatus(canvas[1])
      else throw new Error('Unknown Canvas production action.')
      send(res,200,{ok:true,...data});return true
    }
    if (req.method === 'POST' && route === 'references/analyze') { send(res,200,{ok:true,analysis:await analyzeReference(body)}); return true }
    if (req.method === 'POST' && route === 'references/validate') { send(res,200,{ok:true,...await validateReferenceAsset(body.assetId,body.kind)}); return true }
    if (req.method === 'POST' && /^generator\/\d+\/remix-prompt$/.test(route)) { send(res,200,{ok:true,...promptForRemix(Number(route.split('/')[1]),body.scene)}); return true }
    const generator = /^generator\/(\d+)(?:\/(scenes|estimate|quote|start|result|assemble|reuse))?$/.exec(route)
    if (req.method === 'GET' && route === 'generator/options') data = await generatorOptions()
    else if (req.method === 'POST' && route === 'generator/creatives') data = createGeneratorCreative(body)
    else if (generator && req.method === 'GET' && !generator[2]) data = { workspace: generatorWorkspace(Number(generator[1])) }
    else if (generator && req.method === 'POST') {
      const id = Number(generator[1]), action = generator[2]
      if (action === 'scenes') data = { workspace: saveGeneratorScenes(id, body) }
      else if (action === 'estimate') data = estimateGenerator(id, body.sceneIds)
      else if (action === 'quote') data = quoteGenerator(id, body)
      else if (action === 'start') data = await startGenerator(id, body)
      else if (action === 'result') data = { workspace: chooseGeneratorResult(id, body) }
      else if (action === 'reuse') data = reuseGeneratorScene(id,body)
      else if (action === 'assemble') data = { workspace: await assembleGenerator(id, body) }
      else throw new Error('Unknown generator action.')
    }
    else if (req.method === 'GET' && route === 'review') data = { items: reviewQueue() }
    else if (req.method === 'POST' && route === 'review') data = { item: reviewCreative(body) }
    else if (req.method === 'POST' && route === 'plan') data = { item: approveManualPlan(body) }
    else if (req.method === 'GET' && route === 'analysis') data = analysisSummary(Object.fromEntries(url.searchParams))
    else if (req.method === 'GET' && /^runs\/\d+$/.test(route)) data = runDetails(Number(route.split('/')[1]))
    else if (req.method === 'POST' && /^runs\/\d+\/assemble$/.test(route)) data = await assembleProductionRun(Number(route.split('/')[1]))
    else if (req.method === 'POST' && /^runs\/\d+\/external-final$/.test(route)) data = await completeExternalRun(Number(route.split('/')[1]), Number(body.assetId))
    else if (req.method === 'GET' && route === 'settings') {
      let ffmpeg = null
      try { ffmpeg = await videoTool() } catch {}
      data = { ffmpeg, fx: getFxRate('USD', 'EUR') }
    } else if (req.method === 'POST' && route === 'settings') {
      if (body.ffmpegPath) {
        if (typeof body.ffmpegPath !== 'string' || !fs.existsSync(body.ffmpegPath) || (await runVideoTool(body.ffmpegPath, ['-version'], 10000)).code !== 0) throw new Error('Select an existing FFmpeg executable.')
        getDb().prepare("INSERT INTO app_settings(key,value) VALUES ('ffmpeg_path',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(body.ffmpegPath))
      }
      if (body.fxRate !== undefined) {
        if (!String(body.fxSource || '').trim()) throw new Error('Enter the source of the verified exchange rate.')
        setFxRate({ fromCurrency: 'USD', toCurrency: 'EUR', rate: body.fxRate, source: body.fxSource })
      }
      data = { saved: true }
    } else { send(res, 404, { ok: false, error: 'Operator route not found.' }); return true }
    send(res, 200, { ok: true, ...data })
  } catch (error) { send(res, 400, { ok: false, error: error.message }) }
  return true
}
