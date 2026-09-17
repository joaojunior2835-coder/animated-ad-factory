import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
    allowedHosts: ['shareware-workshops-flows-pools.trycloudflare.com'],
    proxy: Object.fromEntries(['/api', '/health', '/media', '/mock-video-output.mp4'].map((route) => [route, 'http://127.0.0.1:8787']))
  }
})
