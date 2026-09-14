// Explicit image/graph plans extend existing frozen M5 specs; not a scheduler.
import { validateModelStep } from './modelCapabilities.mjs'
import { estimateImageJobCost, estimateVideoJobCost } from './rateCatalog.mjs'
import { sourceReservationMinor, budgetAmountMinor } from './moneyRounding.mjs'
import { getFxRate } from '../db/repository.mjs'

export function validateProductionSteps(steps, options) {
  if (!Array.isArray(steps) || !steps.length || steps.length > 48) throw new Error('Use 1–48 explicit production steps.')
  const seen = new Map()
  return steps.map((step, index) => {
    const id = String(step.id || step.nodeId || index)
    if (seen.has(id)) throw new Error('Duplicate production step.')
    const {model,prompt} = validateModelStep(step, options)
    const dependencies = (step.dependencies || []).map(d => {
      const dependencyId = String(d.stepId || d.nodeId)
      if (!seen.has(dependencyId)) throw new Error('Dependency must be an earlier validated step (cycles are forbidden).')
      const type = d.type || 'start_frame'
      if (type !== 'start_frame' || step.capability !== 'generate_video' || seen.get(dependencyId).capability !== 'generate_image') throw new Error('Only image → video start-frame production dependencies are supported.')
      return { stepId:dependencyId,type }
    })
    if (dependencies.length > 1) throw new Error('Choose one image start-frame dependency.')
    if (step.capability==='generate_video') {
      if (step.params?.needs_start_frame && !step.params.start_frame && !dependencies.length) throw new Error('The required start frame is missing.')
      if (step.params?.start_frame && dependencies.length) throw new Error('Choose a fixed start frame OR a generated dependency, not both.')
    }
    const result = { id, nodeId:step.nodeId || null, capability:model.capability,provider:model.provider,model:model.model,modelId:model.id,prompt,params:{...step.params,...(model.capability==='generate_video'?{seconds:Number(step.params.seconds??step.params.duration),duration:Number(step.params.seconds??step.params.duration)}:{}),...(dependencies.length ? {needs_start_frame:true} : {})},dependencies }
    seen.set(id,result); return result
  })
}
export function priceProductionStep(step) {
  const raw = step.capability === 'generate_image' ? estimateImageJobCost(step.model,step.params) : estimateVideoJobCost(step.model,step.params)
  if (raw.unknown) return raw
  const sourceMinor = sourceReservationMinor(raw.costMinor,step.capability)
  const fx = step.provider === 'mock' ? {rate:1,source:'local_mock'} : getFxRate(raw.currency,'EUR')
  if (!fx) return {unknown:true,reason:'FX_RATE_MISSING'}
  return {...raw,sourceMinor,minor:budgetAmountMinor(sourceMinor,fx.rate,step.capability),fx}
}
