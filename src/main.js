import './styles.css'
import { state } from './state.js'
import { connect } from './ws.js'
import { renderAll, renderContextBar, renderTurnList, renderDetail } from './render.js'
import { openModal, closeModal, setModalView, toggleAllTools, onToolToggle, saveCurrentAsProfile, filterModalContent, copyModalContent } from './modal.js'
import { onProfileChange } from './profiles.js'

// ─── Turn selection & clearing ──────────────────────────────────────────────

function selectTurn(i) {
  state.selectedTurn = i
  renderContextBar()
  renderTurnList()
  renderDetail()
}

function clearTurns() {
  state.turns = []
  state.selectedTurn = null
  renderAll()
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
window.onToolToggle = onToolToggle
window.saveCurrentAsProfile = saveCurrentAsProfile
window.filterModalContent = filterModalContent
window.copyModalContent = copyModalContent

// ─── Event listeners ────────────────────────────────────────────────────────

document.getElementById('profileSelect').addEventListener('change', (e) => {
  onProfileChange(e.target.value)
})

document.getElementById('clearBtn').addEventListener('click', clearTurns)

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

connect()
renderAll()
