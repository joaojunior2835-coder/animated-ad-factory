// Dependency-free SQL migration runner for the Animated Ad Factory backend.
// NOT an ORM: it applies numbered *.sql files from ./migrations exactly once,
// in filename numeric order, each inside its own transaction.
//
// Standalone:  node server/db/migrate.mjs
// Programmatic: import { runMigrations } from './db/migrate.mjs'
//
// Safety rules this runner enforces:
// - PRAGMA foreign_keys = ON on every connection.
// - An applied migration's checksum must never change. Editing an applied
//   file is a hard failure; changes require a new numbered file.
// - A migration either fully applies and is recorded, or it rolls back and is
//   not recorded. Never half-applied.

import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations')
export const DATA_DIR = path.resolve(__dirname, '..', 'data')
// FACTORY_DB_PATH lets a process point at its own database file. The QA
// harnesses use it so their backend never shares state with the real one:
// since the Node Canvas moved into the database, a shared file would let one
// run's nodes leak into the next run's assertions.
export const DB_PATH = process.env.FACTORY_DB_PATH
  ? path.resolve(process.env.FACTORY_DB_PATH)
  : path.join(DATA_DIR, 'factory.db')

// The runner owns this table: it must exist before we can ask what has been
// applied, so it is bootstrapped here and never inside a migration file.
const APPLIED_MIGRATIONS_DDL = `CREATE TABLE IF NOT EXISTS applied_migrations (
  id INTEGER PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
)`

/** Open the factory database with foreign keys enforced. */
export function openDatabase(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('foreign_keys = ON')
  return db
}

function checksumOf(filePath) {
  // Hash the exact bytes on disk so any edit at all is detected.
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

// "0010_x.sql" sorts after "0009_y.sql" by leading number, not lexically.
function migrationOrder(a, b) {
  const na = Number.parseInt(a, 10)
  const nb = Number.parseInt(b, 10)
  if (Number.isNaN(na) || Number.isNaN(nb)) return a.localeCompare(b)
  if (na !== nb) return na - nb
  return a.localeCompare(b)
}

function listMigrationFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.sql'))
    .sort(migrationOrder)
}

/**
 * Apply every pending migration. Returns { applied, skipped, dbPath }.
 * Throws on checksum drift or SQL failure — callers must treat that as fatal.
 */
export function runMigrations({ dbPath = DB_PATH, migrationsDir = MIGRATIONS_DIR, log = console } = {}) {
  const db = openDatabase(dbPath)
  try {
    db.exec(APPLIED_MIGRATIONS_DDL)

    const recorded = new Map(
      db.prepare('SELECT filename, checksum FROM applied_migrations').all().map((r) => [r.filename, r.checksum])
    )
    const files = listMigrationFiles(migrationsDir)
    const applied = []
    const skipped = []

    for (const filename of files) {
      const fullPath = path.join(migrationsDir, filename)
      const checksum = checksumOf(fullPath)
      const previous = recorded.get(filename)

      if (previous !== undefined) {
        if (previous !== checksum) {
          log.error('[migrate] CHECKSUM MISMATCH — an already-applied migration was edited.')
          log.error(`[migrate]   file:     ${filename}`)
          log.error(`[migrate]   recorded: ${previous}`)
          log.error(`[migrate]   current:  ${checksum}`)
          log.error('[migrate] Applied migrations are immutable. Restore this file to its')
          log.error('[migrate] original content and put your change in a new numbered migration.')
          throw new Error(`Checksum mismatch for already-applied migration ${filename}`)
        }
        skipped.push(filename)
        continue
      }

      const sql = fs.readFileSync(fullPath, 'utf8')
      db.exec('BEGIN')
      try {
        db.exec(sql)
        db.prepare('INSERT INTO applied_migrations (filename, checksum) VALUES (?, ?)').run(filename, checksum)
        db.exec('COMMIT')
      } catch (err) {
        try {
          db.exec('ROLLBACK')
        } catch {
          /* rollback of an already-aborted transaction is not interesting */
        }
        log.error(`[migrate] FAILED applying ${filename} — rolled back, nothing recorded.`)
        log.error(`[migrate]   ${err && err.message ? err.message : String(err)}`)
        throw err
      }
      applied.push(filename)
      log.log(`[migrate] applied ${filename}`)
    }

    if (applied.length === 0) {
      log.log(`[migrate] up to date (${skipped.length} migration(s) already applied)`)
    }
    return { applied, skipped, dbPath }
  } finally {
    db.close()
  }
}

// Standalone entrypoint: node server/db/migrate.mjs
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (invokedDirectly) {
  try {
    const { applied, skipped, dbPath } = runMigrations()
    console.log(`[migrate] database: ${dbPath}`)
    console.log(`[migrate] done — ${applied.length} applied, ${skipped.length} already applied`)
  } catch {
    // runMigrations already logged the specifics.
    process.exit(1)
  }
}
