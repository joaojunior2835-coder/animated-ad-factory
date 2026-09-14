import { useRef, useState } from 'react'
import { PRIMARY_WORKSPACES, SUPPORTING_WORKSPACES, workspaceLabel } from '../lib/workspaceNavigation.js'
import './WorkspaceShell.css'

function NavigationItem({ item, active, busy, hasContent, onNavigate }) {
  return <button
    type="button"
    className={`nav workspace-nav-item${active === item.key ? ' active' : ''}`}
    aria-current={active === item.key ? 'page' : undefined}
    data-workspace={item.key}
    disabled={busy}
    onClick={() => onNavigate(item.key)}
  >
    <span className="nav-text">{item.label}</span>
    {hasContent?.(item) ? <span className="dot" title="Has saved content" /> : null}
  </button>
}

/**
 * App retains all routing, context, and persistence. `onNavigate` may return a
 * promise so draft saves can finish before switching the current workspace.
 * Pass existing project tools as `aside` only on their legacy workspaces.
 */
export default function WorkspaceShell({
  active, onNavigate, children, status, context, actions, aside,
  primaryItems = PRIMARY_WORKSPACES, supportingItems = SUPPORTING_WORKSPACES,
  hasContent, className = '', mainClassName = '',
}) {
  const [navigating, setNavigating] = useState(false)
  const [navigationError, setNavigationError] = useState('')
  const navigationLock = useRef(false)

  const navigate = async key => {
    if (key === active || navigationLock.current) return
    navigationLock.current = true
    setNavigating(true)
    setNavigationError('')
    try { await onNavigate(key) }
    catch (error) { setNavigationError(error?.message || 'Could not switch workspaces. Your current work is still open.') }
    finally { navigationLock.current = false; setNavigating(false) }
  }

  return <div className={`app workstation-shell ${className}`} data-workspace={active}>
    <a className="workspace-skip-link" href="#workspace-main">Skip to workspace</a>
    <header className="topbar workspace-topbar">
      <div className="workspace-identity">
        <svg className="workspace-mark" viewBox="0 0 28 28" aria-hidden="true"><path d="M5 23 12 5h5l6 18h-5l-1-4h-7l-1 4Zm7-8h4l-2-6Z" fill="currentColor" /></svg>
        <div><h1>Animated Ad Factory</h1><span className="workspace-local-label">Local creative workstation</span></div>
      </div>
      {context ? <div className="workspace-context">{context}</div> : null}
      <div className="workspace-status">{status || <span className="workspace-local-status">Private workspace</span>}{actions}</div>
    </header>
    <nav className="sidebar-left workspace-navigation" aria-label="Workspaces">
      <div className="workspace-nav-row workspace-primary-nav">
        {primaryItems.map(item => <NavigationItem key={item.key} item={item} active={active} busy={navigating} hasContent={hasContent} onNavigate={navigate} />)}
      </div>
      {supportingItems.length ? <div className="workspace-support-row">
        <span className="workspace-support-label">Planning &amp; review</span>
        <div className="workspace-nav-row workspace-support-nav">
          {supportingItems.map(item => <NavigationItem key={item.key} item={item} active={active} busy={navigating} hasContent={hasContent} onNavigate={navigate} />)}
        </div>
      </div> : null}
    </nav>
    {navigationError ? <div className="workspace-navigation-error" role="alert">{navigationError}</div> : null}
    <div className={`workspace-layout${aside ? ' workspace-layout-with-aside' : ''}`}>
      <main id="workspace-main" className={`main workspace-main ${mainClassName}`} aria-label={workspaceLabel(active)} tabIndex={-1}>{children}</main>
      {aside ? <div className="workspace-legacy-aside">{aside}</div> : null}
    </div>
  </div>
}
