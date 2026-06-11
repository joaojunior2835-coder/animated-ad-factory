import { classifyMedia } from '../lib/canvasModel.js'

// Renders a small media preview. Precedence: local disk file -> external URL
// (real image/video) -> session upload (`preview` data-URL) -> mock placeholder
// -> external link. mock:// never loads as real media.
export default function MediaPreview({ url, preview, local }) {
  const localKind = classifyMedia(local)
  if (local && (localKind === 'image' || localKind === 'video')) {
    return localKind === 'video'
      ? <video className="media-preview" src={local} controls />
      : <img className="media-preview" src={local} alt="local preview" />
  }

  const kind = classifyMedia(url)
  if (kind === 'image') return <img className="media-preview" src={url} alt="preview" />
  if (kind === 'video') return <video className="media-preview" src={url} controls />

  if (preview) {
    if (String(preview).startsWith('data:video')) return <video className="media-preview" src={preview} controls />
    return <img className="media-preview" src={preview} alt="preview" />
  }

  if (kind === 'mock') return <div className="media-mock">{String(url).includes('video') ? 'Mock video output' : 'Mock image output'}</div>
  if (kind === 'link')
    return (
      <a className="media-link" href={url} target="_blank" rel="noreferrer">
        {url}
      </a>
    )
  return null
}
