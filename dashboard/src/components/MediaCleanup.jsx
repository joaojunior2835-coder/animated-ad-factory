import { useState } from 'react'
import { getMediaOrphans, cleanupMedia } from '../lib/ai/apiClient.js'

// Safe reclaiming of orphaned local-media files (left behind by delete/replace).
// Dry-run scan is read-only; deletion is explicit + confirmed + server-re-verified.
function fmtSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export default function MediaCleanup({ scenes }) {
  const [orphans, setOrphans] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  // Referenced set = every variation's file_name + local_url across all scenes.
  // Conservative: anything referenced here is treated as live (never an orphan).
  function referencedFromCanvas() {
    const ref = []
    for (const s of scenes || []) {
      for (const v of s.variations || []) {
        if (v.file_name) ref.push(v.file_name)
        if (v.local_url) ref.push(v.local_url)
      }
    }
    return ref
  }

  async function scan() {
    setBusy(true)
    setError('')
    setMsg('')
    const res = await getMediaOrphans({ project: 'default', referenced: referencedFromCanvas() })
    setBusy(false)
    if (!res || (res.ok === false && res.error)) {
      setError((res && res.error) || 'Scan failed.')
      setOrphans(null)
      return
    }
    setOrphans(Array.isArray(res.orphans) ? res.orphans : [])
  }

  async function doCleanup() {
    if (!orphans || !orphans.length) return
    if (!window.confirm(`Delete ${orphans.length} orphaned file(s) from local-media? This cannot be undone. (Referenced files are never deleted.)`)) return
    setBusy(true)
    setError('')
    setMsg('')
    const res = await cleanupMedia({ project: 'default', file_names: orphans.map((o) => o.file_name), referenced: referencedFromCanvas() })
    setBusy(false)
    if (!res || (res.ok === false && res.error)) {
      setError((res && res.error) || 'Cleanup failed.')
      return
    }
    const del = (res.deleted || []).length
    const skip = (res.skipped || []).length
    const err = (res.errors || []).length
    setMsg(`Deleted ${del}${skip ? `, skipped ${skip} (still referenced)` : ''}${err ? `, ${err} error(s)` : ''}.`)
    await scan() // refresh the list after deletion
  }

  const totalSize = (orphans || []).reduce((a, o) => a + (Number(o.file_size) || 0), 0)

  return (
    <div className="subpanel">
      <div className="row between">
        <h3>Media Cleanup</h3>
        <button className="ghost small" onClick={scan} disabled={busy}>
          {busy ? 'Working…' : 'Scan for orphaned files'}
        </button>
      </div>
      <p className="hint small">
        Finds files in local-media that no variation references anymore (created when you delete or replace variations). The scan is
        read-only; deletion is explicit, confirmed, and the server re-verifies that nothing still referenced (or outside the variations
        folder) is removed.
      </p>
      {error ? <div className="note bad">{error}</div> : null}
      {msg ? <div className="note ok">{msg}</div> : null}
      {orphans == null ? (
        <p className="hint">Run a scan to preview reclaimable files.</p>
      ) : orphans.length === 0 ? (
        <div className="note ok">No orphaned files — local media is clean.</div>
      ) : (
        <>
          <div className="note">
            {orphans.length} orphaned file(s) · {fmtSize(totalSize)} reclaimable
          </div>
          <ul className="missing-list">
            {orphans.map((o) => (
              <li key={o.file_name}>
                {o.file_name} — {fmtSize(o.file_size)}
              </li>
            ))}
          </ul>
          <button className="primary small" onClick={doCleanup} disabled={busy}>
            Delete {orphans.length} orphaned file(s)
          </button>
        </>
      )}
    </div>
  )
}
