// Canvas compiles a frozen dependency graph into existing M5, never dispatches itself.
import fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { getDb, getNodeCanvasProject, getFxRate, attachAssetLink } from '../db/repository.mjs'
import { approveProductionPlan } from '../db/productTestRepository.mjs'
import { compileCanvasExecution } from '../../src/lib/nodeCanvasExecution.js'
import { canvasDraftSignature, mergeCanvasProduction } from '../../src/lib/canvasProductionBinding.js'
import { modelCapabilities } from './modelCapabilities.mjs'
import { validateProductionSteps, priceProductionStep } from './productionSteps.mjs'
import { preflightProduction, startProduction } from './productionExecution.mjs'
import { localAssetPath } from './assembly.mjs'
import { runDetails } from './operator.mjs'

const requireValue=(ok,message)=>{if(!ok)throw new Error(message)}
const key=id=>`canvas_execution_${id}`
const read=id=>JSON.parse(getDb().prepare('SELECT value FROM app_settings WHERE key=?').get(key(id))?.value || '{"runs":[],"quote":null}')
const write=(id,value)=>getDb().prepare("INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=datetime('now')").run(key(id),JSON.stringify(value))
function canvas(id){const row=getNodeCanvasProject(id);requireValue(row,'Save this Canvas before running.');return row.canvasJson}
function owner(id){const c=getDb().prepare('SELECT * FROM creative WHERE id=?').get(Number(id));requireValue(c,'Choose a Creative before running the Canvas.');return c}
function media(id,kind){const a=getDb().prepare('SELECT * FROM asset WHERE id=?').get(Number(id));requireValue(a && a.mime_type.startsWith(kind+'/'),`Choose a saved local ${kind} Asset.`);const bytes=fs.readFileSync(localAssetPath(a.relative_path));return {...a,version:createHash('sha256').update(bytes).digest('hex')}}
function resolveScope(id,input){
  const graph=mergeCanvasProduction(canvas(id),canvasProductionStatus(id)),compiled=compileCanvasExecution(graph,{nodeIds:input.nodeIds,scope:input.scope,capabilities:modelCapabilities()})
  requireValue(!compiled.blockers.some(b=>b.code==='existing_execution'),'An existing Canvas request is active or requires reconciliation. Do not submit a replacement.')
  requireValue(!compiled.blockers.length,compiled.blockers.map(b=>b.message).join(' '))
  requireValue(compiled.steps.length,'This path already has current outputs; edit the draft before generating again.')
  const expanded=[],versions=[],refs=[],sourceSteps=new Map()
  for(const s of compiled.steps){
    const params={...s.params}, dependencies=[]
    // Currently supported graph dependency is a single image start frame.
    // Reference-to-video uses validated prepared Assets from the Remix workflow.
    if(params.mode==='reference-to-video'){
      const videos=s.dependencies.filter(d=>d.input==='reference_video'),images=s.dependencies.filter(d=>d.input!=='reference_video')
      requireValue(videos.length===1 && videos[0].assetId,'Use one locally prepared reference video from Remix / Assets.')
      params.generation_mode='reference_to_video';params.reference_video_ids=videos.map(d=>d.assetId);params.reference_image_ids=images.map(d=>d.assetId);params.reference_audio_ids=[]
      requireValue(images.every(d=>d.assetId),'Reference image generation must complete before preparing a Remix graph.')
      for(const dep of s.dependencies){const a=media(dep.assetId,dep.input==='reference_video'?'video':'image');versions.push({id:a.id,version:a.version});refs.push(a.id)}
    } else if(s.dependencies.length){
      requireValue(s.capability==='generate_video' && s.dependencies.length===1 && ['start_frame','reference_image'].includes(s.dependencies[0].input),'Only one start frame is supported for image-to-video. Use Remix for other references.')
      const dep=s.dependencies[0]
      if(dep.assetId){const a=media(dep.assetId,'image');params.start_frame=`/media/${a.relative_path}`;versions.push({id:a.id,version:a.version});refs.push(a.id)}
      else {const upstream=sourceSteps.get(dep.nodeId);requireValue(upstream?.capability==='generate_image','An image start-frame step is required.');dependencies.push({stepId:upstream.id,type:'start_frame'});params.needs_start_frame=true}
    }
    const quantity=Number(params.quantity);delete params.quantity;delete params.width;delete params.height
    requireValue(Number.isInteger(quantity)&&quantity>=1&&quantity<=4,'Choose 1–4 outputs per node.')
    for(let index=0;index<quantity;index++){
      const step={id:`${s.nodeId}:${index+1}`,nodeId:s.nodeId,capability:s.capability,modelId:s.modelId,provider:s.provider,model:s.model,prompt:s.prompt,params:{...params},dependencies}
      expanded.push(step);if(index===0)sourceSteps.set(s.nodeId,step)
    }
  }
  const steps=validateProductionSteps(expanded),costs=steps.map(priceProductionStep),issue=costs.find(c=>c.unknown)
  requireValue(!issue,issue?.reason+(steps.some(s=>s.params.generation_mode==='reference_to_video') ? ' In Video > Remix, choose the source video to prepare it locally, and add each product image to validate it. Then select the prepared reference.mp4 Asset and those validated images in Canvas. Preparation is local and does not generate or spend money.' : ''))
  return {graph,compiled,steps,costs,versions,refs:[...new Set(refs)],totalMinor:costs.reduce((sum,c)=>sum+c.minor,0)}
}
function stillBusy(run){return run.attempts.some(a=>a.reconciliation_status!=='reconciled')||run.run.jobs.some(j=>['planned','generating'].includes(j.status))}
export function quoteCanvas(id,{creativeId,nodeIds=[],scope='node'}){
  return getDb().transaction(()=>{
    const c=owner(creativeId),state=read(id),resolved=resolveScope(id,{nodeIds,scope})
    for(const prior of state.runs){if(prior.nodes.some(n=>resolved.compiled.closureNodeIds.includes(n.nodeId)) && stillBusy(runDetails(prior.runId)))throw new Error('An existing Canvas request is active or requires reconciliation. Do not submit a replacement.')}
    const [runId]=approveProductionPlan({plans:[{creativeId:c.id,fineMethod:'canvas_workflow',coarseProductionMethod:'factory_generated',notes:'canvas_frozen_dependency_scope',generationPlan:{steps:resolved.steps,imageGenerations:resolved.steps.filter(s=>s.capability==='generate_image').length,videoClips:resolved.steps.filter(s=>s.capability==='generate_video').map(s=>s.params),voiceRequired:false},estimatedCost:{minor:resolved.totalMinor,currency:'EUR'}}]})
    for(const aid of resolved.refs)attachAssetLink(aid,{productionRunId:runId},'canvas_input')
    const preflight=preflightProduction(c.iteration_id,[runId]);requireValue(preflight.readyCount===1&&!preflight.blockedCount,preflight.runs[0]?.reason||'Production preflight blocked.');requireValue(preflight.expectedTotalIfAllSucceedMinor<=preflight.budgetCeilingMinor,'Insufficient budget for this Canvas scope.')
    const q={token:randomUUID(),runId,creativeId:c.id,iterationId:c.iteration_id,nodeIds,scope,graphSignature:resolved.compiled.graphSignature,graphFingerprint:resolved.compiled.graphFingerprint,versions:resolved.versions,totalMinor:preflight.newEstimatedPaidSpendMinor,costSignature:JSON.stringify(resolved.costs),fxSignature:resolved.steps.some(s=>s.provider==='fal')?JSON.stringify(getFxRate('USD','EUR')):null,nodes:resolved.compiled.steps.map(s=>({nodeId:s.nodeId,fingerprint:s.fingerprint,draftSignature:canvasDraftSignature(resolved.graph,s.nodeId),inputBindings:s.dependencies.map(d=>({...d,version:resolved.versions.find(v=>v.id===d.assetId)?.version,...(!d.assetId?{stepId:`${d.nodeId}:1`}:{})})),outputNodeIds:resolved.graph.connections.filter(w=>w.from_node===s.nodeId&&resolved.graph.nodes.some(n=>n.id===w.to_node&&n.type==='output')).map(w=>w.to_node)})),steps:resolved.steps,outputCount:resolved.steps.length,attemptLimit:1,expiresAt:Date.now()+300000,used:false}
    state.quote=q;write(id,state);return {quote:{...q,preflight}}
  }).immediate()
}
export async function startCanvas(id,{token,confirmed,creativeId}){
  requireValue(confirmed===true,'confirmed:true is required before production can spend money.')
  const claim=getDb().transaction(()=>{
    const state=read(id),q=state.quote
    requireValue(q&&q.token===token&&!q.used&&q.expiresAt>Date.now(),'Canvas confirmation expired or already used.')
    requireValue(Number(creativeId)===q.creativeId,'Creative context changed. Request a new quote.')
    const resolved=resolveScope(id,q)
    requireValue(q.graphSignature===resolved.compiled.graphSignature && JSON.stringify(q.versions)===JSON.stringify(resolved.versions),'Canvas or input media changed. Request a new quote.')
    requireValue(q.costSignature===JSON.stringify(resolved.costs)&&(!q.fxSignature||q.fxSignature===JSON.stringify(getFxRate('USD','EUR'))),'Price or FX changed. Request a new quote.')
    const preflight=preflightProduction(q.iterationId,[q.runId]);requireValue(preflight.readyCount===1&&!preflight.blockedCount&&preflight.newEstimatedPaidSpendMinor===q.totalMinor&&preflight.expectedTotalIfAllSucceedMinor<=preflight.budgetCeilingMinor,'Production safety or budget check failed.')
    q.used=true;state.runs.push({runId:q.runId,creativeId:q.creativeId,nodes:q.nodes,steps:q.steps,startedAt:new Date().toISOString()});write(id,state);return q
  }).immediate()
  return startProduction(claim.iterationId,[claim.runId])
}
export function canvasProductionStatus(id){
  const state=read(id)
  const runs=state.runs.map(record=>({...record,details:runDetails(record.runId)}))
  const latest=new Map()
  for(const record of runs){for(const node of record.nodes){
    const jobs=record.details.run.jobs.filter(j=>j.inputParams.node_id===node.nodeId),jobIds=jobs.map(j=>j.id)
    const attempts=record.details.attempts.filter(a=>jobIds.includes(a.job_id)),assets=record.details.assets.filter(a=>jobIds.includes(a.job_id))
    const activelyPreparing=a=>{
      let p;try{p=JSON.parse(a.result_data||'{}').operatorProgress}catch{return false}
      if(a.provider_status!=='SUBMISSION_UNRESOLVED'||a.failure_classification||!p||!['Preparing references','Uploading references','Downloading'].includes(p.phase)||Date.now()-Date.parse(p.at)>600000)return false
      try{process.kill(p.pid,0);return true}catch{return false}
    }
    const held=attempts.some(a=>a.reconciliation_status==='reconciliation_required'&&!activelyPreparing(a))
    const status=held?'reconciliation_required':jobs.some(j=>j.status==='failed')?'error':jobs.length&&jobs.every(j=>j.status==='complete')?'done':jobs.some(j=>j.status==='generating')?'generating':'queued'
    const inputBindings=(node.inputBindings||[]).map(binding=>{
      if(binding.assetId)return binding
      const source=record.details.run.jobs.find(j=>j.inputParams.step_id===binding.stepId)
      const asset=record.details.assets.find(a=>a.job_id===source?.id)
      return {...binding,assetId:asset?.id||null,version:asset?.content_hash}
    })
    const unchanged=(id,version)=>{try{const a=getDb().prepare('SELECT * FROM asset WHERE id=?').get(id);return Boolean(a&&version&&createHash('sha256').update(fs.readFileSync(localAssetPath(a.relative_path))).digest('hex')===version)}catch{return false}}
    const item={...node,inputBindings,inputVersionsValid:inputBindings.every(b=>unchanged(b.assetId,b.version)),outputMediaValid:assets.length>0&&assets.every(a=>unchanged(a.id,a.content_hash)),runId:record.runId,creativeId:record.creativeId,jobIds,status,assets,error:jobs.find(j=>j.error_message)?.error_message||null,attempts,costs:record.details.costs.filter(c=>jobIds.includes(c.job_id))}
    latest.set(node.nodeId,{...item,history:[...(latest.get(node.nodeId)?.history||[]),item]})
  }}
  return {nodes:[...latest.values()],runs}
}
