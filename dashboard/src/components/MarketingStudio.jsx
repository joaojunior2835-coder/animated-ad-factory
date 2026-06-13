import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FORMATS,
  FORMAT_CATEGORIES,
  CHARACTERS,
  hooksForLanguage,
  SETTINGS_LIBRARY,
  settingById,
  applySettingToDescription,
  ASPECT_OPTIONS,
  QUALITY_HINTS,
  PLATFORMS,
  platformById,
  effectiveAspectRatio,
  CUSTOM_CHARACTER_PREFIX,
  STUDIO_DURATIONS,
  CLIP_DURATIONS,
  PRODUCT_CATEGORIES,
  formatById,
  characterById,
  isTwoCharacterFormat,
  studioLanguage,
  purposeLabel,
  generateSceneOutline,
  generateOmniPrompts,
  regenerateScene,
  extractBriefFromText,
  buildCopyAllText,
  buildStudioMarkdown,
  modelsNeeded,
  totalPromptDuration,
  emptyStudio,
  normalizeStudio,
  parseMarkdownPackage,
  loadCustomCharacters,
  saveCustomCharacters,
  searchNorm,
  getDefaultCharactersForFormat,
  CUSTOM_CHARACTERS_KEY
} from '../lib/marketingStudioModel.js'

const STEPS = [
  { key: 'brief', label: 'Brief' },
  { key: 'format', label: 'Format' },
  { key: 'characters', label: 'Characters' },
  { key: 'script', label: 'Script' },
  { key: 'export', label: 'Export' }
]

// Copy text to the clipboard with a textarea fallback (no API, works on http).
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
  }
  return Promise.resolve(fallbackCopy(text))
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } catch {
    // Non-fatal; the user can still select manually.
  }
  ta.remove()
}

