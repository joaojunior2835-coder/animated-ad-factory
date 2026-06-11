// Doc-first Auto-Brief: builds a prompt asking an external LLM to infer the
// product/offer brief from the active brand docs and return JSON only.

import { activeProjectDocs } from './masterPrompt.js'

const BRIEF_SHAPE = `{
  "product_intake": {
    "product_name": "",
    "product_description": "",
    "offer": "",
    "target_audience": "",
    "market_language": "",
    "visual_style": "",
    "ad_duration": "",
    "product_benefits": "",
    "brand_tone": "",
    "brand_colors": "",
    "optional_compliance_notes": ""
  },
  "confidence_notes": {
    "product_name": "",
    "product_description": "",
    "offer": "",
    "target_audience": "",
    "market_language": "",
    "visual_style": "",
    "ad_duration": "",
    "product_benefits": "",
    "brand_tone": "",
    "brand_colors": "",
    "optional_compliance_notes": ""
  },
  "missing_info": []
}`

function nonEmpty(v) {
  return String(v == null ? '' : v).trim().length > 0
}

export function buildBriefPrompt(project) {
  const docs = activeProjectDocs(project)

  const out = []
  out.push('You are a brand strategist. Infer a product / offer brief from the brand documents below.')
  out.push('')
  out.push('Return ONLY one JSON object in the exact shape at the end. No markdown, no code fences, no explanation.')
  out.push('')
  out.push('Rules:')
  out.push('- Infer ONLY from the active brand docs below. Do not invent unsupported claims.')
  out.push('- If something is unclear or not supported by the docs, leave that field "" (blank) and add its key to missing_info.')
  out.push('- For optional_compliance_notes, infer compliance boundaries from the docs only if present. If the docs do not mention any restrictions, leave it blank and do NOT add it to missing_info.')
  out.push('- For market_language, infer from the document language and any explicit market mentions.')
  out.push('- For visual_style, infer only if present in the docs; otherwise leave it blank.')
  out.push('- In confidence_notes, briefly note how confident you are for each field and what it is based on.')
  out.push('- Return JSON only. No markdown. No explanation.')
  out.push('')
  out.push('=== ACTIVE BRAND DOCS ===')
  if (docs.length) {
    for (const d of docs) {
      const meta = [`source: ${d.source_type || 'paste'}`]
      if (d.tags && d.tags.length) meta.push(`tags: ${d.tags.join(', ')}`)
      out.push(`-- ${d.title || 'Untitled doc'} [${meta.join('; ')}] --`)
      out.push(String(d.content || '').trim())
      out.push('')
    }
  } else {
    out.push('(no active brand docs — add docs to the project and mark them Active first)')
    out.push('')
  }
  out.push('=== RETURN THIS JSON SHAPE ===')
  out.push(BRIEF_SHAPE)

  return out.join('\n')
}

// Whether the brief prompt can be meaningfully generated.
export function canExtractBrief(project) {
  return activeProjectDocs(project).length > 0
}

export { nonEmpty }
