// Backup, inspect and restore for the local factory database.
//
// Snapshots are taken with VACUUM INTO, never a raw file copy. A live SQLite
// database has state outside the main file — a WAL holding committed pages not
// yet checkpointed — so copying factory.db by itself can capture a torn,
// half-written database that looks fine until the day you need it. VACUUM INTO
// asks SQLite for a consistent, fully-checkpointed snapshot instead.
//
// Every snapshot is integrity-checked before it is ever presented as a backup,
// and again before it is ever restored. A backup that silently fails is worse
// than no backup, because it is trusted.

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import AdmZip from 'adm-zip'
import { fileURLToPath } from 'node:url'
import { DB_PATH, DATA_DIR } from './migrate.mjs'
import { closeDb } from './repository.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const BACKUP_DIR = path.resolve(__dirname, '..', 'backups')
export const MEDIA_ROOT = path.resolve(__dirname, '..', '..', 'local-media')
const PKG_PATH = path.resolve(__dirname, '..', '..', 'package.json')

const DB_ENTRY = 'factory.db'
const MANIFEST_ENTRY = 'manifest.json'
const MEDIA_PREFIX = 'media/'

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function appVersion() {
  try {
    return JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).version || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Open read-only and confirm SQLite considers the file sound. */
function integrityOk(dbFile) {
  let db = null
  try {
    db = new Database(dbFile, { readonly: true })
    const rows = db.pragma('integrity_check')
    return rows.length === 1 && rows[0].integrity_check === 'ok'
  } catch {
    return false
  } finally {
    if (db) db.close()
  }
}

// A zip path separator is always "/", regardless of the host platform.
const toPosix = (p) => String(p).split(path.sep).join('/')

// relative_path values are stored relative to MEDIA_ROOT. Resolve defensively:
// a path escaping the media root would let a crafted archive write anywhere.
function resolveMedia(relativePath) {
  const safe = toPosix(relativePath).replace(/^\/+/, '')
  const resolved = path.resolve(MEDIA_ROOT, safe)
  const rootWithSep = MEDIA_ROOT.endsWith(path.sep) ? MEDIA_ROOT : MEDIA_ROOT + path.sep
  if (resolved !== MEDIA_ROOT && !resolved.startsWith(rootWithSep)) return null
  return resolved
}

function sha256File(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  } catch {
    return null
  }
}

/** Human-readable owners for an asset, derived from its asset_link rows. */
function describeOwners(links) {
  const out = []
  for (const l of links) {
    if (l.product_id != null) out.push(`product:${l.product_id}`)
    else if (l.product_test_id != null) out.push(`product_test:${l.product_test_id}`)
    else if (l.creative_id != null) out.push(`creative:${l.creative_id}`)
    else if (l.production_run_id != null) out.push(`production_run:${l.production_run_id}`)
    else if (l.job_id != null) out.push(`job:${l.job_id}`)
    else if (l.is_shared_library) out.push('shared_library')
    if (l.role) out[out.length - 1] += ` (role: ${l.role})`
  }
  return out
}

function buildAssetManifest(db) {
  const assets = db.prepare('SELECT id, content_hash, relative_path, mime_type, file_size FROM asset ORDER BY id').all()
  const links = db.prepare('SELECT * FROM asset_link').all()
  const byAsset = new Map()
  for (const l of links) {
    if (!byAsset.has(l.asset_id)) byAsset.set(l.asset_id, [])
    byAsset.get(l.asset_id).push(l)
  }
  return assets.map((a) => ({
    assetId: a.id,
    contentHash: a.content_hash,
    relativePath: a.relative_path,
    mimeType: a.mime_type,
    fileSize: a.file_size,
    referencedBy: describeOwners(byAsset.get(a.id) || []),
  }))
}

function schemaVersion(db) {
  const row = db.prepare('SELECT filename FROM applied_migrations ORDER BY filename DESC LIMIT 1').get()
  return row ? row.filename : null
}

/**
 * Snapshot the database (and optionally the media it references) into a zip.
 */
