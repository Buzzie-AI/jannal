const THEME_KEY = 'jannal_theme'

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark'
}

export function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }

  const moonIcon = document.getElementById('themeIconMoon')
  const sunIcon = document.getElementById('themeIconSun')
  if (moonIcon && sunIcon) {
    moonIcon.style.display = theme === 'dark' ? 'block' : 'none'
    sunIcon.style.display = theme === 'light' ? 'block' : 'none'
  }
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark'
  localStorage.setItem(THEME_KEY, next)

  document.documentElement.classList.add('theme-transitioning')
  applyTheme(next)
  setTimeout(() => document.documentElement.classList.remove('theme-transitioning'), 350)

  return next
}

export function initTheme() {
  // Apply saved theme (no transition on initial load)
  applyTheme(getTheme())
}
