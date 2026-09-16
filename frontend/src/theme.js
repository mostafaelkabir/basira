// Theme preference: 'system' | 'light' | 'dark'. Resolved theme is what the page renders.
const KEY = 'basira_theme'
const media = () => window.matchMedia?.('(prefers-color-scheme: dark)')

export function getThemePreference() {
  try { const v = localStorage.getItem(KEY); return ['light', 'dark', 'system'].includes(v) ? v : 'system' } catch { return 'system' }
}
export function resolveTheme(pref = getThemePreference()) {
  if (pref === 'system') return media()?.matches ? 'dark' : 'light'
  return pref
}
export function setThemePreference(pref) {
  try { localStorage.setItem(KEY, pref) } catch { /* Preference still applies for this session. */ }
  applyTheme(pref)
  window.dispatchEvent(new CustomEvent('basira:theme', { detail: pref }))
}
export function applyTheme(pref = getThemePreference()) {
  const resolved = resolveTheme(pref)
  document.documentElement.dataset.theme = resolved
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#070d0b' : '#0c1c16')
  return resolved
}
export function watchSystemTheme(onChange) {
  const m = media(); if (!m) return () => {}
  const handle = () => { if (getThemePreference() === 'system') onChange(applyTheme('system')) }
  m.addEventListener('change', handle)
  return () => m.removeEventListener('change', handle)
}
