import { useState } from 'react'
import { assetDisplayName, assetMediaKind, assetMediaUrl } from '../lib/assetMedia.js'
import './WorkspaceShell.css'

export default function AssetPreview({ asset, compact = false, className = '', onError }) {
  const [failedUrl, setFailedUrl] = useState('')
  const url = assetMediaUrl(asset)
  const kind = assetMediaKind(asset)
  const width = Number(asset?.width)
  const height = Number(asset?.height)
  const aspect = width > 0 && height > 0 ? `${width} / ${height}` : kind === 'video' ? '9 / 16' : '1 / 1'
  const unavailable = !url || failedUrl === url
  const failed = () => { setFailedUrl(url); onError?.(asset) }

  return <div className={`asset-preview${compact ? ' asset-preview-compact' : ''} ${className}`} data-kind={kind} style={{ '--asset-aspect': aspect }}>
    {unavailable ? <div className="asset-preview-message" role={compact ? undefined : 'status'}><span>Media unavailable</span>{!compact ? <small>The saved file is missing or cannot be displayed.</small> : null}</div>
      : kind === 'image' ? <img src={url} alt={assetDisplayName(asset)} loading="lazy" decoding="async" onError={failed} />
        : kind === 'video' ? <><video src={url} controls={!compact} preload="metadata" playsInline muted={compact} onError={failed} />{compact ? <span className="asset-preview-video-label" aria-hidden="true">Video</span> : null}</>
          : kind === 'audio' ? compact ? <div className="asset-preview-audio" aria-label="Audio file"><svg viewBox="0 0 64 48" aria-hidden="true"><path d="M8 19v10m8-20v30m8-24v18m8-29v40m8-34v28m8-22v16m8-10v4" /></svg><span>Audio reference</span></div> : <audio src={url} controls preload="metadata" onError={failed} />
            : <div className="asset-preview-message">Preview unavailable for this file type.</div>}
  </div>
}
