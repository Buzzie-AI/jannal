import './styles.css'
import { state } from './state.js'
import { connect } from './ws.js'
import { renderAll, renderContextBar, renderTurnList, renderDetail, copyClaudeCommand } from './render.js'
import { openModal, closeModal, setModalView, toggleAllTools, toggleGroupTools, onToolToggle, saveCurrentAsProfile, createProfileFromThisTurn, filterModalContent, copyModalContent } from './modal.js'
import { onProfileChange } from './profiles.js'
import { restoreSession, exportSessionJSON, exportSessionCSV, downloadExport, persistSession } from './session.js'

// ─── Turn selection & clearing ──────────────────────────────────────────────

function selectTurn(i) {
  state.selectedTurn = i
  renderContextBar()
  renderTurnList()
  renderDetail()
  persistSession(state)
}

function clearTurns() {
  state.turns = []
  state.selectedTurn = null
  renderAll()
  persistSession(state)
}

function exportSession() {
  if (state.turns.length === 0) return
  const menu = document.getElementById('exportMenu')
  menu?.classList.toggle('open')
}

function doExportJSON() {
  if (state.turns.length === 0) return
  const content = exportSessionJSON(state)
  const ts = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '')
  downloadExport(content, `jannal-session-${ts}.json`)
  document.getElementById('exportMenu')?.classList.remove('open')
}

function doExportCSV() {
  if (state.turns.length === 0) return
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
window.selectTurn = selectTurn
window.clearTurns = clearTurns
window.onProfileChange = onProfileChange
window.toggleAllTools = toggleAllTools
window.toggleGroupTools = toggleGroupTools
window.onToolToggle = onToolToggle
window.saveCurrentAsProfile = saveCurrentAsProfile
window.createProfileFromThisTurn = createProfileFromThisTurn
window.filterModalContent = filterModalContent
window.copyModalContent = copyModalContent
window.copyClaudeCommand = copyClaudeCommand

// ─── Event listeners ────────────────────────────────────────────────────────

document.getElementById('profileSelect').addEventListener('change', (e) => {
  onProfileChange(e.target.value)
})

document.getElementById('clearBtn').addEventListener('click', clearTurns)
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

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal()
})

// ─── Init ───────────────────────────────────────────────────────────────────

restoreSession(state)
connect()
renderAll()