// A button that flips to "Copied ✓" for 2 seconds.
function CopyButton({ text, label = 'Copy', className = 'ghost small' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={className}
      onClick={() => {
        copyText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  )
}

// Copy-all with a satisfying confirmation: scales on click, reports the count.
function CopyAllButton({ prompts }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className={copied ? 'primary ms-copyall copied' : 'primary ms-copyall'}
      onClick={() => {
        copyText(buildCopyAllText(prompts))
        setCopied(true)
        setTimeout(() => setCopied(false), 3000)
      }}
    >
      {copied ? `✓ Copied ${prompts.length} prompts to clipboard` : 'Copy All Prompts'}
    </button>
  )
}

function downloadMarkdown(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function slugify(value) {
  const s = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return s || 'marketing-studio'
}

// ---- Step indicator ----
function StepIndicator({ step, maxReached, onJump }) {
  return (
    <div className="ms-steps">
      {STEPS.map((s, i) => {
        const state = i < step ? 'done' : i === step ? 'active' : 'todo'
        const clickable = i <= maxReached
        return (
          <button
            key={s.key}
            className={`ms-step ${state}${clickable ? ' clickable' : ''}`}
            onClick={() => clickable && onJump(i)}
            disabled={!clickable}
            title={clickable ? `Go to ${s.label}` : 'Complete the previous steps first'}
          >
            <span className="ms-step-num">{state === 'done' ? '✓' : i + 1}</span>
            <span className="ms-step-label">{s.label}</span>
            {i < STEPS.length - 1 ? <span className="ms-step-arrow">→</span> : null}
          </button>
        )
      })}
    </div>
  )
}

// ---- Hook search bar (Tier 2) ----
function HookSearchBar({ language, onChangeLanguage, onFilter }) {
  const [query, setQuery] = useState('')
  const [langFilter, setLangFilter] = useState(language)

  // Sync when parent language changes (e.g. user changes brief language toggle)
  useEffect(() => { setLangFilter(language) }, [language])

  useEffect(() => {
    const q = searchNorm(query.trim())
    onFilter(() => (h) => {
      const langOk = langFilter === 'all' ? true : (h.language === langFilter || h.language === 'any')
      const textOk = !q || searchNorm(h.name).includes(q) || searchNorm(h.text).includes(q)
      return langOk && textOk
    })
  }, [query, langFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  function pickLang(l) {
    setLangFilter(l)
    if (l !== 'all') onChangeLanguage(l)
  }

  return (
    <div className="ms-hook-search-bar">
      <input
        className="ms-input ms-hook-search-input"
        placeholder="🔍 Search hooks…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="ms-toggle-row">
        <button className={langFilter === 'fr' ? 'ms-toggle active' : 'ms-toggle'} onClick={() => pickLang('fr')}>🇫🇷 FR</button>
        <button className={langFilter === 'en' ? 'ms-toggle active' : 'ms-toggle'} onClick={() => pickLang('en')}>🇬🇧 EN</button>
        <button className={langFilter === 'all' ? 'ms-toggle active' : 'ms-toggle'} onClick={() => pickLang('all')}>All</button>
      </div>
    </div>
  )
}

// ---- Step 1: Product Brief ----
function BriefStep({ studio, onUpdate, onNext, productLibrary, onSaveProductToLibrary, onDeleteProductFromLibrary }) {
  const [pasted, setPasted] = useState('')
  const [filledKeys, setFilledKeys] = useState([])
  const [hookApplied, setHookApplied] = useState('')
  const [hookFilter, setHookFilter] = useState(null)
  const [libOpen, setLibOpen] = useState(false)
  const [loadedFlash, setLoadedFlash] = useState('')
  const [savedFlash, setSavedFlash] = useState(false)
  const hookFieldRef = useRef(null)
  const nameFieldRef = useRef(null)

  // The cursor is waiting the moment the step appears.
  useEffect(() => {
    if (nameFieldRef.current) nameFieldRef.current.focus()
  }, [])
  const p = studio.product
  const b = studio.brief
  const library = Array.isArray(productLibrary) ? productLibrary : []
  const sortedLib = [...library].sort((a, b2) => (b2.savedAt || 0) - (a.savedAt || 0))

  const setProduct = (key, value) => onUpdate((s) => ({ ...s, product: { ...s.product, [key]: value } }))
  const setBrief = (key, value) => onUpdate((s) => ({ ...s, brief: { ...s.brief, [key]: value } }))
  const setOutput = (patch) => onUpdate((s) => ({ ...s, output: { ...s.output, ...patch }, prompts: [] }))

  function pickPlatform(id) {
    const platform = platformById(id)
    // Platform implies its aspect ratio; clearing the platform keeps the ratio.
    setOutput(platform ? { platform: id, aspectRatio: platform.aspectRatio } : { platform: '' })
  }

  const filled = (key) => (filledKeys.includes(key) ? ' ms-autofilled' : '')

  const hooks = hooksForLanguage(b.language)
  // HookSearchBar owns both language and text filtering; use all hooks as the pool
  const allHooks = [...hooks]
  const filteredHooks = hookFilter ? allHooks.filter(hookFilter) : allHooks

  function applyHook(hook) {
    setBrief('hook', hook.text)
    setHookApplied(hook.id)
    if (hookFieldRef.current) {
      hookFieldRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
      hookFieldRef.current.focus()
    }
    setTimeout(() => setHookApplied(''), 2000)
  }

  function surpriseHook() {
    const pool = filteredHooks.length ? filteredHooks : hooks
    if (!pool.length) return
    applyHook(pool[Math.floor(Math.random() * pool.length)])
  }

  function extract() {
    const r = extractBriefFromText(pasted)
    onUpdate((s) => ({
      ...s,
      product: { ...s.product, ...r.product },
      brief: { ...s.brief, ...r.brief }
    }))
    setFilledKeys(r.filledKeys)
  }

  const ready = p.name.trim().length > 0 && p.description.trim().length > 0

  function loadProduct(entry) {
    // Full normalized replace (never a merge) so stale keys from older saves
    // can't leak in and every Step 1 field reflects exactly the saved product.
    onUpdate((s) => ({ ...s, product: normalizeStudio({ product: entry.product }).product }))
    setLoadedFlash(entry.name)
    setTimeout(() => setLoadedFlash(''), 2000)
  }

  function saveToLibrary() {
    if (!p.name.trim()) return
    onSaveProductToLibrary(p)
    setSavedFlash(true)
    setTimeout(() => setSavedFlash(false), 2000)
  }

  return (
    <div className="ms-stepbody">
      <h3>Step 1 — Product Brief</h3>
      <p className="hint small">One structured brief drives the whole package. Product name + description are required; everything else sharpens the script.</p>

      <div className="ms-product-lib">
        <button className="ms-lib-toggle" onClick={() => setLibOpen((o) => !o)}>
          📦 My Products ({library.length}) {libOpen ? '▲' : '▼'}
        </button>
        {libOpen && (
          <div className="ms-lib-body">
            {loadedFlash ? <div className="ms-lib-flash">Loaded: {loadedFlash}</div> : null}
            {sortedLib.length === 0 ? (
              <p className="hint small ms-lib-empty">No saved products yet.</p>
            ) : (
              <div className="ms-lib-list">
                {sortedLib.map((entry) => (
                  <div key={entry.id} className="ms-lib-row">
                    <div className="ms-lib-info">
                      <span className="ms-lib-name">{entry.name}</span>
                      {entry.product && entry.product.category ? <span className="ms-badge">{entry.product.category}</span> : null}
                      <span className="hint small">{new Date(entry.savedAt).toLocaleDateString()}</span>
                    </div>
                    <div className="row">
                      <button className="ghost small" onClick={() => loadProduct(entry)}>Load</button>
                      <button className="ghost small danger" onClick={() => {
                        if (window.confirm(`Delete "${entry.name}" from your product library?`)) onDeleteProductFromLibrary(entry.id)
                      }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="ms-grid2">
        <label className="field">
          <span className="field-label">Product name *</span>
          <input ref={nameFieldRef} className={`ms-input${filled('product.name')}`} value={p.name} placeholder="NuitCalme" onChange={(e) => setProduct('name', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Product category</span>
          <select className="ms-input" value={p.category} onChange={(e) => setProduct('category', e.target.value)}>
            <option value="">(choose)</option>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="field">
        <span className="field-label">Product description * (2-3 sentences)</span>
        <textarea className={`ms-input${filled('product.description')}`} rows={3} value={p.description} placeholder="What it is, what it does, in plain language." onChange={(e) => setProduct('description', e.target.value)} />
      </label>

      <div className="ms-grid2">
        <label className="field">
          <span className="field-label">Key benefit / hook (what makes it special)</span>
          <textarea ref={hookFieldRef} className={`ms-input${filled('brief.hook')}${filled('product.benefits')}${hookApplied ? ' ms-autofilled' : ''}`} rows={2} value={b.hook} placeholder="The one line that stops the scroll." onChange={(e) => setBrief('hook', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Target audience (who it's for)</span>
          <textarea className={`ms-input${filled('product.targetAudience')}`} rows={2} value={p.targetAudience} placeholder="women aged 30-45 with evening cravings" onChange={(e) => setProduct('targetAudience', e.target.value)} />
        </label>
      </div>

      <div className="ms-grid2">
        <label className="field">
          <span className="field-label">Key ingredient or mechanism (optional)</span>
          <input className={`ms-input${filled('product.keyIngredient')}`} value={p.keyIngredient} placeholder="saffron extract" onChange={(e) => setProduct('keyIngredient', e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Claim boundary (compliance — what you can/cannot claim)</span>
          <input className={`ms-input${filled('product.claimBoundary')}`} value={p.claimBoundary} placeholder="no medical or weight-loss claims" onChange={(e) => setProduct('claimBoundary', e.target.value)} />
        </label>
      </div>

      <div className="ms-grid2">
        <label className="field">
          <span className="field-label">Language</span>
          <div className="ms-toggle-row">
            <button className={b.language === 'fr' ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setBrief('language', 'fr')}>🇫🇷 French</button>
            <button className={b.language === 'en' ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setBrief('language', 'en')}>🇬🇧 English</button>
          </div>
        </label>
        <label className="field">
          <span className="field-label">Ad duration</span>
          <div className="ms-toggle-row">
            {STUDIO_DURATIONS.map((d) => (
              <button key={d} className={b.duration === d ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setBrief('duration', d)}>{d}s</button>
            ))}
          </div>
        </label>
      </div>

      <label className="field">
        <span className="field-label">Landing page URL (optional, for reference)</span>
        <input className={`ms-input${filled('product.landingPageUrl')}`} value={p.landingPageUrl} placeholder="https://…" onChange={(e) => setProduct('landingPageUrl', e.target.value)} />
      </label>

      <div className="ms-output-settings">
        <span className="field-label">Output Settings</span>
        <div className="ms-grid2">
          <label className="field">
            <span className="field-label">Platform target (auto-sets aspect ratio)</span>
            <select className="ms-input" value={studio.output.platform} onChange={(e) => pickPlatform(e.target.value)}>
              <option value="">(none — manual)</option>
              {PLATFORMS.map((pl) => (
                <option key={pl.id} value={pl.id}>{pl.name} ({pl.aspectRatio})</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Quality hint (label only — appears in export)</span>
            <div className="ms-toggle-row">
              {QUALITY_HINTS.map((q) => (
                <button key={q} className={studio.output.qualityHint === q ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setOutput({ qualityHint: q })}>{q}</button>
              ))}
            </div>
          </label>
        </div>
        <label className="field">
          <span className="field-label">Aspect ratio override (current: {effectiveAspectRatio(studio)})</span>
          <div className="ms-toggle-row">
            <button className={!studio.output.aspectRatio ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setOutput({ aspectRatio: '', platform: '' })} title="Use the selected format's default ratio">Format default</button>
            {ASPECT_OPTIONS.map((ar) => (
              <button key={ar} className={studio.output.aspectRatio === ar ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setOutput({ aspectRatio: ar })}>{ar}</button>
            ))}
          </div>
        </label>
      </div>

      <div className="ms-hook-library">
        <div className="row between">
          <span className="field-label">Hook Inspiration</span>
          <button className="ghost small" onClick={surpriseHook} title="Pick a random hook from filtered results and apply it">🎲 Surprise me</button>
        </div>
        <HookSearchBar
          language={b.language}
          onChangeLanguage={(l) => setBrief('language', l)}
          onFilter={(fn) => setHookFilter(() => fn)}
        />
        {filteredHooks.length === 0 ? (
          <div className="ms-hook-no-results hint small">
            No hooks match. <button className="ms-linklike" onClick={() => setHookFilter(null)}>Clear search</button>
          </div>
        ) : (
          <div className="ms-hook-cards">
            {filteredHooks.map((h) => (
              <button
                key={h.id}
                className={hookApplied === h.id ? 'ms-hook-chip ms-hook-card applied' : 'ms-hook-chip ms-hook-card'}
                title={h.text}
                onClick={() => applyHook(h)}
              >
                <span className="ms-hook-card-name">{hookApplied === h.id ? '✓ ' : ''}{h.name}</span>
                <span className="ms-hook-card-text">“{h.text}”</span>
              </button>
            ))}
          </div>
        )}
        <p className="hint small">Click an opener to drop it into the hook field above — then finish the line for your product.</p>
      </div>

      <div className="ms-paste-box">
        <span className="field-label">Paste Competitor Analysis (optional — output from a /watch breakdown)</span>
        <textarea className="ms-input" rows={5} value={pasted} placeholder={'Paste a competitor breakdown here. Labeled lines are recognized, e.g.\nProduct: …\nHook: …\nProblem: …\nCTA: …'} onChange={(e) => setPasted(e.target.value)} />
        {pasted.trim() ? (
          <div className="row">
            <button className="ghost small" onClick={extract}>Extract Brief</button>
            {filledKeys.length ? <span className="hint small ms-extract-note">{filledKeys.length} field(s) auto-filled (green border)</span> : null}
          </div>
        ) : null}
      </div>

      <div className="ms-save-product-row">
        <button className="ghost small" disabled={!p.name.trim()} onClick={saveToLibrary} title={p.name.trim() ? 'Save current product brief to your library for reuse' : 'Enter a product name first'}>
          💾 Save to My Products
        </button>
        {savedFlash ? <span className="ms-extract-note hint small">Saved ✓</span> : null}
      </div>

      <div className="ms-nav-row">
        <span />
        <button className="primary" disabled={!ready} title={ready ? '' : 'Product name + description required'} onClick={onNext}>
          Next: Choose Format →
        </button>
      </div>
    </div>
  )
}

// ---- Format card with examples ----
function FormatCard({ f, selected, onSelect }) {
  const [showAllExamples, setShowAllExamples] = useState(false)
  const examples = Array.isArray(f.examples) ? f.examples : []
  return (
    <div className={`ms-format-card ms-cat-${(f.category || 'UGC').toLowerCase()}${selected ? ' selected' : ''}`}>
      <div className="ms-format-head">
        <span className="ms-format-icon">{f.icon}</span>
        <div className="ms-format-titleblock">
          <h4>{f.name}</h4>
          <p className="ms-format-desc">{f.description}</p>
        </div>
      </div>
      <div className="ms-badge-row">
        <span className="ms-badge">{f.clipRange} clips</span>
        <span className="ms-badge">{f.aspectRatio}</span>
        <span className="ms-badge ms-badge-style">{f.style}</span>
      </div>
      {f.note ? <div className="ms-format-note">⚠ {f.note}</div> : null}
      {examples.length > 0 && (
        <div className="ms-format-examples">
          <p className="ms-format-example-line">{examples[0]}</p>
          {showAllExamples && examples.slice(1).map((ex, i) => (
            <p key={i} className="ms-format-example-line">{ex}</p>
          ))}
          {examples.length > 1 && (
            <button className="ms-linklike ms-examples-toggle" onClick={() => setShowAllExamples((v) => !v)}>
              {showAllExamples ? 'Show less' : `See more (${examples.length - 1} more)`}
            </button>
          )}
        </div>
      )}
      <button className={selected ? 'ghost small' : 'primary small'} disabled={selected} onClick={onSelect}>
        {selected ? 'Selected ✓' : 'Select'}
      </button>
    </div>
  )
}

// ---- Step 2: Format selector ----
function FormatStep({ studio, onUpdate, onBack, onNext }) {
  const [categoryFilter, setCategoryFilter] = useState('All')
  const selected = formatById(studio.format)
  const select = (id) =>
    onUpdate((s) => {
      // Best-match characters apply on format selection (FIX 2) unless the
      // user picked characters manually; manual picks survive same-kind swaps.
      const sameKind = isTwoCharacterFormat(s.format) === isTwoCharacterFormat(id)
      const keepManual = s.charactersManual && sameKind && s.characters.length > 0
      return { ...s, format: id, characters: keepManual ? s.characters : getDefaultCharactersForFormat(id), charactersManual: keepManual ? s.charactersManual : false, scenes: [], prompts: [] }
    })

  const visibleCategories = FORMAT_CATEGORIES.filter((cat) => (categoryFilter === 'All' || categoryFilter === cat) && FORMATS.some((f) => f.category === cat))

  return (
    <div className="ms-stepbody">
      <h3>Step 2 — Choose Format</h3>
      {selected ? (
        <p className="hint small">
          Selected: <b>{selected.icon} {selected.name}</b> — <button className="ms-linklike" onClick={() => onUpdate((s) => ({ ...s, format: null, characters: [], scenes: [], prompts: [] }))}>Change</button>
        </p>
      ) : (
        <p className="hint small">Pick the ad format. It decides the clip count, aspect ratio, and which prompt rules apply.</p>
      )}

      <div className="ms-cat-filter">
        {['All', ...FORMAT_CATEGORIES].map((cat) => (
          <button key={cat} className={categoryFilter === cat ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setCategoryFilter(cat)}>
            {cat}
          </button>
        ))}
      </div>

      {visibleCategories.map((cat) => (
        <div key={cat} className="ms-format-group">
          <h4 className="ms-format-cat-label">{cat}</h4>
          <div className="ms-format-grid">
            {FORMATS.filter((f) => f.category === cat).map((f) => (
              <FormatCard key={f.id} f={f} selected={studio.format === f.id} onSelect={() => select(f.id)} />
            ))}
          </div>
        </div>
      ))}

      <div className="ms-nav-row">
        <button className="ghost" onClick={onBack}>← Back</button>
        <button className="primary" disabled={!selected} onClick={onNext}>Next: Choose Characters →</button>
      </div>
    </div>
  )
}

// ---- Step 3: Character selector ----
function CharacterPicker({ title, value, briefLanguage, onPick, selectedFormat }) {
  const [customChars, setCustomChars] = useState(() => loadCustomCharacters())
  const [addingCustom, setAddingCustom] = useState(false)
  const [customDraft, setCustomDraft] = useState({ name: '', language: 'fr', personality: '', exampleLine: '' })
  const isCustomId = String(value || '').startsWith(CUSTOM_CHARACTER_PREFIX)

  function saveNewCustomChar() {
    if (!customDraft.name.trim()) return
    const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const entry = { id, ...customDraft }
    const next = [...customChars, entry]
    setCustomChars(next)
    saveCustomCharacters(next)
    onPick(id)
    setAddingCustom(false)
    setCustomDraft({ name: '', language: 'fr', personality: '', exampleLine: '' })
  }

  function deleteCustomChar(id) {
    const next = customChars.filter((c) => c.id !== id)
    setCustomChars(next)
    saveCustomCharacters(next)
    if (value === id) onPick('')
  }

  const allChars = [...CHARACTERS, ...customChars.map((c) => ({
    ...c,
    description: c.personality || '',
    gender: '',
    style: c.personality || 'custom',
    tags: ['custom'],
    avatar: '🎭',
    bestFormats: [],
    exampleLine: c.exampleLine || ''
  }))]

  return (
    <div className="ms-char-picker">
      <h4>{title}</h4>
      <div className="ms-char-grid">
        {allChars.map((c) => {
          const sel = value === c.id
          const mismatch = c.language && briefLanguage && c.language !== briefLanguage
          const isFormatMatch = selectedFormat && Array.isArray(c.bestFormats) && c.bestFormats.includes(selectedFormat)
          const isCustomEntry = !CHARACTERS.find((x) => x.id === c.id)
          return (
            <button key={c.id}
              className={`ms-char-card${sel ? ' selected' : ''}${isFormatMatch ? ' format-match' : ''}`}
              style={mismatch ? { opacity: 0.65 } : {}}
              onClick={() => onPick(c.id)}
            >
              {c.avatar ? <span className="ms-char-avatar">{c.avatar}</span> : null}
              <div className="ms-char-name">{c.name}</div>
              <div className="ms-badge-row">
                {c.gender ? <span className="ms-badge">{c.gender}</span> : null}
                <span className={mismatch ? 'ms-badge ms-badge-warn' : 'ms-badge'} title={mismatch ? `Brief language is ${briefLanguage.toUpperCase()} but this character speaks ${c.language.toUpperCase()}` : ''}>
                  {c.language ? c.language.toUpperCase() : 'custom'}{mismatch ? ' ⚠' : ''}
                </span>
              </div>
              {c.personality ? <div className="ms-char-personality">{c.personality}</div> : null}
              {c.exampleLine ? <div className="ms-char-example">"{c.exampleLine}"</div> : null}
              {Array.isArray(c.bestFormats) && c.bestFormats.length > 0 ? (
                <div className="ms-char-best">
                  {c.bestFormats.map((fid) => {
                    const fmt = FORMATS.find((f) => f.id === fid)
                    return fmt ? <span key={fid} className="ms-char-best-badge">{fmt.icon} {fmt.name.replace(/^UGC\s+/, '').replace(/\s*\(.*\)$/, '')}</span> : null
                  })}
                </div>
              ) : null}
              {isFormatMatch ? <div className="ms-char-format-match">✓ Great for this format</div> : null}
              {mismatch ? <div className="ms-char-lang-mismatch">⚠ Language mismatch</div> : null}
              {isCustomEntry ? (
                <button className="ghost small danger" style={{ marginTop: '4px', fontSize: '11px' }}
                  onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete custom character "${c.name}"?`)) deleteCustomChar(c.id) }}>
                  Delete
                </button>
              ) : null}
            </button>
          )
        })}

        <div className={`ms-char-card ms-char-custom${addingCustom ? ' selected' : ''}`}>
          <div className="ms-char-avatar">🎭</div>
          <div className="ms-char-name">Custom Character</div>
          {!addingCustom ? (
            <button className="ghost small" onClick={() => setAddingCustom(true)}>+ Add Custom</button>
          ) : (
            <div className="ms-char-custom-form">
              <input className="ms-input" placeholder="Name *" value={customDraft.name} onChange={(e) => setCustomDraft((d) => ({ ...d, name: e.target.value }))} />
              <div className="ms-toggle-row">
                <button className={customDraft.language === 'fr' ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setCustomDraft((d) => ({ ...d, language: 'fr' }))}>🇫🇷 FR</button>
                <button className={customDraft.language === 'en' ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setCustomDraft((d) => ({ ...d, language: 'en' }))}>🇬🇧 EN</button>
              </div>
              <input className="ms-input" placeholder="Personality (e.g. warm, relatable)" value={customDraft.personality} onChange={(e) => setCustomDraft((d) => ({ ...d, personality: e.target.value }))} />
              <input className="ms-input" placeholder="Example line (optional)" value={customDraft.exampleLine} onChange={(e) => setCustomDraft((d) => ({ ...d, exampleLine: e.target.value }))} />
              <div className="row" style={{ gap: '6px' }}>
                <button className="primary small" disabled={!customDraft.name.trim()} onClick={saveNewCustomChar}>Save & Select</button>
                <button className="ghost small" onClick={() => setAddingCustom(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CharactersStep({ studio, onUpdate, onBack, onNext }) {
  const format = formatById(studio.format)
  const two = isTwoCharacterFormat(studio.format)
  const lang = studioLanguage(studio)
  const setCharacter = (index, id) =>
    onUpdate((s) => {
      const chars = [...s.characters]
      chars[index] = id
      return { ...s, characters: chars.slice(0, two ? 2 : 1).map((x) => x || ''), charactersManual: true, scenes: [], prompts: [] }
    })

  const ready = two ? !!(studio.characters[0] && studio.characters[1]) : !!studio.characters[0]

  return (
    <div className="ms-stepbody">
      <h3>Step 3 — Choose Characters</h3>
      <p className="hint small">
        {format ? `${format.name} needs ${two ? 'two characters (Host and Guest)' : 'one character'}.` : ''} The character carries identity — prompts never describe appearance; your attached frame does.
      </p>

      {two ? (
        <div className="ms-char-pair">
          <CharacterPicker title="Host (intro, reactions, endorsement, CTA)" value={studio.characters[0] || ''} briefLanguage={lang} onPick={(id) => setCharacter(0, id)} selectedFormat={studio.format} />
          <CharacterPicker title="Guest (hook, story, results)" value={studio.characters[1] || ''} briefLanguage={lang} onPick={(id) => setCharacter(1, id)} selectedFormat={studio.format} />
        </div>
      ) : (
        <CharacterPicker title="Character" value={studio.characters[0] || ''} briefLanguage={lang} onPick={(id) => setCharacter(0, id)} selectedFormat={studio.format} />
      )}

      {(() => {
        const picked = (two ? studio.characters.slice(0, 2) : studio.characters.slice(0, 1)).map((id) => characterById(id)).filter(Boolean)
        if (!picked.length) return null
        return (
          <div className="ms-voice-preview">
            {picked.map((c) => (
              <div key={c.id} className="ms-voice-card">
                <span className="ms-voice-avatar">{c.avatar || '🎭'}</span>
                <div>
                  <div className="ms-voice-label">This is how <b>{c.name}</b> sounds:</div>
                  <div className="ms-char-example">“{c.exampleLine || c.description}”</div>
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      <div className="ms-nav-row">
        <button className="ghost" onClick={onBack}>← Back</button>
        <button className="primary" disabled={!ready} onClick={onNext}>Next: Review Script →</button>
      </div>
    </div>
  )
}

// ---- Browse All Settings modal (Tier 2) ----
function BrowseSettingsModal({ onClose, onSelect, focusedSceneNum }) {
  const [query, setQuery] = useState('')
  const filtered = SETTINGS_LIBRARY.filter((st) => {
    const q = searchNorm(query.trim())
    return !q || searchNorm(st.name).includes(q) || searchNorm(st.description).includes(q) || (Array.isArray(st.tags) && st.tags.some((t) => searchNorm(t).includes(q)))
  })
  return (
    <div className="ms-browse-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ms-browse-modal">
        <div className="row between">
          <h3>Browse All Settings</h3>
          <button className="ghost small" onClick={onClose}>✕ Close</button>
        </div>
        {focusedSceneNum ? <p className="hint small">Clicking a setting will apply it to Scene {focusedSceneNum}.</p> : <p className="hint small ms-badge ms-badge-warn" style={{ display: 'inline-block' }}>Select a scene first</p>}
        <input className="ms-input" placeholder="🔍 Search settings…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="ms-settings-grid">
          {filtered.map((st) => (
            <div key={st.id} className="ms-setting-browse-card" onClick={() => { if (focusedSceneNum) { onSelect(st.id); onClose() } }}>
              <h5>{st.name}</h5>
              <p className="hint">{st.description}</p>
              <p className="hint" style={{ fontStyle: 'italic' }}>{st.lightingNote}</p>
              <div className="ms-setting-tags">
                {(st.tags || []).map((t) => <span key={t} className="ms-setting-tag">{t}</span>)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- Step 4: Script & scene review ----
function SceneCard({ scene, onPatch, onRegenerate, onFocus, isFocused }) {
  const [settingSearch, setSettingSearch] = useState('')
  const ch = characterById(scene.character)

  const filteredSettings = SETTINGS_LIBRARY.filter((st) => {
    const q = searchNorm(settingSearch.trim())
    return !q || searchNorm(st.name).includes(q) || searchNorm(st.description).includes(q)
  })

  const [detailsOpen, setDetailsOpen] = useState(false)
  const st = settingById(scene.settingId)

  return (
    <div className={`ms-scene-card${isFocused ? ' ms-scene-focused' : ''}`} onClick={onFocus}>
      <div className="ms-scene-numblock" aria-hidden="true">{scene.sceneNumber}</div>
      <div className="ms-scene-body">
        <div className="ms-scene-head">
          <span className="ms-scene-num">Scene {scene.sceneNumber}</span>
          <span className="ms-badge ms-badge-style">{purposeLabel(scene.purpose)}</span>
          <span className="ms-badge">{scene.emotionalBeat}</span>
          <span className="ms-scene-spacer" />
          <div className="ms-toggle-row ms-duration-pills" title="Clip duration">
            {CLIP_DURATIONS.map((d) => (
              <button key={d} className={scene.clipDuration === d ? 'ms-toggle ms-pill active' : 'ms-toggle ms-pill'} onClick={(e) => { e.stopPropagation(); onPatch({ clipDuration: d, duration: d }) }}>{d}s</button>
            ))}
          </div>
          <button className="ghost small" onClick={(e) => { e.stopPropagation(); onRegenerate() }} title="Re-derive this scene from the brief (discards edits to this scene)">↺ Regenerate</button>
        </div>

        <textarea
          className="ms-input ms-dialogue-hero"
          rows={2}
          value={scene.dialogueLine}
          placeholder="(no dialogue — visual clip)"
          onChange={(e) => onPatch({ dialogueLine: e.target.value })}
          onClick={(e) => e.stopPropagation()}
        />
        <div className="ms-scene-meta">
          <span>{ch ? `🗣 ${ch.name}` : scene.character ? `🗣 ${scene.character}` : '🎞 voiceover / visual'}</span>
          <span className="ms-scene-shot">{scene.shotType}</span>
          {st ? (
            <span className="ms-setting-tag" title={`${st.description} — ${st.lightingNote}`}>📍 {st.name} · {st.visualMood}</span>
          ) : null}
          <span className="ms-scene-spacer" />
          <button className="ms-linklike ms-details-toggle" onClick={(e) => { e.stopPropagation(); setDetailsOpen((v) => !v) }}>
            {detailsOpen ? '▾ Hide visual & setting' : '▸ Visual & setting'}
          </button>
        </div>

        {detailsOpen ? (
          <div className="ms-scene-details">
            <label className="field">
              <span className="field-label">Visual description (what the camera shoots)</span>
              <textarea className="ms-input" rows={2} value={scene.visualDescription} onChange={(e) => onPatch({ visualDescription: e.target.value })} onClick={(e) => e.stopPropagation()} />
            </label>
            <div className="ms-setting-row">
              <label className="field ms-setting-field">
                <span className="field-label">Scene setting</span>
                <input
                  className="ms-input ms-setting-search"
                  placeholder="🔍 Filter settings…"
                  value={settingSearch}
                  onChange={(e) => setSettingSearch(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                />
                <select
                  className="ms-input"
                  value={scene.settingId || ''}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const id = e.target.value
                    onPatch({ settingId: id, visualDescription: applySettingToDescription(scene.visualDescription, id) })
                  }}
                >
                  <option value="">(none)</option>
                  {filteredSettings.map((s2) => (
                    <option key={s2.id} value={s2.id}>{s2.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function ScriptStep({ studio, onUpdate, onBack, onNext }) {
  const [bulkSetting, setBulkSetting] = useState('')
  const [focusedSceneIndex, setFocusedSceneIndex] = useState(null)
  const [browseSettingsOpen, setBrowseSettingsOpen] = useState(false)

  const focusedScene = focusedSceneIndex !== null ? studio.scenes[focusedSceneIndex] : null

  function applySettingToAll() {
    if (!bulkSetting) return
    const anySet = studio.scenes.some((sc) => sc.settingId)
    if (anySet && !window.confirm('Some scenes already have a setting. Replace the setting on ALL scenes?')) return
    onUpdate((s) => ({
      ...s,
      scenes: s.scenes.map((sc) => ({ ...sc, settingId: bulkSetting, visualDescription: applySettingToDescription(sc.visualDescription, bulkSetting) })),
      prompts: []
    }))
  }
  // Generate the outline on first arrival (or after a reset), with a short
  // beat so the work feels like intelligence, not a page load.
  const needsOutline = studio.scenes.length === 0
  useEffect(() => {
    if (!needsOutline) return
    const timer = setTimeout(() => {
      onUpdate((s) => {
        if (s.scenes.length) return s
        const scenes = generateSceneOutline(s)
        return scenes.length ? { ...s, scenes, status: 'brief_ready' } : s
      })
    }, 500)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsOutline])
  if (needsOutline) {
    return (
      <div className="ms-stepbody">
        <h3>Step 4 — Script & Scene Review</h3>
        <p className="hint small ms-generating-note"><span className="ms-spinner" /> Generating your scene outline…</p>
        <div className="ms-scene-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="ms-scene-skeleton ms-skeleton" style={{ animationDelay: `${i * 120}ms` }}>
              <div className="ms-scene-numblock">{i + 1}</div>
              <div className="ms-scene-body">
                <div className="ms-skeleton-line w40" />
                <div className="ms-skeleton-line w90" />
                <div className="ms-skeleton-line w60" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const patchScene = (i, patch) =>
    onUpdate((s) => ({ ...s, scenes: s.scenes.map((sc, idx) => (idx === i ? { ...sc, ...patch } : sc)), prompts: [] }))

  const regenAll = () => {
    if (studio.scenes.length && !window.confirm('Regenerate the whole outline? This discards your scene edits.')) return
    onUpdate((s) => ({ ...s, scenes: generateSceneOutline(s), prompts: [] }))
  }

  const regenOne = (i) =>
    onUpdate((s) => {
      const fresh = regenerateScene(s, s.scenes[i] && s.scenes[i].sceneNumber)
      if (!fresh) return s
      return { ...s, scenes: s.scenes.map((sc, idx) => (idx === i ? fresh : sc)), prompts: [] }
    })

  const fullScript = studio.scenes.map((sc) => {
    const ch = characterById(sc.character)
    return `${sc.sceneNumber}. ${ch ? ch.name : sc.character || 'VO'}: ${sc.dialogueLine}`
  }).join('\n')

  const total = studio.scenes.reduce((a, sc) => a + (Number(sc.clipDuration) || 0), 0)

  function generatePrompts() {
    onUpdate((s) => ({ ...s, prompts: generateOmniPrompts(s, s.scenes), status: 'complete' }))
    onNext()
  }

  return (
    <div className="ms-stepbody">
      <div className="row between">
        <h3>Step 4 — Script & Scene Review</h3>
        <button className="ghost small" onClick={regenAll}>Regenerate Outline</button>
      </div>
      <p className="hint small">
        {studio.scenes.length} scenes · estimated {total}s (target {studio.brief.duration}s). Edit any line — prompts are generated from what you approve here.
      </p>
      {total > studio.brief.duration * 1.1 ? (
        <div className="ms-overshoot-warning">
          ⚠ The outline runs {total}s — {total - studio.brief.duration}s over your {studio.brief.duration}s target. Trim dialogue lines or drop a scene to fit.
        </div>
      ) : null}

      <div className="ms-bulk-setting row">
        <span className="field-label">Apply setting to all scenes:</span>
        <select className="ms-input ms-bulk-select" value={bulkSetting} onChange={(e) => setBulkSetting(e.target.value)}>
          <option value="">(choose a setting)</option>
          {SETTINGS_LIBRARY.map((st) => (
            <option key={st.id} value={st.id}>{st.name}</option>
          ))}
        </select>
        <button className="ghost small" disabled={!bulkSetting} onClick={applySettingToAll}>Apply to all</button>
        <button className="ghost small ms-browse-settings-btn" onClick={() => setBrowseSettingsOpen(true)}>🗂 Browse All Settings</button>
      </div>

      {browseSettingsOpen && (
        <BrowseSettingsModal
          onClose={() => setBrowseSettingsOpen(false)}
          focusedSceneNum={focusedScene ? focusedScene.sceneNumber : null}
          onSelect={(settingId) => {
            if (focusedSceneIndex === null) return
            patchScene(focusedSceneIndex, { settingId, visualDescription: applySettingToDescription(studio.scenes[focusedSceneIndex].visualDescription, settingId) })
          }}
        />
      )}

      <div className="ms-scene-list">
        {studio.scenes.map((sc, i) => (
          <SceneCard
            key={sc.sceneNumber}
            scene={sc}
            onPatch={(patch) => patchScene(i, patch)}
            onRegenerate={() => regenOne(i)}
            onFocus={() => setFocusedSceneIndex(i)}
            isFocused={focusedSceneIndex === i}
          />
        ))}
      </div>

      <div className="ms-script-view">
        <div className="row between">
          <h4>Full Script</h4>
          <CopyButton text={fullScript} label="Copy Script" />
        </div>
        <pre className="ms-script-pre">{fullScript || '(no dialogue)'}</pre>
      </div>

      <button className="primary ms-generate-btn" disabled={!studio.scenes.length} onClick={generatePrompts}>
        ✦ Generate Prompts
      </button>
      <div className="ms-nav-row">
        <button className="ghost" onClick={onBack}>← Back</button>
        <span />
      </div>
    </div>
  )
}

// ---- Step 5: Prompts & export ----
function PromptCard({ prompt }) {
  const isOmni = prompt.model.indexOf('Omni') !== -1
  return (
    <div className="ms-prompt-card">
      <div className="ms-prompt-meta">
        <span className="ms-scene-num">Clip {prompt.sceneNumber}</span>
        <span className="ms-badge">{prompt.duration}s</span>
        <span className={isOmni ? 'ms-badge ms-badge-omni' : 'ms-badge ms-badge-seedance'}>{isOmni ? 'Omni Flash' : 'Seedance 2.0'}</span>
        <span className="ms-scene-spacer" />
        <CopyButton text={`${prompt.setupHeader}\n${prompt.promptText}`} />
      </div>
      <div className="ms-setup-header">{prompt.setupHeader}</div>
      <div className="ms-prompt-text">{prompt.promptText}</div>
      {prompt.notes ? <div className="hint small ms-prompt-notes">{prompt.notes}</div> : null}
    </div>
  )
}

function ExportStep({ studio, onUpdate, onBack, onSendToNodeCanvas, onSaveSession, onClearSession }) {
  const [sentNote, setSentNote] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const prompts = studio.prompts
  const lang = studioLanguage(studio)
  const models = modelsNeeded(prompts)
  const total = totalPromptDuration(prompts)

  const markdown = useMemo(() => buildStudioMarkdown(studio, studio.scenes, prompts), [studio, prompts])

  function exportMarkdown() {
    downloadMarkdown(markdown, `${slugify(studio.product.name)}-marketing-studio.md`)
  }

  function sendToCanvas() {
    const n = onSendToNodeCanvas(prompts, studio)
    setSentNote(n > 0 ? `Sent ${n} scene rows to Node Canvas ✓` : 'Nothing to send.')
    setTimeout(() => setSentNote(''), 4000)
  }

  function saveSession() {
    onSaveSession()
    setSavedNote('Session saved ✓')
    setTimeout(() => setSavedNote(''), 2000)
  }

  return (
    <div className="ms-stepbody">
      <h3>Step 5 — Prompts & Export</h3>

      <div className="ms-summary-bar">
        <span><b>Total clips:</b> {prompts.length}</span>
        <span><b>Total estimated duration:</b> {total}s (target {studio.brief.duration}s)</span>
        <span><b>Models needed:</b> {models.length ? models.join(', ') : '—'}</span>
        <span><b>Language:</b> {lang.toUpperCase()}</span>
        <span><b>Aspect:</b> {effectiveAspectRatio(studio)}{studio.output.aspectRatio ? ' (override)' : ''}</span>
        <span><b>Quality:</b> {studio.output.qualityHint}</span>
        {studio.output.platform ? <span className="ms-badge ms-badge-style">{(platformById(studio.output.platform) || {}).name}</span> : null}
      </div>

      {total > studio.brief.duration * 1.1 ? (
        <div className="ms-overshoot-warning">
          ⚠ Total clip time is {total}s — {total - studio.brief.duration}s over the {studio.brief.duration}s target. The edit will need cuts.
        </div>
      ) : null}

      <div className="row ms-export-row">
        <CopyAllButton prompts={prompts} />
        <button className="ghost" onClick={exportMarkdown}>Export as Markdown</button>
        <button className="ghost" onClick={sendToCanvas} disabled={!prompts.length || !onSendToNodeCanvas}>Send to Node Canvas</button>
        {sentNote ? <span className="hint small ms-extract-note">{sentNote}</span> : null}
      </div>

      <div className="ms-prompt-list">
        {prompts.map((p, i) => (
          <div key={p.sceneNumber} className="ms-prompt-enter" style={{ animationDelay: `${i * 50}ms` }}>
            <PromptCard prompt={p} />
          </div>
        ))}
        {!prompts.length ? <p className="hint">No prompts yet — go back to Step 4 and click "Generate Prompts".</p> : null}
      </div>

      <div className="ms-session-row">
        <button className="ghost small" onClick={saveSession}>Save Studio Session</button>
        <button className="ghost small danger" onClick={onClearSession}>Clear Session</button>
        {savedNote ? <span className="hint small ms-extract-note">{savedNote}</span> : null}
      </div>

      <div className="ms-nav-row">
        <button className="ghost" onClick={onBack}>← Back</button>
        <span />
      </div>
    </div>
  )
}

// ---- Import from Markdown modal ----
function ImportMarkdownModal({ onClose, onImport }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState(null)

  function doImport() {
    const r = parseMarkdownPackage(text)
    setResult(r)
    if (r.studio && r.studio.product && r.studio.product.name) {
      onImport(r)
    }
  }

  return (
    <div className="ms-import-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ms-import-modal">
        <h3>📥 Import from Markdown Package</h3>
        <p className="hint small">Paste a previously exported Marketing Studio Markdown package. Scenes, prompts, format, and product brief will be restored.</p>
        <textarea
          className="ms-input"
          rows={12}
          value={text}
          placeholder="Paste your exported Markdown package here…"
          onChange={(e) => { setText(e.target.value); setResult(null) }}
        />
        {result && (
          <div className={`ms-import-result ${result.ok ? 'ok' : 'warn'}`}>
            {result.ok ? `Imported ${result.studio.scenes.length} scenes, ${result.studio.prompts.length} prompts ✓` : 'Partial import:'}
            {result.errors.length > 0 && (
              <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="row" style={{ gap: '8px' }}>
          <button className="primary" disabled={!text.trim()} onClick={doImport}>Import</button>
          <button className="ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

// ---- Session home (no active session) ----
function SessionName({ session, onRename }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.name)
  if (!editing) {
    return (
      <button className="ms-session-name" title="Click to rename" onClick={() => { setDraft(session.name); setEditing(true) }}>
        {session.name}
      </button>
    )
  }
  const commit = () => {
    onRename(session.id, draft)
    setEditing(false)
  }
  return (
    <input
      className="ms-input ms-session-name-input"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setEditing(false)
      }}
    />
  )
}

function SessionHome({ sessions, onCreateSession, onQuickGenerate, onOpenSession, onDeleteSession, onRenameSession, onImportMarkdown }) {
  const [importOpen, setImportOpen] = useState(false)
  const [quickText, setQuickText] = useState('')
  const [quickLanguage, setQuickLanguage] = useState('fr')
  const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)
  const wordCount = quickText.trim().split(/\s+/).filter(Boolean).length
  const examples = [
    ['Podcast FR · Calme', 'fr', 'Podcast français 30s pour Calme, boisson anti-stress, cible femmes 25-45, ingrédient ashwagandha KSM-66, ton authentique'],
    ['UGC EN · Skincare', 'en', 'English UGC 30s for GlowSerum, skincare serum, target women 20-35, ingredient hyaluronic acid, tone casual'],
    ['Testimonial FR · Slim', 'fr', 'Témoignage français 45s pour SlimBoost, complément minceur, cible femmes 30-50, ingrédient CLA chrome, ton honnête']
  ]
  return (
    <section className="panel ms-panel">
      <div className="ms-hero">
        <span className="ms-hero-eyebrow">Marketing Studio</span>
        <h2 className="ms-hero-title">Turn one brief<br />into a complete ad package</h2>
        <p className="ms-hero-sub">Scene-by-scene scripts and paste-ready prompts — UGC, podcast, or cinematic. 100% local, no credits.</p>
      </div>

      <div className="ms-quick-card">
        <h3>⚡ Quick Mode</h3>
        <textarea className="ms-input" rows={3} value={quickText} placeholder="Ex: Podcast français 30s pour Calme..." onChange={(e) => setQuickText(e.target.value)} />
        <div className="ms-quick-chips">
          {examples.map(([label, lang, value]) => (
            <button key={label} className="ghost small" onClick={() => { setQuickText(value); setQuickLanguage(lang) }}>{label}</button>
          ))}
        </div>
        {quickText.trim() && wordCount < 5 ? <p className="ms-quick-warning">Add more detail...</p> : null}
        <div className="row between">
          <div className="ms-toggle-row">
            <span className="field-label">Language:</span>
            <button className={quickLanguage === 'fr' ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setQuickLanguage('fr')}>🇫🇷 FR</button>
            <button className={quickLanguage === 'en' ? 'ms-toggle active' : 'ms-toggle'} onClick={() => setQuickLanguage('en')}>🇬🇧 EN</button>
          </div>
          <button className="primary" disabled={!quickText.trim()} onClick={() => onQuickGenerate(quickText, quickLanguage)}>→ Generate</button>
        </div>
      </div>

      <div className="row between ms-home-head">
        <p className="hint small">Each session is one ad package: brief, format, characters, scenes, prompts. Sessions save automatically on this machine.</p>
        <div className="row" style={{ gap: '8px' }}>
          <button className="ghost" onClick={() => setImportOpen(true)}>📥 Import from Markdown</button>
          <button className="primary" onClick={onCreateSession}>+ New Studio Session</button>
        </div>
      </div>

      {importOpen && (
        <ImportMarkdownModal
          onClose={() => setImportOpen(false)}
          onImport={(r) => {
            onImportMarkdown(r.studio, r.studio.product.name ? `${r.studio.product.name} · Imported` : 'Imported Session')
            setImportOpen(false)
          }}
        />
      )}

      {sorted.length === 0 ? (
        <div className="ms-empty-state">
          <p>No sessions yet. Start your first ad.</p>
          <button className="primary" onClick={onCreateSession}>Start your first ad →</button>
        </div>
      ) : (
        <div className="ms-session-list">
          {sorted.map((sess) => {
            const f = formatById(sess.studio.format)
            return (
              <div key={sess.id} className="ms-session-row-item">
                <div className="ms-session-info">
                  <SessionName session={sess} onRename={onRenameSession} />
                  <div className="ms-badge-row">
                    {f ? <span className="ms-badge ms-badge-style">{f.icon} {f.name}</span> : <span className="ms-badge">no format yet</span>}
                    <span className="ms-badge">{sess.studio.scenes.length ? `${sess.studio.scenes.length} scenes` : 'draft'}</span>
                    <span className="ms-badge" title={new Date(sess.createdAt).toLocaleString()}>created {new Date(sess.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="row">
                  <button className="primary small" onClick={() => onOpenSession(sess.id)}>Open</button>
                  <button
                    className="ghost small danger"
                    onClick={() => {
                      if (window.confirm(`Delete session "${sess.name}"? This cannot be undone.`)) onDeleteSession(sess.id)
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ---- Wizard shell ----
export default function MarketingStudio({ sessions, activeSessionId, studio, onUpdate, onCreateSession, onQuickGenerate, wizardStep, onWizardStepChange, onOpenSession, onCloseSession, onDeleteSession, onRenameSession, onSendToNodeCanvas, onSaveSession, onClearSession, productLibrary, onUpdateProductLibrary, onSaveProductToLibrary, onDeleteProductFromLibrary, onImportSession }) {
  const step = wizardStep
  const [wizardImportOpen, setWizardImportOpen] = useState(false)
  const [stepDirection, setStepDirection] = useState('forward')
  // Reset the wizard to Brief whenever a different session opens.
  useEffect(() => {
    if (!activeSessionId) onWizardStepChange(0)
  }, [activeSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null
  if (!activeSession) {
    return (
      <SessionHome
        sessions={sessions}
        onCreateSession={onCreateSession}
        onQuickGenerate={onQuickGenerate}
        onOpenSession={onOpenSession}
        onDeleteSession={onDeleteSession}
        onRenameSession={onRenameSession}
        onImportMarkdown={(studioData, name) => onImportSession && onImportSession(studioData, name)}
      />
    )
  }

  // The furthest step the current state allows jumping to.
  const briefReady = studio.product.name.trim() && studio.product.description.trim()
  const formatReady = briefReady && !!formatById(studio.format)
  const charsReady = formatReady && (isTwoCharacterFormat(studio.format) ? !!(studio.characters[0] && studio.characters[1]) : !!studio.characters[0])
  const scenesReady = charsReady && studio.scenes.length > 0
  const maxReached = !briefReady ? 0 : !formatReady ? 1 : !charsReady ? 2 : !scenesReady ? 3 : 4

  const go = (i) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i))
    setStepDirection(next > step ? 'forward' : 'back')
    onWizardStepChange(next)
  }

  function clearSession() {
    if (!window.confirm('Clear the Marketing Studio session? This resets the brief, format, characters, scenes, and prompts.')) return
    onClearSession()
    onWizardStepChange(0)
  }

  const productTitle = studio.product.name.trim()
  const fmt = formatById(studio.format)

  return (
    <section className="panel ms-panel">
      <div className="ms-hero ms-hero-compact">
        <span className="ms-hero-eyebrow">Marketing Studio</span>
        <h2 className="ms-hero-title">{productTitle || 'New ad package'}</h2>
        {fmt ? <p className="ms-hero-sub">{fmt.icon} {fmt.name} · {effectiveAspectRatio(studio)} · {studioLanguage(studio).toUpperCase()}</p> : <p className="ms-hero-sub">Name the product, pick a format, approve the script — the prompts write themselves.</p>}
      </div>

      <div className="row ms-session-bar">
        <button className="ms-linklike" onClick={onCloseSession}>← All Sessions</button>
        <SessionName session={activeSession} onRename={onRenameSession} />
        <span style={{ flex: 1 }} />
        <button className="ghost small" onClick={() => setWizardImportOpen(true)}>📥 Import</button>
      </div>

      {wizardImportOpen && (
        <ImportMarkdownModal
          onClose={() => setWizardImportOpen(false)}
          onImport={(r) => {
            // Merge into current session: overwrite scenes + prompts, keep format/characters if not in imported
            onUpdate((s) => {
              const imported = normalizeStudio(r.studio)
              return {
                ...s,
                scenes: imported.scenes.length ? imported.scenes : s.scenes,
                prompts: imported.prompts.length ? imported.prompts : s.prompts,
                format: imported.format || s.format,
                product: imported.product.name ? imported.product : s.product,
                brief: imported.brief.language ? imported.brief : s.brief
              }
            })
            setWizardImportOpen(false)
          }}
        />
      )}

      <StepIndicator step={step} maxReached={maxReached} onJump={go} />
      {step === 3 && studio.status === 'brief_ready' ? (
        <div className="ms-quick-banner">⚡ Quick Mode <button className="ms-linklike" onClick={() => go(0)}>← Edit brief</button></div>
      ) : null}

      <div key={step} className={stepDirection === 'forward' ? 'ms-step-pane ms-slide-forward' : 'ms-step-pane'}>
        {step === 0 ? <BriefStep studio={studio} onUpdate={onUpdate} onNext={() => go(1)} productLibrary={productLibrary} onSaveProductToLibrary={onSaveProductToLibrary} onDeleteProductFromLibrary={onDeleteProductFromLibrary} /> : null}
        {step === 1 ? <FormatStep studio={studio} onUpdate={onUpdate} onBack={() => go(0)} onNext={() => go(2)} /> : null}
        {step === 2 ? <CharactersStep studio={studio} onUpdate={onUpdate} onBack={() => go(1)} onNext={() => go(3)} /> : null}
        {step === 3 ? <ScriptStep studio={studio} onUpdate={onUpdate} onBack={() => go(2)} onNext={() => go(4)} /> : null}
        {step === 4 ? (
          <ExportStep
            studio={studio}
            onUpdate={onUpdate}
            onBack={() => go(3)}
            onSendToNodeCanvas={onSendToNodeCanvas}
            onSaveSession={onSaveSession}
            onClearSession={clearSession}
          />
        ) : null}
      </div>
    </section>
  )
}
