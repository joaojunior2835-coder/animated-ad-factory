// Runs the Vite frontend and the local backend together (cross-platform, no deps).
// You can also run them separately: `npm run dev` and `npm run dev:server`.

import { spawn } from 'node:child_process'

const opts = { stdio: 'inherit', shell: true }
const procs = [spawn('npm run dev', opts), spawn('npm run dev:server', opts)]

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