export function backupState({ includeMedia = false } = {}) {
  ensureDir(BACKUP_DIR)
  const ts = stamp()
  const tempDb = path.join(BACKUP_DIR, `.tmp-${ts}.db`)

  // 1. Consistent snapshot — not a file copy.
  const live = new Database(DB_PATH, { readonly: true })
  try {
    live.prepare('VACUUM INTO ?').run(tempDb)
  } finally {
    live.close()
  }

  // 2. A snapshot that fails its own integrity check must never become a backup.
  if (!integrityOk(tempDb)) {
    try {
      fs.unlinkSync(tempDb)
    } catch {
      /* best effort */
    }
    throw new Error('Backup aborted: the database snapshot failed its integrity check.')
  }

  // 3/4. Manifest, read from the verified snapshot rather than the live db.
  const snap = new Database(tempDb, { readonly: true })
  let assets
  let manifest
  try {
    assets = buildAssetManifest(snap)
    manifest = {
      schema_version: schemaVersion(snap),
      app_version: appVersion(),
      created_at: new Date().toISOString(),
      includeMedia: !!includeMedia,
      assets,
    }
  } finally {
    snap.close()
  }

  // 6. Media, when asked for. A referenced file that is missing from disk is
  // recorded as such rather than quietly dropped — a backup should tell you
  // what it could not capture.
  const zip = new AdmZip()
  if (includeMedia) {
    for (const a of manifest.assets) {
      const abs = resolveMedia(a.relativePath)
      const found = !!(abs && fs.existsSync(abs) && fs.statSync(abs).isFile())
      a.fileFoundAtBackupTime = found
      if (found) zip.addFile(MEDIA_PREFIX + toPosix(a.relativePath).replace(/^\/+/, ''), fs.readFileSync(abs))
    }
  }

  zip.addFile(MANIFEST_ENTRY, Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
  zip.addFile(DB_ENTRY, fs.readFileSync(tempDb))

  const archivePath = path.join(BACKUP_DIR, `factory-backup-${ts}.zip`)
  zip.writeZip(archivePath)

  // 7. The uncompressed snapshot has served its purpose.
  try {
    fs.unlinkSync(tempDb)
  } catch {
    /* best effort */
  }

  return {
    archivePath,
    summary: {
      assetCount: manifest.assets.length,
      includeMedia: !!includeMedia,
      archiveSizeBytes: fs.statSync(archivePath).size,
    },
  }
}

function stageArchive(archivePath) {
  const dir = ensureDir(path.join(BACKUP_DIR, `.inspect-${stamp()}-${Math.random().toString(36).slice(2, 8)}`))
  new AdmZip(archivePath).extractAllTo(dir, true)
  return dir
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}

/**
 * Read-only completeness report for an archive. Safe to call at any time:
 * it never touches the live database or the live media directory.
 */
export function inspectBackup(archivePath) {
  if (!archivePath || !fs.existsSync(archivePath)) {
    return { ok: false, error: 'archive_not_found', archivePath: archivePath || null }
  }

  let staged = null
  try {
    try {
      staged = stageArchive(archivePath)
    } catch (e) {
      return { ok: false, error: 'invalid_archive', detail: e && e.message ? e.message : String(e) }
    }

    // 2. A manifest that is missing or unparseable is a rejection, not a crash.
    const manifestPath = path.join(staged, MANIFEST_ENTRY)
    let manifest
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      if (!manifest || typeof manifest !== 'object' || !Array.isArray(manifest.assets)) {
        return { ok: false, error: 'invalid_manifest' }
      }
    } catch {
      return { ok: false, error: 'invalid_manifest' }
    }

    // 3. The archived database must pass its own integrity check.
    const stagedDb = path.join(staged, DB_ENTRY)
    if (!fs.existsSync(stagedDb) || !integrityOk(stagedDb)) {
      return { ok: false, error: 'db_integrity_failed' }
    }

    // 4. Where a file is expected depends on what kind of backup this is.
    const bundled = !!manifest.includeMedia
    const missing = []
    let present = 0
    for (const a of manifest.assets) {
      const rel = toPosix(a.relativePath || '').replace(/^\/+/, '')
      let exists = false
      if (bundled) {
        exists = fs.existsSync(path.join(staged, MEDIA_PREFIX, rel))
      } else {
        const abs = resolveMedia(rel)
        exists = !!(abs && fs.existsSync(abs))
      }
      if (exists) present++
      else {
        missing.push({
          assetId: a.assetId,
          contentHash: a.contentHash,
          relativePath: a.relativePath,
          referencedBy: a.referencedBy || [],
        })
      }
    }

    return {
      ok: true,
      archivePath,
      schemaVersion: manifest.schema_version || null,
      appVersion: manifest.app_version || null,
      createdAt: manifest.created_at || null,
      includeMedia: bundled,
      dbIntegrityOk: true,
      totalAssetsReferenced: manifest.assets.length,
      assetsPresent: present,
      assetsMissing: missing.length,
      missingAssetDetails: missing,
      // A state-only backup records no media of its own, so this check reports
      // what exists on THIS machine right now. Carried to another machine it
      // will legitimately list assets as missing — that is accurate, not a fault
      // in the archive.
      mediaCheckScope: bundled ? 'bundled_in_archive' : 'live_local_media_on_this_machine',
    }
  } finally {
    if (staged) removeDir(staged)
  }
}

