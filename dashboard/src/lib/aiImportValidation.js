// AI Import Safety Layer: validate parsed AI JSON BEFORE it replaces the project.
// Method-aware — it maps the parsed JSON into a project (via fromImported, which
// also reads selected_method) and runs the same validateProject used everywhere,
// so the checks match the selected ad method. Pure.

import { fromImported, durationStatus } from './projectModel.js'
import { validateProject } from './validation.js'

export function validateAiJson(parsed, currentProject) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const failed = [{ id: 'shape', label: 'Root JSON must be a single object', detail: 'The AI returned something that is not a JSON object.' }]
    return {
      ok: false,
      checks: failed,
      passed: [],
      failed,
      warnings: [],
      stats: { clipCount: 0, declared: null, sum: 0, difference: null, durationOk: false },
      missingFields: failed.map((c) => c.label)
    }
  }

  const temp = fromImported(parsed, currentProject || undefined)
  const v = validateProject(temp)
  const ds = durationStatus(temp)

  return {
    ok: v.ready,
    checks: v.checks,
    passed: v.passed,
    failed: v.failed,
    warnings: v.warnings,
    methodName: v.methodName,
    stats: { clipCount: (temp.clips || []).length, declared: ds.declared, sum: ds.sum, difference: ds.difference, durationOk: ds.ok },
    missingFields: v.failed.map((c) => c.label)
  }
}
