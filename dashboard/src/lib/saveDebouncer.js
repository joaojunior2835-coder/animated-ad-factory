// Shared debounced-save helper.
//
// Persisting used to be a synchronous localStorage write; it is an HTTP
// round-trip now, so edits have to be coalesced — typing a sentence should
// produce one request, not one per keystroke. Both the Marketing Studio
// (per-session) and the Node Canvas (single 'default' row) use this, so the
// timing rules live in one place rather than being reimplemented per feature.
//
// `key` identifies what is pending. Scheduling a different key flushes the
// previous one first: switching sessions mid-debounce must not silently drop
// the edit you just made to the one you left.

export const DEFAULT_SAVE_DEBOUNCE_MS = 800

/**
 * @param {(key: string) => void} save  Persist whatever `key` currently refers
 *   to. Called with the key that was pending; reads live state itself, so a
 *   late-firing timer never writes a stale snapshot.
 */
export function createSaveDebouncer(save, delayMs = DEFAULT_SAVE_DEBOUNCE_MS) {
  let timer = null
  let pendingKey = null

  const clear = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  /** Persist the pending key right now. No-op when nothing is pending. */
  const flush = () => {
    clear()
    const key = pendingKey
    pendingKey = null
    if (key !== null && key !== undefined) save(key)
  }

  /** Queue a save for `key`, restarting the window. */
  const schedule = (key) => {
    if (pendingKey !== null && pendingKey !== undefined && pendingKey !== key) flush()
    pendingKey = key
    clear()
    timer = setTimeout(() => {
      timer = null
      flush()
    }, delayMs)
  }

  /**
   * Drop a queued save without running it — used when the thing being saved has
   * just been deleted, so the timer cannot recreate it moments later.
   */
  const cancel = (key) => {
    if (key !== undefined && pendingKey !== key) return
    clear()
    pendingKey = null
  }

  const isPending = (key) => (key === undefined ? pendingKey !== null : pendingKey === key)

  return { schedule, flush, cancel, isPending }
}