/**
 * Replace the live database with an archived one. Destructive, and gated on
 * explicit confirmation — the same discipline as the Replicate cost dialog.
 *
 * The caller is expected to send the HTTP response and then stop the process:
 * the new file cannot be swapped under an open connection safely, so a restart
 * is required and is deliberately preferred over a risky hot-swap.
 */
export function restoreFromBackup(archivePath, { confirmed = false } = {}) {
  // 1. Unconfirmed: report what would happen and touch nothing.
  if (confirmed !== true) {
    return { restoreStarted: false, confirmationRequired: true, inspection: inspectBackup(archivePath) }
  }

  // 2. Always re-inspect now. A report from an earlier call may describe an
  // archive that has since changed.
  const inspection = inspectBackup(archivePath)
  if (!inspection.ok || inspection.dbIntegrityOk !== true) {
    return { restoreStarted: false, aborted: true, reason: inspection.error || 'inspection_failed', inspection }
  }

  const staged = stageArchive(archivePath)
  try {
    ensureDir(DATA_DIR)

    // The live connection must be released before the file is touched. On
    // Windows an open handle makes rename fail outright with EBUSY; on POSIX it
    // would succeed silently and leave the server writing to an unlinked inode,
    // which is worse. Either way the connection has to go first. The repository
    // reopens lazily, so if anything below fails the server is still usable.
    closeDb()

    // 3. The current database is moved aside, never deleted — restoring the
    // wrong archive must stay recoverable.
    const preRestoreBackupPath = `${DB_PATH}.pre-restore-backup-${stamp()}`
    if (fs.existsSync(DB_PATH)) fs.renameSync(DB_PATH, preRestoreBackupPath)
    // WAL/SHM belong to the database being replaced; leaving them would let
    // SQLite apply stale pages over the restored file.
    for (const suffix of ['-wal', '-shm']) {
      const side = DB_PATH + suffix
      if (fs.existsSync(side)) {
        try {
          fs.unlinkSync(side)
        } catch {
          /* best effort */
        }
      }
    }

    // 4. The archived database becomes the live one.
    fs.copyFileSync(path.join(staged, DB_ENTRY), DB_PATH)

    // 5. Bundled media. An existing local file with different content is a
    // conflict to report, not something to overwrite silently.
    const mediaRestored = []
    const mediaConflicts = []
    if (inspection.includeMedia) {
      const manifest = JSON.parse(fs.readFileSync(path.join(staged, MANIFEST_ENTRY), 'utf8'))
      for (const a of manifest.assets) {
        const rel = toPosix(a.relativePath || '').replace(/^\/+/, '')
        const src = path.join(staged, MEDIA_PREFIX, rel)
        if (!fs.existsSync(src)) continue
        const dest = resolveMedia(rel)
        if (!dest) {
          mediaConflicts.push({ relativePath: a.relativePath, reason: 'path_outside_media_root' })
          continue
        }
        if (fs.existsSync(dest)) {
          const localHash = sha256File(dest)
          if (localHash && a.contentHash && localHash !== a.contentHash) {
            mediaConflicts.push({
              relativePath: a.relativePath,
              reason: 'local_file_differs',
              localContentHash: localHash,
              archivedContentHash: a.contentHash,
            })
            continue
          }
        }
        ensureDir(path.dirname(dest))
        fs.copyFileSync(src, dest)
        mediaRestored.push(a.relativePath)
      }
    }

    return {
      restoreStarted: true,
      preRestoreBackupPath,
      inspection,
      mediaRestored: mediaRestored.length,
      mediaConflicts,
      restartRequired: true,
      message: 'Restore complete. The backend has stopped — restart it with npm run dev:all to continue.',
    }
  } finally {
    removeDir(staged)
  }
}

/** Archives currently on disk, newest first. */
export function listBackups() {
  ensureDir(BACKUP_DIR)
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .map((f) => {
      const st = fs.statSync(path.join(BACKUP_DIR, f))
      return { name: f, path: path.join(BACKUP_DIR, f), sizeBytes: st.size, modifiedAt: st.mtime.toISOString() }
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}
