// M5 Phase 0 audit for Creative.active_production_run_id.
// Only the two deterministic repair cases are changed; every other mismatch is
// reported for human review and left untouched.
import { openDatabase, DB_PATH, runMigrations } from './migrate.mjs'

runMigrations()
const db = openDatabase(DB_PATH)
try {
  const creatives = db.prepare('SELECT id, creative_code, active_production_run_id FROM creative ORDER BY id').all()
  const runsByCreative = db.prepare('SELECT id, creative_id, status, attempt_number FROM production_run WHERE creative_id = ? ORDER BY attempt_number, id')
  const report = { scanned: creatives.length, clean: 0, autoFixed: [], ambiguous: [] }

  const update = db.prepare('UPDATE creative SET active_production_run_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
  const audit = db.transaction(() => {
    for (const creative of creatives) {
      const runs = runsByCreative.all(creative.id)
      const candidates = runs.filter((run) => run.status !== 'superseded')
      const active = creative.active_production_run_id
      const activeRun = runs.find((run) => Number(run.id) === Number(active))

      if (candidates.length === 1 && Number(active) === Number(candidates[0].id)) {
        report.clean++
        continue
      }

      if (candidates.length === 1 && (active === null || active === undefined)) {
        update.run(candidates[0].id, creative.id)
        report.autoFixed.push({
          creativeId: creative.id,
          creativeCode: creative.creative_code,
          before: active,
          after: candidates[0].id,
          reason: 'single non-superseded run and active id was null'
        })
        continue
      }

      if (activeRun && activeRun.status === 'superseded' && candidates.length === 1) {
        update.run(candidates[0].id, creative.id)
        report.autoFixed.push({
          creativeId: creative.id,
          creativeCode: creative.creative_code,
          before: active,
          after: candidates[0].id,
          reason: 'active id pointed at superseded run and one non-superseded run existed'
        })
        continue
      }

      report.ambiguous.push({
        creativeId: creative.id,
        creativeCode: creative.creative_code,
        activeProductionRunId: active,
        runs,
        nonSupersededCandidates: candidates
      })
    }
  })
  audit.immediate()

  console.log(JSON.stringify(report, null, 2))
  console.log(`M5 active-run audit: scanned=${report.scanned} clean=${report.clean} auto-fixed=${report.autoFixed.length} ambiguous=${report.ambiguous.length}`)
} finally {
  db.close()
}
