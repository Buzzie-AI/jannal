import './styles.css'
import { state } from './state.js'
import { connect, rebuildGroups } from './ws.js'
import { renderAll, renderContextBar, renderReqList, renderDetail, renderStatus, renderSessionTabs, renderSettings, copyClaudeCommand, getFilteredReqs } from './render.js'
import { openModal, closeModal, setModalView, toggleAllTools, toggleGroupTools, toggleGroupAccordion, toggleGroupCheckbox, onToolToggle, saveCurrentAsProfile, createProfileFromThisTurn, filterModalContent, copyModalContent } from './modal.js'
import { onProfileChange } from './profiles.js'
import { restoreSession, exportSessionJSON, exportSessionCSV, downloadExport, persistSession } from './session.js'
import { initTheme, toggleTheme } from './theme.js'

// ─── Request selection & clearing ──────────────────────────────────────────

function selectReq(i) {
  state.selectedReq = i
  renderContextBar()
  renderReqList()
  renderDetail()
  persistSession(state)
}

function clearReqs() {
  state.reqs = []
  state.selectedReq = null
  state.groups = {}
  state.expandedGroups = {}
  state.sessions = {}
  state.activeSessionTab = null
  renderAll()
  persistSession(state)
}

function selectSessionTab(id) {
  state.activeSessionTab = id
  // Auto-select the latest request from this session
  let latestIdx = null
  for (let i = state.reqs.length - 1; i >= 0; i--) {
    if (id === null || state.reqs[i].tabKey === id) {
      latestIdx = i
      break
    }
  }
  state.selectedReq = latestIdx
  renderAll()
  persistSession(state)
}

function dismissSessionTab(id) {
  delete state.sessions[id]
  if (state.activeSessionTab === id) {
    state.activeSessionTab = null
    state.selectedReq = state.reqs.length > 0 ? state.reqs.length - 1 : null
  }
  renderAll()
  persistSession(state)
}

function toggleViewMode() {
  state.groupView = !state.groupView
  renderReqList()
  persistSession(state)
}

function toggleGroup(gid) {
  state.expandedGroups[gid] = !state.expandedGroups[gid]
  renderReqList()
}

function exportSession() {
  if (state.reqs.length === 0) return
  const menu = document.getElementById('exportMenu')
  menu?.classList.toggle('open')
}

function doExportJSON() {
  if (state.reqs.length === 0) return
  const content = exportSessionJSON(state)
  const ts = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
  downloadExport(content, `jannal-session-${ts}.json`)
  document.getElementById('exportMenu')?.classList.remove('open')
}

function doExportCSV() {
  if (state.reqs.length === 0) return
  const content = exportSessionCSV(state)
  const ts = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
  downloadExport(content, `jannal-session-${ts}.csv`)
  document.getElementById('exportMenu')?.classList.remove('open')
}

// ─── Expose functions to inline onclick handlers ────────────────────────────
// innerHTML-generated markup uses onclick="fn()" which needs window scope.

window.openModal = openModal
window.closeModal = closeModal
window.setModalView = setModalView
window.selectReq = selectReq
window.clearReqs = clearReqs
window.toggleGroup = toggleGroup
window.onProfileChange = onProfileChange
window.toggleAllTools = toggleAllTools
window.toggleGroupTools = toggleGroupTools
window.toggleGroupAccordion = toggleGroupAccordion
window.toggleGroupCheckbox = toggleGroupCheckbox
window.onToolToggle = onToolToggle
window.saveCurrentAsProfile = saveCurrentAsProfile
window.createProfileFromThisTurn = createProfileFromThisTurn
window.copyClaudeCommand = copyClaudeCommand
window.selectSessionTab = selectSessionTab
window.dismissSessionTab = dismissSessionTab
window.filterModalContent = filterModalContent
window.copyModalContent = copyModalContent

// ─── Global search ──────────────────────────────────────────────────────────

let searchTimer = null

function globalSearch(query) {
  const results = document.getElementById('globalSearchResults')
  if (!query || query.length < 2) {
    results.classList.remove('open')
    results.innerHTML = ''
    return
  }

  clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
      const data = await resp.json()

      if (data.results.length === 0) {
        results.innerHTML = '<div class="search-no-results">No matches found</div>'
        results.classList.add('open')
        return
      }

      const q = query.toLowerCase()
      const filtered = getFilteredReqs()
      results.innerHTML = data.results.map(r => {
        const reqIdx = state.reqs.findIndex(t => t.turn === r.turnId)
        // Per-session display number
        let displayNum = r.turnId
        if (reqIdx >= 0) {
          const pos = filtered.findIndex(f => f.originalIndex === reqIdx)
          displayNum = pos >= 0 ? pos + 1 : reqIdx + 1
        }
        // Segment name and turn number from request data
        const segName = reqIdx >= 0 && state.reqs[reqIdx].segments[r.segIndex]
          ? state.reqs[reqIdx].segments[r.segIndex].name
          : `Segment ${r.segIndex}`
        const turnNum = reqIdx >= 0 && state.reqs[reqIdx].groupId != null
          ? `Turn ${state.reqs[reqIdx].groupId + 1} · ` : ''
        const snippet = r.snippet
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>')
        return `<div class="search-result-item" data-turn="${reqIdx}" data-seg="${r.segIndex}">
          <div class="search-result-turn">${turnNum}Req ${displayNum} · ${segName}</div>
          <div class="search-result-snippet">${snippet}</div>
        </div>`
      }).join('')
      results.classList.add('open')
    } catch (err) {
      console.error('Search error:', err)
    }
  }, 250)
}

