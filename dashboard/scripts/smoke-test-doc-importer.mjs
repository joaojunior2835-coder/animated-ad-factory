// Developer-only smoke test for the Brand Library document model and AI Handoff
// inclusion logic. Pure logic only — no PDF/DOCX extraction (those need a browser
// and are tested manually per TEST_DOCUMENT_IMPORTER.md).
//
// Run: npm run test:docs   (from the dashboard/ folder)

import { makeDoc, normalizeDoc, isActive } from '../src/lib/brandDocs.js'
import { emptyProject } from '../src/lib/projectModel.js'
import { buildMasterPrompt, activeDocsWarning, ACTIVE_DOC_CHAR_WARN } from '../src/lib/masterPrompt.js'

let pass = 0
let fail = 0
function check(name, cond) {
  if (cond) {
    pass++
    console.log('PASS  ' + name)
  } else {
    fail++
    console.log('FAIL  ' + name)
  }
}

function projectWithDocs(docs) {
  return { ...emptyProject(), brand_docs: docs }
}

// 1. makeDoc creates valid metadata
const d = makeDoc({ title: 'Brand Voice', content: 'warm and direct', source_type: 'pdf', tags: ['brand voice', 'offer'] })
check('makeDoc: has id', typeof d.id === 'string' && d.id.length > 0)
check('makeDoc: has created_at + updated_at', !!d.created_at && !!d.updated_at)
check('makeDoc: source_type preserved', d.source_type === 'pdf')
check('makeDoc: tags preserved', Array.isArray(d.tags) && d.tags.length === 2)
check('makeDoc: defaults (global false, active_for_project false, notes "")', d.global === false && d.active_for_project === false && d.notes === '')

// 2. normalizeDoc preserves title/content/source/tags (and migrates legacy `active`)
const n = normalizeDoc({ title: 'Offer Doc', content: 'evening ritual', source_type: 'json', tags: ['avatar'], active: true })
check('normalizeDoc: title preserved', n.title === 'Offer Doc')
check('normalizeDoc: content preserved', n.content === 'evening ritual')
check('normalizeDoc: source_type preserved', n.source_type === 'json')
check('normalizeDoc: tags preserved', n.tags.length === 1 && n.tags[0] === 'avatar')
check('normalizeDoc: legacy active -> active_for_project', isActive(n) === true)

// 3. active docs are included in the master prompt
const ACTIVE_MARKER = 'ACTIVE_MARKER_7f3a'
const INACTIVE_MARKER = 'INACTIVE_MARKER_9c21'
const activeDoc = makeDoc({ title: 'Active Doc', content: ACTIVE_MARKER, source_type: 'paste', active_for_project: true })
const inactiveDoc = makeDoc({ title: 'Inactive Doc', content: INACTIVE_MARKER, source_type: 'paste', active_for_project: false })
const promptMixed = buildMasterPrompt(projectWithDocs([activeDoc, inactiveDoc]))
check('master prompt: includes ACTIVE doc content', promptMixed.includes(ACTIVE_MARKER))
check('master prompt: includes active doc title + source meta', promptMixed.includes('Active Doc [source: paste'))

// 4. inactive docs are excluded from the master prompt
check('master prompt: excludes INACTIVE doc content', !promptMixed.includes(INACTIVE_MARKER))

// 5. large-context warning triggers when active docs exceed the threshold
const bigDoc = makeDoc({ title: 'Big', content: 'x'.repeat(ACTIVE_DOC_CHAR_WARN + 1000), source_type: 'paste', active_for_project: true })
const smallDoc = makeDoc({ title: 'Small', content: 'short', source_type: 'paste', active_for_project: true })
check('warning: triggers over threshold', activeDocsWarning(projectWithDocs([bigDoc])) === 'Large context: consider deselecting low-priority docs.')
check('warning: null under threshold', activeDocsWarning(projectWithDocs([smallDoc])) === null)
check('warning: large content ignored when doc is inactive', activeDocsWarning(projectWithDocs([{ ...bigDoc, active_for_project: false }])) === null)

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
