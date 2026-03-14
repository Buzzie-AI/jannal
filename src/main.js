import './styles.css'
import { state } from './state.js'
import { connect, rebuildGroups } from './ws.js'
import { renderAll, renderContextBar, renderReqList, renderDetail } from './render.js'
import { openModal, closeModal, setModalView, toggleAllTools, toggleGroupTools, onToolToggle, saveCurrentAsProfile, filterModalContent, copyModalContent } from './modal.js'
import { onProfileChange } from './profiles.js'
import { restoreSession, exportSessionJSON, exportSessionCSV, downloadExport, persistSession } from './session.js'

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
window.onToolToggle = onToolToggle
window.saveCurrentAsProfile = saveCurrentAsProfile
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
      results.innerHTML = data.results.map(r => {
        const reqIdx = state.reqs.findIndex(t => t.turn === r.turnId)
        const reqLabel = reqIdx >= 0 ? `Req ${state.reqs[reqIdx].turn}` : `Req ${r.turnId}`
        const snippet = r.snippet
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>')
        return `<div class="search-result-item" data-turn="${reqIdx}" data-seg="${r.segIndex}">
          <div class="search-result-turn">${reqLabel} · segment ${r.segIndex}</div>
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
    closeModal()
  }
})

// ─── Init ───────────────────────────────────────────────────────────────────

restoreSession(state)
rebuildGroups()
connect()
renderAll()
