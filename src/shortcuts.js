import { state, modalState } from './state.js'
import { renderAll, renderContextBar, renderReqList, renderDetail, renderSettings } from './render.js'
import { openModal, closeModal, setModalView, copyModalContent, filterModalContent } from './modal.js'
import { toggleTheme } from './theme.js'
import { persistSession } from './session.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function isInputFocused() {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function isModalOpen() {
  return document.getElementById('modalOverlay')?.classList.contains('open')
}

function isHelpOpen() {
  return document.getElementById('shortcutsOverlay')?.classList.contains('open')
}

// ─── Actions ────────────────────────────────────────────────────────────────

function selectReq(i) {
  state.selectedReq = i
  renderContextBar()
  renderReqList()
  renderDetail()
  persistSession(state)
}

function nextReq() {
  if (state.reqs.length === 0) return
  if (state.selectedReq === null) {
    selectReq(state.reqs.length - 1)
  } else if (state.selectedReq > 0) {
    selectReq(state.selectedReq - 1)
  }
}

function prevReq() {
  if (state.reqs.length === 0) return
  if (state.selectedReq === null) {
    selectReq(state.reqs.length - 1)
  } else if (state.selectedReq < state.reqs.length - 1) {
    selectReq(state.selectedReq + 1)
  }
}

function toggleViewMode() {
  state.groupView = !state.groupView
  renderReqList()
  persistSession(state)
}

function nextSegment() {
  const req = state.reqs[state.selectedReq]
  if (!req) return
  const next = (modalState.segIndex ?? -1) + 1
  if (next < req.segments.length) openModal(next)
}

function prevSegment() {
  const req = state.reqs[state.selectedReq]
  if (!req) return
  const prev = (modalState.segIndex ?? 1) - 1
  if (prev >= 0) openModal(prev)
}

function toggleHelp() {
  document.getElementById('shortcutsOverlay')?.classList.toggle('open')
}

function closeHelp() {
  document.getElementById('shortcutsOverlay')?.classList.remove('open')
}

// ─── Keyboard handler ───────────────────────────────────────────────────────

export function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    const key = e.key
    const mod = e.metaKey || e.ctrlKey

    // Cmd/Ctrl+K — focus global search (always active)
    if (mod && key === 'k') {
      e.preventDefault()
      const search = document.getElementById('globalSearch')
      if (search) { search.focus(); search.select() }
      return
    }

    // Escape — close things in priority order
    if (key === 'Escape') {
      if (isHelpOpen()) { closeHelp(); return }
      document.getElementById('globalSearchResults')?.classList.remove('open')
      if (state.showSettings) { state.showSettings = false; renderSettings(); return }
      if (isModalOpen()) { closeModal(); return }
      if (isInputFocused()) { document.activeElement.blur(); return }
      return
    }

    // Don't fire shortcuts when typing in inputs
    if (isInputFocused()) return

    // ? — show help
    if (key === '?' || (e.shiftKey && key === '/')) {
      e.preventDefault()
      toggleHelp()
      return
    }

    // ─── Modal shortcuts (when modal is open) ───────────────────────
    if (isModalOpen()) {
      switch (key) {
        case 'f':
          e.preventDefault()
          setModalView('formatted', document.getElementById('formattedBtn'))
          return
        case 'r':
          e.preventDefault()
          setModalView('raw', document.getElementById('rawBtn'))
          return
        case 't':
          e.preventDefault()
          setModalView('tools', document.getElementById('toolsViewBtn'))
          return
        case 'c':
          e.preventDefault()
          copyModalContent()
          return
        case '/':
          e.preventDefault()
          document.getElementById('modalSearch')?.focus()
          return
        case ']':
          e.preventDefault()
          nextSegment()
          return
        case '[':
          e.preventDefault()
          prevSegment()
          return
      }
    }

    // ─── Global shortcuts ───────────────────────────────────────────
    switch (key) {
      case 'j':
      case 'ArrowDown':
        e.preventDefault()
        nextReq()
        return
      case 'k':
      case 'ArrowUp':
        e.preventDefault()
        prevReq()
        return
      case 'v':
        e.preventDefault()
        toggleViewMode()
        return
      case 'd':
        e.preventDefault()
        toggleTheme()
        renderAll()
        return
    }
  })
}
