import { state } from './state.js'
import { postProfile } from './api.js'
import { sendWs } from './ws.js'

// ─── Profile management ─────────────────────────────────────────────────────

export function onProfileChange(name) {
  sendWs({ type: 'set_active_profile', profile: name })
}

export async function saveProfile(name, mode, tools) {
  try {
    const data = await postProfile(name, mode, tools)
    if (data.success) {
      state.profiles[name] = data.profile
      renderProfileSelector()
      onProfileChange(name)
    }
    return data
  } catch (err) {
    console.error('Failed to save profile:', err)
    return { error: err.message }
  }
}

export function renderProfileSelector() {
  const select = document.getElementById('profileSelect')
  const badge = document.getElementById('filterBadge')
  const currentValue = state.activeProfile

  select.innerHTML = ''
  for (const name of Object.keys(state.profiles)) {
    const opt = document.createElement('option')
    opt.value = name
    opt.textContent = name
    if (name === currentValue) opt.selected = true
    select.appendChild(opt)
  }

  const isFiltering = currentValue !== 'All Tools'
  select.className = 'profile-select' + (isFiltering ? ' filtering' : '')
  badge.style.display = isFiltering ? 'inline' : 'none'
}
