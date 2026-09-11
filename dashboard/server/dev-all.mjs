// Runs the Vite frontend and the local backend together (cross-platform, no deps).
// This is what `npm run dev` does, so the app never starts with the backend missing.
// You can also run them separately: `npm run dev:web` and `npm run dev:server`.
// NOTE: spawn `dev:web` (not `dev`) here — `dev` points back at this file.

import { spawn } from 'node:child_process'

const opts = { stdio: 'inherit', shell: true }
const procs = [spawn('npm run dev:web', opts), spawn('npm run dev:server', opts)]

function shutdown() {
  for (const p of procs) {
    try {
      p.kill()
    } catch {
      /* ignore */
    }
  }
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdown()
  process.exit(0)
})
procs.forEach((p) =>
  p.on('exit', () => {
    shutdown()
    process.exit(0)
  })
)
