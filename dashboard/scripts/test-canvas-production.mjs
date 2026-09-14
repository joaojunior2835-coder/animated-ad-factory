import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aaf-canvas-production-'))
process.env.FACTORY_DB_PATH=path.join(temp,'factory.db');process.env.FACTORY_MEDIA_ROOT=path.join(temp,'media');process.env.MOCK_VIDEO_DELAY_MS='0'
for(const k of ['FAL_API_KEY','REPLICATE_API_TOKEN','POLLINATIONS_API_KEY','OPENAI_API_KEY','GROQ_API_KEY'])process.env[k]=''
fs.mkdirSync(process.env.FACTORY_MEDIA_ROOT)
const {runMigrations}=await import('../server/db/migrate.mjs');runMigrations({dbPath:process.env.FACTORY_DB_PATH,log:{log(){}}})
const repo=await import('../server/db/repository.mjs'),pt=await import('../server/db/productTestRepository.mjs'),cg=await import('../server/lib/creativeGenerator.mjs'),cp=await import('../server/lib/canvasProduction.mjs'),dispatcher=await import('../server/lib/dispatcher.mjs')
const graph=await import('../src/lib/nodeCanvasModel.js'),compiler=await import('../src/lib/nodeCanvasExecution.js'),{canvasDraftSignature,mergeCanvasProduction,canvasProductionInputsMatch}=await import('../src/lib/canvasProductionBinding.js')
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Network prohibited in Canvas production tests')}
const productId=repo.createProduct({name:'Canvas fixture'}),test=pt.createProductTestForProduct({productId,market:'FR',language:'fr'}),creativeId=cg.createGeneratorCreative({productTestId:test.id,angle:'Canvas scope'}).creativeId
const db=repo.getDb(),save=canvas=>repo.upsertNodeCanvasProject({id:'default',name:'Isolated fixture',canvasJson:canvas})
let passed=0;const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)}
let board=graph.addStarterGraph(graph.emptyNodeCanvas(),'image-video').canvas
board={...board,nodes:board.nodes.map(n=>({...n,data:{...n.data,...(n.type==='image_generator'?{image_size:'square_hd'}:n.type==='video_generator'?{resolution:'480p',duration_seconds:5,aspect_ratio:'9:16',generate_audio:false}:{})}}))}
const output=board.nodes.find(n=>n.type==='output'),image=board.nodes.find(n=>n.type==='image_generator'),video=board.nodes.find(n=>n.type==='video_generator')
let q
try{
await check('Scope validation fails closed without saved Canvas/context or malformed input',()=>{assert.throws(()=>cp.quoteCanvas('default',{creativeId,nodeIds:[output.id]}),/Save/);save(board);assert.throws(()=>cp.quoteCanvas('default',{creativeId:999,nodeIds:[output.id]}),/Creative/);const broken=graph.updateNodeData(board,video.id,{resolution:'fake'});save(broken);assert.throws(()=>cp.quoteCanvas('default',{creativeId,nodeIds:[output.id]}),/resolution/);save(board);assert.equal(db.prepare('SELECT count(*) n FROM job').get().n,0)})
await check('Selected output compiles exactly its image→video closure with fixed dependency',()=>{q=cp.quoteCanvas('default',{creativeId,nodeIds:[output.id]}).quote;assert.equal(q.outputCount,2);assert.equal(q.steps[0].capability,'generate_image');assert.equal(q.steps[1].dependencies[0].stepId,q.steps[0].id);assert.equal(q.totalMinor,0);assert.equal(q.attemptLimit,1);assert.equal(repo.getProductionRunExecution(q.runId).jobs.length,0);assert.equal(db.prepare('SELECT count(*) n FROM budget_reservation').get().n,0)})
await check('False/string confirmation, changed graph and changed context cannot start',async()=>{for(const confirmed of [undefined,false,'true'])await assert.rejects(cp.startCanvas('default',{token:q.token,creativeId,confirmed}));save(graph.updateNodeData(board,image.id,{user_prompt:'changed'}));await assert.rejects(cp.startCanvas('default',{token:q.token,creativeId,confirmed:true}),/changed/);save(board);await assert.rejects(cp.startCanvas('default',{token:q.token,creativeId:999,confirmed:true}),/context/);assert.equal(db.prepare('SELECT count(*) n FROM job').get().n,0)})
await check('M5 materializes once; video waits for image Asset; duplicate start cannot dispatch',async()=>{await cp.startCanvas('default',{token:q.token,creativeId,confirmed:true});let run=repo.getProductionRunExecution(q.runId);assert.equal(run.jobs.length,2);assert.equal(run.jobs[0].status,'generating');assert.equal(run.jobs[1].status,'planned');assert.equal(repo.listJobDependencies(run.jobs[1].id)[0].depends_on_job_id,run.jobs[0].id);await assert.rejects(cp.startCanvas('default',{token:q.token,creativeId,confirmed:true}));await assert.rejects(async()=>cp.quoteCanvas('default',{creativeId,nodeIds:[output.id]}),/existing Canvas request/);await dispatcher.reconcileInFlightJobs();run=repo.getProductionRunExecution(q.runId);assert.ok(run.jobs.every(j=>j.status==='complete'));assert.equal(run.status,'complete');assert.ok(run.final_asset_id)})
await check('A completed unchanged scope cannot be quoted again before any browser status save',()=>{
  save(board)
  const before=db.prepare('SELECT count(*) n FROM production_run').get().n
  assert.throws(()=>cp.quoteCanvas('default',{creativeId,nodeIds:[output.id]}),/current outputs/)
  assert.equal(db.prepare('SELECT count(*) n FROM production_run').get().n,before)
  assert.equal(db.prepare('SELECT count(*) n FROM job').get().n,2)
})
await check('Arriving dependency Assets match actual Jobs without making a frozen draft stale',()=>{
  const status=cp.canvasProductionStatus('default'),current=mergeCanvasProduction(board,status)
  assert.ok(current.nodes.filter(n=>[image.id,video.id].includes(n.id)).every(n=>n.data.stale===false&&n.data.result_asset_id))
  const videoStatus=status.nodes.find(n=>n.nodeId===video.id),source=current.nodes.find(n=>n.id===image.id)
  assert.equal(videoStatus.inputBindings[0].assetId,source.data.result_asset_id)
  assert.ok(canvasProductionInputsMatch(current,videoStatus))
  assert.equal(current.nodes.find(n=>n.id===output.id).data.variations.length,1)
  assert.deepEqual(mergeCanvasProduction(current,status),current)
})
await check('Changing selected upstream output stays stale across repeated status polls',()=>{
  const status=cp.canvasProductionStatus('default'),current=mergeCanvasProduction(board,status)
  const source=current.nodes.find(n=>n.id===image.id)
  const changed=graph.updateNodeData(current,image.id,{selected_asset_id:source.data.result_asset_id+10000})
  const refreshed=mergeCanvasProduction(changed,status),again=mergeCanvasProduction(refreshed,status)
  assert.equal(refreshed.nodes.find(n=>n.id===image.id).data.stale,false)
  assert.equal(refreshed.nodes.find(n=>n.id===video.id).data.stale,true)
  assert.equal(again.nodes.find(n=>n.id===video.id).data.stale,true)
  assert.equal(again.nodes.find(n=>n.id===image.id).data.selected_asset_id,source.data.result_asset_id+10000)
  assert.notEqual(compiler.canvasNodeFingerprint(again,video.id),again.nodes.find(n=>n.id===video.id).data.generated_fingerprint)
})
await check('Rewired sinks never receive an old run as if it belonged to their new path',()=>{
  const fresh=graph.newNode('output',1200,500)
  const edited={...board,nodes:[...board.nodes,fresh],connections:board.connections.map(w=>w.to_node===output.id?{...w,to_node:fresh.id}:w)}
  const merged=mergeCanvasProduction(edited,cp.canvasProductionStatus('default'))
  assert.equal(merged.nodes.find(n=>n.id===fresh.id).data.variations.length,0)
  assert.equal(cp.canvasProductionStatus('default').runs[0].details.assets.length,2)
})
await check('A failed newer draft preserves earlier output history but never marks it current',()=>{
  const status=cp.canvasProductionStatus('default'),current=graph.updateNodeData(mergeCanvasProduction(board,status),video.id,{user_prompt:'Different attempted draft'}),prior=status.nodes.find(n=>n.nodeId===video.id)
  const attempt={...prior,status:'error',assets:[],draftSignature:canvasDraftSignature(current,video.id)}
  const failed={...attempt,history:[...prior.history,attempt]}
  const merged=mergeCanvasProduction(current,{nodes:status.nodes.map(n=>n.nodeId===video.id?failed:n)})
  assert.equal(merged.nodes.find(n=>n.id===video.id).data.result_asset_id,prior.assets[0].id)
  assert.equal(merged.nodes.find(n=>n.id===video.id).data.stale,true)
  assert.equal(merged.nodes.find(n=>n.id===output.id).data.variations.length,1)
  const restored=mergeCanvasProduction(board,{nodes:status.nodes.map(n=>n.nodeId===video.id?failed:n)})
  assert.equal(restored.nodes.find(n=>n.id===video.id).data.stale,false,'Undo to a completed historical draft must reuse its Asset')
  assert.equal(restored.nodes.find(n=>n.id===video.id).data.status,'done')
})
await check('Remote-only reference URLs cannot enter production or trigger downloads',()=>{
  const reference=graph.newNode('reference',0,0)
  reference.data={...reference.data,local_url:'https://example.invalid/reference.png',media_type:'image'}
  const remote={...board,nodes:board.nodes.filter(n=>n.id!==image.id).concat(reference),connections:board.connections.filter(w=>w.from_node!==image.id&&w.to_node!==image.id).concat({id:'remote-edge',from_node:reference.id,from_socket:'image',to_node:video.id,to_socket:'start_frame'})}
  save(remote)
  assert.throws(()=>cp.quoteCanvas('default',{creativeId,nodeIds:[output.id]}),/image start-frame step|saved local/)
  assert.equal(db.prepare('SELECT count(*) n FROM job').get().n,2)
  save(board)
})
await check('Status maps stable node/Job/Asset identities and frozen drafts survive edits',()=>{const result=cp.canvasProductionStatus('default');assert.equal(result.nodes.length,2);assert.ok(result.nodes.every(n=>n.status==='done'&&n.assets.length===1));const original=repo.getProductionRunExecution(q.runId).spec_snapshot;save(graph.updateNodeData(board,video.id,{user_prompt:'New direction'}));assert.equal(repo.getProductionRunExecution(q.runId).spec_snapshot,original);assert.equal(result.nodes.find(n=>n.nodeId===video.id).draftSignature,canvasDraftSignature(board,video.id));assert.notEqual(result.nodes.find(n=>n.nodeId===video.id).draftSignature,canvasDraftSignature(repo.getNodeCanvasProject('default').canvasJson,video.id))})
await check('Current stable outputs are reused; stale dependent-only draft compiles no new image',()=>{const status=cp.canvasProductionStatus('default');let current=board;for(const n of status.nodes){const a=n.assets[0];current={...current,nodes:current.nodes.map(node=>node.id===n.nodeId?{...node,data:{...node.data,status:'done',result_asset_id:a.id,result_local_url:`/media/${a.relative_path}`,stale:false}}:node)}}for(const n of status.nodes)current={...current,nodes:current.nodes.map(node=>node.id===n.nodeId?{...node,data:{...node.data,generated_fingerprint:compiler.canvasNodeFingerprint(current,node.id)}}:node)};save(current);assert.throws(()=>cp.quoteCanvas('default',{creativeId,nodeIds:[output.id]}),/current outputs/);current=graph.updateNodeData(current,video.id,{user_prompt:'A new visual movement'});save(current);const next=cp.quoteCanvas('default',{creativeId,nodeIds:[output.id]}).quote;assert.equal(next.steps.length,1);assert.equal(next.steps[0].capability,'generate_video');assert.match(next.steps[0].params.start_frame,/\/media\/generated\/mock-image-/);assert.equal(next.versions.length,1)})
await check('Changed local input bytes invalidate confirmation and never dispatch a replacement',async()=>{
  const asset=cp.canvasProductionStatus('default').nodes.find(n=>n.nodeId===image.id).assets[0]
  const file=path.join(process.env.FACTORY_MEDIA_ROOT,asset.relative_path),bytes=fs.readFileSync(file)
  const quoted=cp.quoteCanvas('default',{creativeId,nodeIds:[output.id]}).quote
  try {
    fs.writeFileSync(file,Buffer.concat([bytes,Buffer.from('changed fixture bytes')]))
    assert.equal(cp.canvasProductionStatus('default').nodes.find(n=>n.nodeId===video.id).inputVersionsValid,false)
    await assert.rejects(cp.startCanvas('default',{token:quoted.token,creativeId,confirmed:true}),/changed/)
    assert.equal(db.prepare('SELECT count(*) n FROM job').get().n,2)
  } finally {fs.writeFileSync(file,bytes)}
})
await check('Raw Remix video fails before Jobs with an actionable local-preparation path',()=>{
  const asset=cp.canvasProductionStatus('default').nodes.find(n=>n.nodeId===video.id).assets[0]
  const reference=graph.newNode('reference',0,0)
  reference.data={...reference.data,asset_id:asset.id,local_url:`/media/${asset.relative_path}`,media_type:'video',mime_type:'video/mp4'}
  let remix=graph.addStarterGraph(graph.emptyNodeCanvas(),'remix').canvas
  const target=remix.nodes.find(n=>n.type==='video_generator')
  remix={...remix,nodes:[reference,{...target,data:{...target.data,resolution:'480p',duration_seconds:5,aspect_ratio:'9:16'}}],connections:[{id:'remix-reference',from_node:reference.id,from_socket:'video',to_node:target.id,to_socket:'reference_video'}]}
  save(remix)
  assert.throws(()=>cp.quoteCanvas('default',{creativeId,nodeIds:[target.id]}),/Video > Remix/)
  assert.equal(db.prepare('SELECT count(*) n FROM job').get().n,2)
})
await check('Source deletion does not delete output media or accounting records',()=>{const before=db.prepare('SELECT count(*) n FROM asset').get().n;save(graph.removeNode(board,image.id));assert.equal(db.prepare('SELECT count(*) n FROM asset').get().n,before);assert.equal(db.prepare('SELECT count(*) n FROM job').get().n,2);assert.equal(db.prepare('SELECT count(*) n FROM cost').get().n,0);assert.equal(db.pragma('integrity_check',{simple:true}),'ok')})
console.log(`Canvas production: ${passed}/${passed} PASS; zero real provider calls`)
}finally{globalThis.fetch=originalFetch;repo.closeDb();if(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep))fs.rmSync(temp,{recursive:true,force:true})}
