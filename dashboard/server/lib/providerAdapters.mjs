// Normalized execution adapters for the providers already present in the app.
// The legacy provider functions stay intact; this layer gives production
// dispatch one stable contract and keeps raw provider status for reconciliation.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMockVideoJob, getMockVideoJob, shouldFailTransientOnce } from '../providers/mockVideoProvider.mjs'
import { createReplicateVideoJob, getReplicateVideoJob } from '../providers/replicateVideoProvider.mjs'
import { runPollinations } from '../providers/pollinationsProvider.mjs'
import { runGroq } from '../providers/groqProvider.mjs'
import { createFalSeedanceVideoJob, getFalSeedanceVideoJob } from '../providers/falProvider.mjs'

const localMediaRoot = () => path.resolve(process.env.FACTORY_MEDIA_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../local-media'))

function statusFromLegacy(value) {
  const status = String(value || '').toLowerCase()
  if (['done', 'succeeded', 'success', 'complete', 'completed'].includes(status)) return 'complete'
  if (['error', 'failed', 'failure', 'canceled', 'cancelled'].includes(status)) return 'failed'
  return 'pending'
}

function classified(message, classification = 'non_retryable', extra = {}) {
  const error = new Error(String(message || 'Provider request failed.'))
  error.failure_classification = classification
  Object.assign(error, extra)
  return error
}

// Prevent a cheap/free catalog model from being paired with a different paid
// transport. fal's adapter always submits Seedance; it cannot execute Mock/LTX.
export function providerModelIssue(capability, provider, model) {
  if (provider === 'mock') return null
  const valid = provider === 'fal' ? capability === 'generate_video' && model === 'seedance-2.0-fast'
    : provider === 'replicate' ? capability === 'generate_video' && ['ltx', 'wan-720p'].includes(model)
      : provider === 'pollinations' ? capability === 'generate_image' : false
  return valid ? null : 'PROVIDER_MODEL_MISMATCH'
}

function adapterForMock() {
  return {
    provider: 'mock',
    async dispatch(params = {}) {
      if (params.test_failure === 'transient_once' && shouldFailTransientOnce(params.test_failure_key || params.prompt)) throw classified('Mock transient failure (once).', 'transient_retryable')
      if (params.test_failure === 'transient') throw classified('Mock transient failure.', 'transient_retryable')
      if (params.test_failure === 'non_retryable') throw classified('Mock non-retryable failure.', 'non_retryable')
      if (params.test_failure === 'ambiguous_billing') throw classified('Mock ambiguous billing failure.', 'ambiguous_billing')
      const response = createMockVideoJob(params)
      const immediate = getMockVideoJob(response.jobId)
      if (immediate.status === 'done') return { externalRequestId: response.jobId, initialStatus: 'complete', resultData: immediate.result }
      return { externalRequestId: response.jobId, initialStatus: 'pending' }
    },
    async checkStatus(externalRequestId) {
      const response = getMockVideoJob(externalRequestId)
      if (response.status === 'error' && /not found/i.test(response.error || '')) {
        throw classified(response.error, 'ambiguous_billing', { requestUnknown: true })
      }
      return {
        status: statusFromLegacy(response.status),
        resultData: response.result,
        providerStatus: response.status,
      }
    },
    extractResult(resultData) {
      return resultData || null
    },
    isRetryable(error) {
      return (error && error.failure_classification) === 'transient_retryable'
    },
    getActualCost() {
      return null
    },
  }
}

function adapterForReplicate() {
  return {
    provider: 'replicate',
    async dispatch(params = {}) {
      try {
        const response = await createReplicateVideoJob({ ...params, media_root: path.resolve(process.cwd(), 'local-media'), confirmed: true })
        if (!response || !response.jobId) throw classified(response && response.error, 'non_retryable')
        return { externalRequestId: response.jobId, initialStatus: statusFromLegacy(response.status) }
      } catch (error) {
        if (error && error.failure_classification) throw error
        const status = Number(error && (error.status || error.statusCode))
        throw classified(error && error.message, [400, 401, 403, 404, 422, 429].includes(status) ? 'non_retryable' : 'ambiguous_billing')
      }
    },
    async checkStatus(externalRequestId) {
      const response = await getReplicateVideoJob(externalRequestId)
      if (response.status === 'error' && /not found/i.test(response.error || '')) {
        throw classified(response.error, 'ambiguous_billing', { requestUnknown: true })
      }
      return { status: statusFromLegacy(response.status), resultData: response.result, providerStatus: response.status }
    },
    extractResult(resultData) {
      return resultData || null
    },
    isRetryable(error) {
      return (error && error.failure_classification) === 'transient_retryable'
    },
    getActualCost(resultData) {
      const value = resultData && (resultData.actual_cost_minor ?? resultData.cost_minor)
      return Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null
    },
  }
}

function adapterForFal() {
  return {
    provider: 'fal',
    async dispatch(params = {}, {onProgress} = {}) {
      try {
        const response = await createFalSeedanceVideoJob({ ...params, media_root: localMediaRoot(), confirmed: true, onProgress })
        return { externalRequestId: response.jobId, initialStatus: statusFromLegacy(response.status) }
      } catch (error) {
        if (error && error.failure_classification) throw error
        const status = Number(error && (error.status || error.statusCode))
        throw classified(error && error.message, status === 429 || status >= 500 ? 'transient_retryable' : 'ambiguous_billing')
      }
    },
    async checkStatus(externalRequestId, {onProgress} = {}) {
      const response = await getFalSeedanceVideoJob(externalRequestId, { media_root: localMediaRoot(), onProgress })
      return { status: statusFromLegacy(response.status), resultData: response.result, providerStatus: response.status }
    },
    extractResult(resultData) { return resultData || null },
    isRetryable(error) { return (error && error.failure_classification) === 'transient_retryable' },
    getActualCost() { return null },
  }
}

function adapterForPollinations() {
  return {
    provider: 'pollinations',
    async dispatch(params = {}) {
      const result = await runPollinations(params)
      if (!result || result.success === false) throw classified(result && result.error, 'non_retryable')
      return { externalRequestId: `pollinations-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, initialStatus: 'complete', resultData: result }
    },
    async checkStatus() {
      // Pollinations dispatch is synchronous; its result is carried by the
      // execution attempt's in-memory dispatch context until reconciliation.
      return { status: 'complete', resultData: null, providerStatus: 'complete' }
    },
    extractResult(resultData) {
      return resultData || null
    },
    isRetryable(error) {
      return (error && error.failure_classification) === 'transient_retryable'
    },
    getActualCost() {
      return null
    },
  }
}

function adapterForGroq() {
  return {
    provider: 'groq',
    async dispatch(params = {}) {
      const result = await runGroq(params)
      if (!result || result.success === false) throw classified(result && result.error, result && result.status === 'rate_limited' ? 'transient_retryable' : 'non_retryable')
      return { externalRequestId: `groq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, initialStatus: 'complete', resultData: result }
    },
    async checkStatus() {
      return { status: 'complete', resultData: null, providerStatus: 'complete' }
    },
    extractResult(resultData) {
      return resultData || null
    },
    isRetryable(error) {
      return (error && error.failure_classification) === 'transient_retryable'
    },
    getActualCost() {
      return null
    },
  }
}

export function getProviderAdapter(provider) {
  const id = String(provider || '').trim().toLowerCase()
  if (id === 'mock') return adapterForMock()
  if (id === 'replicate') return adapterForReplicate()
  if (id === 'fal') return adapterForFal()
  if (id === 'pollinations') return adapterForPollinations()
  if (id === 'groq') return adapterForGroq()
  throw classified(`No production adapter for provider "${id || '(none)'}".`, 'non_retryable')
}

export function classifyProviderError(error, provider) {
  if (error && ['transient_retryable', 'non_retryable', 'ambiguous_billing'].includes(error.failure_classification)) return error.failure_classification
  const message = String(error && (error.message || error.error) || '').toLowerCase()
  if (provider === 'replicate' || provider === 'fal') return 'ambiguous_billing'
  if (/timeout|timed out|network|fetch failed|rate limit|429|\b5\d\d\b/.test(message)) return 'transient_retryable'
  if (/charged|billing|unknown|not found|request id/.test(message)) return 'ambiguous_billing'
  return 'non_retryable'
}

export const providerConfigured = (provider) => {
  const id = String(provider || '').toLowerCase()
  if (id === 'mock') return true
  if (id === 'replicate') return Boolean(String(process.env.REPLICATE_API_TOKEN || '').trim())
  if (id === 'fal') return Boolean(String(process.env.FAL_API_KEY || '').trim())
  if (id === 'pollinations') return Boolean(String(process.env.POLLINATIONS_API_KEY || '').trim())
  if (id === 'groq') return Boolean(String(process.env.GROQ_API_KEY || '').trim())
  return false
}
