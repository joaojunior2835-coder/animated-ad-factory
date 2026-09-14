import { useEffect, useRef, useState } from 'react'
import { apiBase } from '../lib/ai/apiClient.js'
import { assetCreatedLabel, assetDimensions, assetDisplayName, assetFileSize, assetMediaKind, downloadLocalAsset } from '../lib/assetMedia.js'
import AssetPreview from './AssetPreview.jsx'
import './WorkspaceShell.css'

const FILTERS = [['all', 'All media'], ['image', 'Images'], ['video', 'Videos'], ['audio', 'Audio']]

/**
 * Transfer callbacks receive the canonical Asset row (including its stable id).
 * They link that Asset or create an explicitly named draft in the destination;
 * this library does not upload, generate, change lineage, or duplicate files.
 */
export default function AssetsWorkspace({
  assets, selectedAssetId, onSelectAsset, contextLabel,
  onUseAsStartFrame, onAddToCanvas, onUseInStudio, onSaveToCreative,
}) {
  const [loadedAssets, setLoadedAssets] = useState([])
  const [loading, setLoading] = useState(assets === undefined)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('all')
  const [source, setSource] = useState('all')
  const [search, setSearch] = useState('')
  const [selection, setSelection] = useState(null)
  const [busy, setBusy] = useState(false)
  const requestRef = useRef(null)
  const actionLock = useRef(false)
  const controlledLibrary = assets !== undefined
  const library = assets ?? loadedAssets

  const refresh = async () => {
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${apiBase()}/api/operator/generator/options`, { signal: controller.signal })
      const result = await response.json()
      if (!response.ok || result.ok === false || !Array.isArray(result.media)) throw new Error(result.error || 'Could not load the local media library.')
      if (!controller.signal.aborted) setLoadedAssets(result.media)
    } catch (error) {
      if (!controller.signal.aborted) setError(error?.message || 'The local media library is unavailable.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    if (!controlledLibrary) refresh()
    return () => requestRef.current?.abort()
    // A supplied library is controlled by its parent; otherwise this component
    // reads the existing generator options endpoint once and on explicit refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controlledLibrary])

  const selected = library.find(asset => String(asset.id) === String(selectedAssetId !== undefined ? selectedAssetId : selection)) || null
  const query = search.trim().toLowerCase()
  const visible = library.filter(asset => (filter === 'all' || assetMediaKind(asset) === filter)
    && (source === 'all' || asset.source === source)
    && (!query || [assetDisplayName(asset), asset.id, asset.provider, asset.source].join(' ').toLowerCase().includes(query)))
  const counts = { all: library.length, image: 0, video: 0, audio: 0 }
  library.forEach(asset => { const kind = assetMediaKind(asset); if (kind in counts) counts[kind]++ })

  const choose = asset => { setSelection(asset.id); setNotice(''); setError(''); onSelectAsset?.(asset) }
  const act = async (callback, success) => {
    if (!selected || actionLock.current) return
    actionLock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try { await callback(selected); if (success) setNotice(success) }
    catch (error) { setError(error?.message || 'The Asset action could not be completed.') }
    finally { actionLock.current = false; setBusy(false) }
  }
  const selectedKind = assetMediaKind(selected)

  return <section className="assets-workspace" data-testid="assets-workspace">
    <header className="assets-header">
      <div><span className="workspace-eyebrow">YOUR CREATIVE LIBRARY</span><h2>Assets</h2><p>Every saved image, video and reference. Ready for your next creation.</p></div>
      {assets === undefined ? <button type="button" className="ghost" onClick={refresh} disabled={loading}>Refresh library</button> : null}
    </header>
    <div className="assets-filters">
      <div className="workspace-segmented" aria-label="Media type">
        {FILTERS.map(([key, label]) => <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span>{counts[key]}</span></button>)}
      </div>
      <div className="assets-search-controls">
        <input type="search" aria-label="Search Assets" placeholder="Search your media" value={search} onChange={event => setSearch(event.target.value)} />
        <select aria-label="Asset source" value={source} onChange={event => setSource(event.target.value)}><option value="all">All sources</option><option value="generated">Generated</option><option value="uploaded">Uploaded</option><option value="supplier">Supplier</option></select>
      </div>
    </div>
    {error ? <p className="note bad" role="alert">{error}</p> : null}
    {notice ? <p className="assets-action-notice" role="status">{notice}</p> : null}
    <div className={`assets-layout${selected ? ' assets-with-selection' : ''}`}>
      <div className="assets-library">
        {!controlledLibrary && loading && !library.length ? <div className="assets-skeletons" role="status" aria-label="Loading media">{[0, 1, 2, 3, 4, 5].map(id => <div key={id} className="assets-skeleton" />)}</div>
          : visible.length ? <div className="assets-grid" aria-label="Saved media">{visible.map(asset => <button type="button" key={asset.id} data-testid={`asset-card-${asset.id}`} className={`asset-card${selected?.id === asset.id ? ' selected' : ''}`} aria-pressed={selected?.id === asset.id} onClick={() => choose(asset)}>
            <AssetPreview asset={asset} compact />
            <span className="asset-card-caption"><span className="asset-card-name" title={assetDisplayName(asset)}>{assetDisplayName(asset)}</span><span className="asset-card-meta"><span>{assetDimensions(asset) || assetMediaKind(asset)}</span><span>{asset.source || 'Local'}</span></span></span>
          </button>)}</div>
            : <div className="assets-empty"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="13" width="46" height="38" rx="7" /><circle cx="24" cy="27" r="5" /><path d="m13 46 13-12 9 7 7-7 9 12" /></svg><h3>{library.length ? 'No matching media' : 'Your next creation starts here'}</h3><p>{library.length ? 'Try another media type, source or search.' : 'Saved generations and uploaded references will appear in this shared library.'}</p>{library.length ? <button type="button" className="ghost" onClick={() => { setFilter('all'); setSource('all'); setSearch('') }}>Clear filters</button> : null}</div>}
        <p className="assets-library-note">{visible.length} of {library.length} saved Assets · Original files stay in your local media library.</p>
      </div>
      {selected ? <aside className="asset-detail" aria-label="Selected Asset">
        <div className="asset-detail-heading"><span className="workspace-eyebrow">SELECTED {selectedKind.toUpperCase()}</span><button type="button" className="ghost small" onClick={() => { setSelection(null); onSelectAsset?.(null) }} aria-label="Close Asset preview">Close</button></div>
        <AssetPreview key={selected.id} asset={selected} />
        <h3>{assetDisplayName(selected)}</h3>
        <dl className="asset-metadata"><div><dt>Asset</dt><dd>#{selected.id}</dd></div><div><dt>Dimensions</dt><dd>{assetDimensions(selected) || 'Not recorded'}</dd></div>{Number(selected.duration_seconds) > 0 ? <div><dt>Duration</dt><dd>{Number(selected.duration_seconds).toFixed(2)} s</dd></div> : null}<div><dt>File size</dt><dd>{assetFileSize(selected.file_size)}</dd></div><div><dt>Source</dt><dd>{[selected.source, selected.provider].filter(Boolean).join(' · ') || 'Local media'}</dd></div><div><dt>Saved</dt><dd>{assetCreatedLabel(selected)}</dd></div></dl>
        <button type="button" className="primary asset-download" disabled={busy} onClick={() => act(downloadLocalAsset)}>Download {selectedKind === 'file' ? 'file' : selectedKind}</button>
        {(onUseAsStartFrame || onAddToCanvas || onUseInStudio || onSaveToCreative) ? <div className="asset-transfer-actions"><span className="workspace-eyebrow">USE THIS ASSET</span>{contextLabel ? <p className="hint small">{contextLabel}</p> : null}
          {selectedKind === 'image' && onUseAsStartFrame ? <button type="button" className="ghost" disabled={busy} onClick={() => act(onUseAsStartFrame, 'Asset linked to a Video draft.')}>Use as Start Frame</button> : null}
          {['image', 'video'].includes(selectedKind) && onAddToCanvas ? <button type="button" className="ghost" disabled={busy} onClick={() => act(onAddToCanvas, 'Asset linked to Canvas.')}>Add to Canvas</button> : null}
          {selectedKind === 'image' && onUseInStudio ? <button type="button" className="ghost" disabled={busy} onClick={() => act(onUseInStudio, 'Asset linked to Studio.')}>Use in Studio</button> : null}
          {['image', 'video'].includes(selectedKind) && onSaveToCreative ? <button type="button" className="ghost" disabled={busy} onClick={() => act(onSaveToCreative, 'Asset linked to the selected Creative.')}>Save to Creative</button> : null}
          <small>Reuse links the saved Asset. The original file is preserved.</small>
        </div> : null}
      </aside> : null}
    </div>
  </section>
}
