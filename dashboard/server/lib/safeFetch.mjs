// SSRF-guarded fetch for product page URLs the user enters themselves.
//
// This never throws. Every code path resolves to one of two shapes:
//   { ok: true, text, finalUrl, fetchedAt, contentHash }
//   { ok: false, reason }
// so a caller (research generation) can always degrade gracefully instead of
// crashing a request because someone's product URL went stale or hostile.
//
// Threat model: the URL is entered by the account owner (a local, single-user
// tool), not supplied by an untrusted third party. The guard below exists
// anyway, because a stored URL could point at an internal service through
// carelessness or a compromised upstream redirect, and the app should not
// become an SSRF pivot for whatever else runs on this machine or network.

import dns from 'node:dns'
import crypto from 'node:crypto'
import * as cheerio from 'cheerio'

const FETCH_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 3
const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2MB
const MAX_TEXT_CHARS = 6000
const ALLOWED_CONTENT_TYPES = ['text/html', 'text/plain']

/**
 * Is this IP address loopback, private (RFC1918), link-local, or otherwise
 * not something we want this server initiating requests to?
 *
 * Deliberately conservative: a malformed address is treated as blocked, not
 * allowed. Exported so it can be unit-tested against a table of addresses
 * without needing a network or a live DNS resolver.
 */
export function isBlockedIp(ip) {
  if (!ip || typeof ip !== 'string') return true
  const addr = ip.trim().toLowerCase()
  if (!addr) return true
  // Neither IPv4-shaped nor IPv6-shaped — not a real address we can vouch
  // for, so treat it as blocked rather than silently falling through.
  if (!addr.includes('.') && !addr.includes(':')) return true

  if (addr.includes('.') && !addr.includes(':')) {
    // IPv4 (bare, or the tail of a ::ffff:a.b.c.d mapped address is handled below).
    const parts = addr.split('.')
    if (parts.length !== 4) return true
    const nums = parts.map((p) => Number(p))
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
    const [a, b] = nums
    if (a === 127) return true // 127.0.0.0/8 loopback
    if (a === 10) return true // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
    if (a === 0) return true // 0.0.0.0/8 "this network"
    return false
  }

  // IPv6
  if (addr === '::1') return true // loopback
  if (addr === '::') return true // unspecified
  if (addr.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — unwrap and check the embedded IPv4 address.
    const mapped = addr.slice('::ffff:'.length)
    if (mapped.includes('.')) return isBlockedIp(mapped)
  }
  // fe80::/10 link-local: first byte fe, second byte's top two bits are 10,
  // i.e. the second hex group starts with 8, 9, a or b.
  if (/^fe[89ab]/.test(addr)) return true
  // fc00::/7 unique local (fc00:: through fdff::).
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true

  return false
}

function isBlockedHostnameLiteral(hostname) {
  return String(hostname || '').trim().toLowerCase() === 'localhost'
}

/**
 * Validate a URL is safe to fetch: http(s) only, hostname is not the literal
 * "localhost", and every DNS-resolved address for it is public.
 *
 * NOTE — accepted gap: this checks DNS resolution before fetching, but does
 * not pin the actual TCP connection to the specific IP that was checked here
 * (that would require a custom fetch agent / dispatcher). A narrow
 * DNS-rebinding window exists between this check and the real connection.
 * Accepted because the URL is entered by the account owner of this local
 * tool, not an untrusted third party — revisit if that assumption changes
 * (e.g. this ever becomes multi-tenant or accepts URLs from other users).
 */
async function validateUrlIsSafe(urlString) {
  let parsed
  try {
    parsed = new URL(urlString)
  } catch {
    return { safe: false, reason: 'invalid_url' }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { safe: false, reason: `unsupported_protocol:${parsed.protocol}` }
  }
  if (isBlockedHostnameLiteral(parsed.hostname)) {
    return { safe: false, reason: 'blocked_hostname_localhost' }
  }

  let addresses
  try {
    addresses = await dns.promises.lookup(parsed.hostname, { all: true })
  } catch {
    return { safe: false, reason: 'dns_lookup_failed' }
  }
  if (!addresses.length) return { safe: false, reason: 'dns_lookup_empty' }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) return { safe: false, reason: `blocked_ip:${address}` }
  }

  return { safe: true, parsed }
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim()
}

/** Strip non-content elements and elements hidden via inline display:none. */
function extractVisibleText(html) {
  const $ = cheerio.load(html)
  $('script, style, nav, header, footer, iframe, noscript').remove()
  $('[style]').each((_, el) => {
    const style = $(el).attr('style') || ''
    if (/display\s*:\s*none/i.test(style)) $(el).remove()
  })
  return $('body').length ? $('body').text() : $.root().text()
}

/** Read a fetch Response body, aborting once it exceeds the byte cap. */
async function readBodyCapped(response, maxBytes) {
  const reader = response.body ? response.body.getReader() : null
  if (!reader) {
    // No stream available (unusual) — fall back to a single buffered read,
    // still enforcing the cap after the fact.
    const buf = Buffer.from(await response.arrayBuffer())
    if (buf.byteLength > maxBytes) return { ok: false, reason: 'body_too_large' }
    return { ok: true, buffer: buf }
  }

  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      try {
        await reader.cancel()
      } catch {
        /* best effort */
      }
      return { ok: false, reason: 'body_too_large' }
    }
    chunks.push(value)
  }
  return { ok: true, buffer: Buffer.concat(chunks.map((c) => Buffer.from(c))) }
}

/**
 * Fetch a product page and extract its visible text, guarded against SSRF.
 * Never throws.
 */
export async function fetchProductPageText(url) {
  let currentUrl = url
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const check = await validateUrlIsSafe(currentUrl)
      if (!check.safe) return { ok: false, reason: check.reason }

      let response
      try {
        response = await fetch(check.parsed.toString(), {
          signal: controller.signal,
          redirect: 'manual',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProductTestResearchBot/1.0)' },
        })
      } catch (e) {
        if (e && e.name === 'AbortError') return { ok: false, reason: 'timeout' }
        return { ok: false, reason: 'network_error' }
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) return { ok: false, reason: 'redirect_without_location' }
        if (hop === MAX_REDIRECTS) return { ok: false, reason: 'too_many_redirects' }
        // Resolve relative redirect targets against the current URL, then loop
        // back to the top — the destination gets the FULL validation again,
        // including DNS, even if the original URL was public.
        try {
          currentUrl = new URL(location, check.parsed).toString()
        } catch {
          return { ok: false, reason: 'invalid_redirect_target' }
        }
        continue
      }

      if (response.status < 200 || response.status >= 300) {
        return { ok: false, reason: `http_status_${response.status}` }
      }

      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        return { ok: false, reason: `unsupported_content_type:${contentType || 'unknown'}` }
      }

      const body = await readBodyCapped(response, MAX_BODY_BYTES)
      if (!body.ok) return { ok: false, reason: body.reason }

      let text
      try {
        const html = body.buffer.toString('utf8')
        text = normalizeWhitespace(extractVisibleText(html))
      } catch {
        return { ok: false, reason: 'parse_failed' }
      }

      if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS)
      const contentHash = crypto.createHash('sha256').update(text).digest('hex')

      return {
        ok: true,
        text,
        finalUrl: check.parsed.toString(),
        fetchedAt: new Date().toISOString(),
        contentHash,
      }
    }
    return { ok: false, reason: 'too_many_redirects' }
  } catch {
    // Belt-and-braces: this function must never throw, whatever goes wrong.
    return { ok: false, reason: 'unknown_error' }
  } finally {
    clearTimeout(timer)
  }
}
