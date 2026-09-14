import { apiBase } from './ai/apiClient.js'

export function assetMediaKind(asset) {
  const mime = String(asset?.mime_type || '').toLowerCase()
  return mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'file'
}

// Asset rows hold relative local paths. Never load arbitrary provider URLs
// through this shared preview or silently send a local file back to a provider.
export function assetMediaUrl(asset) {
  const path = asset?.relative_path
  if (typeof path !== 'string' || !path || path.startsWith('/') || /[\\\u0000-\u001f]/.test(path)) return ''
  const parts = path.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) return ''
  const prefix = path === 'mock-video-output.mp4' ? '/' : '/media/'
  return apiBase() + prefix + parts.map(encodeURIComponent).join('/')
}

export function assetDisplayName(asset) {
  return asset?.name || asset?.file_name || String(asset?.relative_path || '').split('/').pop() || `Asset ${asset?.id ?? ''}`
}

export function assetFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Size not recorded'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function assetDimensions(asset) {
  return Number(asset?.width) > 0 && Number(asset?.height) > 0 ? `${asset.width} × ${asset.height}` : ''
}

export function assetCreatedLabel(asset) {
  if (!asset?.created_at) return 'Date not recorded'
  const raw = String(asset.created_at)
  const normalized = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? 'Date not recorded' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export async function downloadLocalAsset(asset) {
  const url = assetMediaUrl(asset)
  if (!url) throw new Error('This Asset has no valid local media path.')
  const response = await fetch(url)
  if (!response.ok) throw new Error('Local media is unavailable. Refresh the library and check the saved file.')
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = assetDisplayName(asset)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
}
