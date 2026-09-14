import fs from 'node:fs'
import { getDb, getFxRate, setFxRate } from '../db/repository.mjs'
import { reviewQueue, reviewCreative, approveManualPlan, analysisSummary, runDetails } from './operator.mjs'
import { assembleProductionRun, completeExternalRun, videoTool, runVideoTool } from './assembly.mjs'

export async function operatorRoute(req, res, url, send) {
  if (!url.pathname.startsWith('/api/operator/')) return false
  try {
    let body = {}
    if (req.method === 'POST') {
      let bytes = 0, text = ''
      for await (const chunk of req) { bytes += chunk.length; if (bytes > 1000000) throw new Error('Request too large.'); text += chunk }
      body = JSON.parse(text || '{}')
    }
    let data
    const route = url.pathname.slice('/api/operator/'.length)
    if (req.method === 'GET' && route === 'review') data = { items: reviewQueue() }
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
