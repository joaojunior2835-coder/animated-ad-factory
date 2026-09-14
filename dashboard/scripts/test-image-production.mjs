// Isolated real SQLite/M5 with a synthetic fal client and network deny-by-default.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aaf-image-production-'))
process.env.FACTORY_DB_PATH=path.join(temp,'factory.db');process.env.FACTORY_MEDIA_ROOT=path.join(temp,'media')
for(const key of ['FAL_API_KEY','OPENAI_API_KEY','GROQ_API_KEY','POLLINATIONS_API_KEY','REPLICATE_API_TOKEN'])process.env[key]=''
process.env.FAL_API_KEY='synthetic-image-key-never-send'
fs.mkdirSync(process.env.FACTORY_MEDIA_ROOT)
const {runMigrations}=await import('../server/db/migrate.mjs');runMigrations({dbPath:process.env.FACTORY_DB_PATH,log:{log(){}}})
const repo=await import('../server/db/repository.mjs'),pt=await import('../server/db/productTestRepository.mjs'),g=await import('../server/lib/creativeGenerator.mjs'),d=await import('../server/lib/dispatcher.mjs'),fal=await import('../server/providers/falProvider.mjs'),rates=await import('../server/lib/rateCatalog.mjs'),m6=await import('../server/lib/assembly.mjs')
let db=repo.getDb()
const originalFetch=globalThis.fetch, submissions=[]
let resultMode='success', requestStatus='IN_PROGRESS', passed=0
const check=async(name,fn)=>{await fn();passed++;console.log('PASS '+name)}
const fixture=path.join(temp,'fixture.png')
assert.equal((await m6.runVideoTool(await m6.videoTool(),['-hide_banner','-f','lavfi','-i','color=c=red:s=1024x1024','-frames:v','1','-update','1',fixture])).code,0)
const image=fs.readFileSync(fixture)
globalThis.fetch=async(url)=>{assert.equal(String(url),'https://fal.media/test/image.png','No unmocked network is allowed');return new Response(image,{headers:{'content-type':'image/png'}})}
fal.setFalClientForTests({queue:{
  async submit(endpoint,{input}){
    const active=db.prepare("SELECT * FROM budget_reservation WHERE status='active'").all()
    assert.ok(active.length);assert.ok(active.every(r=>r.base_currency_amount_minor>0))
    assert.ok(db.prepare("SELECT count(*) n FROM job_execution_attempt WHERE provider_status='SUBMISSION_UNRESOLVED'").get().n)
    submissions.push({endpoint,input});return {request_id:`image-${submissions.length}`,status:'IN_QUEUE'}
  },async status(){return {status:requestStatus}},async result(){
    assert.equal(requestStatus,'COMPLETED')
    if(resultMode==='reject')throw Object.assign(new Error('safe '+process.env.FAL_API_KEY),{status:422,body:{authorization:process.env.FAL_API_KEY,detail:[{loc:['body','image'],msg:'content_policy_violation',type:'validation_error',ctx:{extra_info:{reason:'blocked',cause:'copyright'}}}]}})
    return {data:{images:[{url:'https://fal.media/test/image.png',width:1024,height:1024}],has_nsfw_concepts:[false]}}
  }
}})
const pid=repo.createProduct({name:'Isolated image test'}),productTest=pt.createProductTestForProduct({productId:pid,market:'FR',language:'fr'})
const make=()=>g.createGeneratorCreative({productTestId:productTest.id,angle:'Image fixture'}).creativeId
const draft=(p={})=>({kind:'image',name:'Product image',prompt:'A red apple on a white table',provider:'fal',model:'flux-schnell',mode:'text-to-image',imageSize:'square_hd',outputFormat:'png',quantity:1,...p})
let cid=make(), w, q
const save=(scenes)=>w=g.saveGeneratorScenes(cid,{revision:w?.revision || 0,scenes})
const quote=()=>{const r=g.quoteGenerator(cid,{revision:w.revision,sceneIds:w.scenes.map(s=>s.id)});w=r.workspace;q=r.quote;return q}
try {
await check('Catalog retains sub-cent USD and documented per-output megapixel rounding',()=>{assert.equal(rates.estimateImageJobCost('flux-schnell',{image_size:'square'}).sourceUsd,.003);assert.equal(rates.estimateImageJobCost('flux-schnell',{image_size:'square_hd'}).sourceUsd,.006);assert.equal(rates.estimateImageJobCost('flux-schnell',{image_size:'square'}).costMinor,.3)})
await check('Registry exposes configured implemented priced image modes without fake controls',async()=>{const o=await g.generatorOptions();const m=o.capabilities.find(m=>m.id==='fal-flux-schnell');assert.equal(m.configured,true);assert.deepEqual(m.durations,[]);assert.deepEqual(m.qualityOptions,[]);assert.equal(m.references.image,0);process.env.FAL_API_KEY='';assert.equal((await g.generatorOptions()).imageModels.some(m=>m.provider==='fal'),false);process.env.FAL_API_KEY='synthetic-image-key-never-send'})
await check('Invalid model/size/quantity/reference rejected and missing FX blocks before submit',()=>{for(const p of [{model:'seedance-2.0-fast'},{imageSize:'fake'},{quantity:0},{quantity:5},{referenceAssetIds:[1]}])assert.throws(()=>save([draft(p)]));save([draft({quantity:4})]);assert.equal(g.estimateGenerator(cid,w.scenes.map(s=>s.id)).totalMinor,null);assert.throws(quote,/FX/);assert.equal(submissions.length,0)})
await check('Four outputs quote four separate positive-cent reservations, not a fake num_images batch',()=>{repo.setFxRate({fromCurrency:'USD',toCurrency:'EUR',rate:.86534,source:'synthetic fixture'});const e=g.estimateGenerator(cid,w.scenes.map(s=>s.id));assert.equal(e.totalMinor,4);assert.equal(e.rows[0].sourceUsd,.024);quote();assert.equal(q.outputCount,4);assert.equal(q.totalMinor,4);assert.equal(repo.getProductionRunExecution(q.runIds[0]).jobs.length,0);assert.equal(db.prepare('SELECT count(*) n FROM budget_reservation').get().n,0)})
await check('Missing/false/string confirmation and same-rounded-price FX changes invalidate quote',async()=>{for(const confirmed of [undefined,false,'true'])await assert.rejects(g.startGenerator(cid,{...q,confirmed}));repo.setFxRate({fromCurrency:'USD',toCurrency:'EUR',rate:.8,source:'changed synthetic'});await assert.rejects(g.startGenerator(cid,{...q,confirmed:true}),/FX changed/);repo.setFxRate({fromCurrency:'USD',toCurrency:'EUR',rate:.86534,source:'synthetic fixture'});quote();assert.equal(submissions.length,0)})
await check('Atomic M5 reserve and durable marker precede exactly four submissions; duplicate click cannot repeat',async()=>{await g.startGenerator(cid,{...q,confirmed:true});assert.equal(submissions.length,4);assert.ok(submissions.every(s=>s.endpoint==='fal-ai/flux/schnell' && s.input.num_images===1 && s.input.sync_mode===false && s.input.enable_safety_checker===true));await assert.rejects(g.startGenerator(cid,{...q,confirmed:true}));const run=repo.getProductionRunExecution(q.runIds[0]);assert.equal(run.jobs.length,4);assert.ok(run.jobs.every(j=>j.inputParams.max_attempts===1));assert.equal(submissions.length,4)})
await check('Pending status never retrieves results, restart-safe IDs retain reservations',async()=>{await d.reconcileInFlightJobs();assert.equal(db.prepare('SELECT count(*) n FROM cost').get().n,0);assert.equal(db.prepare("SELECT count(*) n FROM budget_reservation WHERE status='active'").get().n,4);repo.closeDb();assert.ok(g.generatorWorkspace(cid).scenes[0].details.attempts.every(a=>a.external_request_id.startsWith('fal-image:flux-schnell:')));db=repo.getDb()})
const liveDb=db
await check('Completed image validates locally and settles once per request, even identical Asset bytes',async()=>{requestStatus='COMPLETED';await d.reconcileInFlightJobs();w=g.generatorWorkspace(cid);assert.equal(w.scenes[0].status,'Complete');assert.ok(fs.existsSync(m6.localAssetPath(w.scenes[0].media.relative_path)));assert.equal(w.scenes[0].media.width,1024);assert.equal(liveDb.prepare('SELECT count(*) n FROM cost').get().n,4);assert.equal(liveDb.prepare('SELECT SUM(base_currency_amount_minor) n FROM cost').get().n,4);assert.equal(liveDb.prepare('SELECT count(*) n FROM asset').get().n,1);await d.reconcileInFlightJobs();assert.equal(liveDb.prepare('SELECT count(*) n FROM cost').get().n,4);assert.equal(submissions.length,4)})
await check('Selection keeps stable Asset/run/history and changing quantity invalidates confirmation',()=>{const sid=w.scenes[0].id,runId=w.scenes[0].runId;w=g.chooseGeneratorResult(cid,{revision:w.revision,sceneId:sid,assetId:w.scenes[0].media.id});assert.equal(w.scenes[0].runId,runId);quote();save([{...w.scenes[0],quantity:2}]);assert.equal(w.quote,null);assert.equal(w.scenes[0].current,false)})
await check('COMPLETED/422 retains reservation and safe diagnostics; no invented Cost or retry',async()=>{cid=make();w=null;save([draft()]);quote();requestStatus='IN_PROGRESS';// submit closure uses the now-current repository
  fal.setFalClientForTests({queue:{async submit(){submissions.push({});return {request_id:'held-image',status:'IN_QUEUE'}},async status(){return {status:'COMPLETED'}},async result(){throw Object.assign(new Error('image denied '+process.env.FAL_API_KEY),{status:422,body:{authorization:process.env.FAL_API_KEY,detail:[{loc:['body','image'],msg:'content_policy_violation',type:'validation_error',ctx:{extra_info:{cause:'copyright',reason:'blocked'}}}]}})}}})
  await g.startGenerator(cid,{...q,confirmed:true});await d.reconcileInFlightJobs();w=g.generatorWorkspace(cid);const s=w.scenes[0];assert.equal(s.status,'Reconciliation required');assert.equal(s.details.reservations[0].status,'active');assert.equal(s.details.costs.length,0);assert.match(s.details.attempts[0].external_request_id,/held-image/);assert.match(s.details.attempts[0].result_data,/copyright/);assert.ok(!JSON.stringify(s.details).includes(process.env.FAL_API_KEY));assert.ok(!s.details.attempts[0].result_data.includes('authorization'));const count=submissions.length;await d.reconcileInFlightJobs();assert.equal(submissions.length,count);assert.throws(quote,/uncertain/)
})
await check('Known pre-dispatch rejection releases and never resubmits',async()=>{cid=make();w=null;save([draft()]);quote();fal.setFalClientForTests({queue:{async submit(){submissions.push({});throw Object.assign(new Error('invalid input'),{status:422})}}});await g.startGenerator(cid,{...q,confirmed:true});w=g.generatorWorkspace(cid);assert.equal(w.scenes[0].status,'Failed');assert.equal(w.scenes[0].details.reservations[0].status,'released');assert.equal(w.scenes[0].details.costs.length,0);const count=submissions.length;await d.reconcileInFlightJobs();assert.equal(submissions.length,count)})
console.log(`Image production: ${passed}/${passed} PASS; zero real provider calls`)
} finally {globalThis.fetch=originalFetch;fal.setFalClientForTests(null);repo.closeDb();if(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep))fs.rmSync(temp,{recursive:true,force:true})}