// ─── Event listeners ────────────────────────────────────────────────────────

document.getElementById('settingsToggle').addEventListener('click', () => {
  state.showSettings = !state.showSettings
  renderSettings()
})

document.getElementById('settingsCloseBtn').addEventListener('click', () => {
  state.showSettings = false
  renderSettings()
})

document.getElementById('settingsOverlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('settingsOverlay')) {
    state.showSettings = false
    renderSettings()
  }
})

// Smart Strip settings changes
document.getElementById('settingsBody').addEventListener('change', async (e) => {
  if (e.target.name === 'stripMode') {
    state.strip.mode = e.target.value
    await postStripSettings()
    renderAll()
    renderSettings()
  }
})
document.getElementById('settingsBody').addEventListener('input', (e) => {
  if (e.target.id === 'stripKeepN') {
    state.strip.keepN = parseInt(e.target.value) || 3
    debounceStripSave()
  } else if (e.target.id === 'stripThreshold') {
    state.strip.threshold = parseInt(e.target.value) || 2000
    debounceStripSave()
  }
})

let stripSaveTimer = null
function debounceStripSave() {
  clearTimeout(stripSaveTimer)
  stripSaveTimer = setTimeout(() => postStripSettings(), 500)
}
async function postStripSettings() {
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strip: state.strip }),
    })
  } catch (e) {
    console.error('Failed to save strip settings:', e)
  }
}

document.getElementById('themeToggle').addEventListener('click', () => {
  toggleTheme()
  renderAll()
})

document.getElementById('profileSelect').addEventListener('change', (e) => {
  onProfileChange(e.target.value)
})

document.getElementById('clearBtn').addEventListener('click', clearReqs)
document.getElementById('viewToggleBtn').addEventListener('click', toggleViewMode)
document.getElementById('exportBtn').addEventListener('click', exportSession)

document.getElementById('exportMenu')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.export-option')
  if (btn) {
    if (btn.dataset.format === 'json') doExportJSON()
    else if (btn.dataset.format === 'csv') doExportCSV()
  }
})

document.addEventListener('click', (e) => {
  const menu = document.getElementById('exportMenu')
  const dropdown = document.querySelector('.export-dropdown')
  if (menu?.classList.contains('open') && dropdown && !dropdown.contains(e.target)) {
    menu.classList.remove('open')
  }
  // Close router popover on outside click
  const routerWrapper = document.querySelector('.router-badge-wrapper')
  const routerPopover = document.getElementById('routerPopover')
  if (routerPopover?.classList.contains('open') && routerWrapper && !routerWrapper.contains(e.target)) {
    routerPopover.classList.remove('open')
  }
})

// ─── Router mode popover ─────────────────────────────────────────────────────

document.getElementById('routerBadge')?.addEventListener('click', (e) => {
  e.stopPropagation()
  document.getElementById('routerPopover')?.classList.toggle('open')
})

document.getElementById('routerPopover')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.router-popover-opt')
  if (!btn) return
  if (!state.premium) return // Premium required for mode changes
  const mode = btn.dataset.mode
  if (mode === state.routerMode) {
    document.getElementById('routerPopover')?.classList.remove('open')
    return
  }
  try {
    const resp = await fetch('/api/router/mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    })
    if (resp.ok) {
      state.routerMode = mode
      renderStatus()
    }
  } catch (err) {
    console.error('Failed to set router mode:', err)
  }
  document.getElementById('routerPopover')?.classList.remove('open')
})

document.getElementById('modalOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal()
})

document.getElementById('modalCloseBtn').addEventListener('click', closeModal)

document.getElementById('formattedBtn').addEventListener('click', (e) => {
  setModalView('formatted', e.target)
})

document.getElementById('rawBtn').addEventListener('click', (e) => {
  setModalView('raw', e.target)
})

document.getElementById('toolsViewBtn').addEventListener('click', (e) => {
  setModalView('tools', e.target)
})

document.getElementById('modalSearch').addEventListener('input', filterModalContent)

document.getElementById('copyBtn').addEventListener('click', copyModalContent)

document.getElementById('globalSearch').addEventListener('input', (e) => {
  globalSearch(e.target.value.trim())
})

document.getElementById('globalSearchResults').addEventListener('click', (e) => {
  const item = e.target.closest('.search-result-item')
  if (!item) return
  const reqIdx = parseInt(item.dataset.turn)
  const segIndex = parseInt(item.dataset.seg)
  if (reqIdx >= 0) {
    selectReq(reqIdx)
    openModal(segIndex)
  }
  document.getElementById('globalSearchResults').classList.remove('open')
  document.getElementById('globalSearch').value = ''
})

document.addEventListener('click', (e) => {
  const wrapper = document.querySelector('.global-search-wrapper')
  if (wrapper && !wrapper.contains(e.target)) {
    document.getElementById('globalSearchResults').classList.remove('open')
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('globalSearchResults').classList.remove('open')
    if (state.showSettings) { state.showSettings = false; renderSettings() }
    closeModal()
  }
})

// ─── Init ───────────────────────────────────────────────────────────────────

initTheme()
restoreSession(state)
rebuildGroups()
connect()
renderAll()
