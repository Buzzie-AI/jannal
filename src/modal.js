import { state, modalState } from './state.js'
import { getSegColor, getSegLabel, fmt, escapeHtml, isToolEnabled, estimateToolTokens } from './utils.js'
import { fetchContent } from './api.js'
import { saveProfile } from './profiles.js'

// ─── Modal ──────────────────────────────────────────────────────────────────

export async function openModal(segIndex) {
  const turn = state.turns[state.selectedTurn]
  if (!turn) return
  const seg = turn.segments[segIndex]
  if (!seg) return

  modalState.segment = seg
  modalState.segIndex = segIndex
  modalState.view = seg.type === 'tools' ? 'tools' : 'formatted'
  modalState.fullContent = ''
  modalState.loading = true
  modalState.parsedTools = null

  const color = getSegColor(seg)
  document.getElementById('modalColorBar').style.background = color
  document.getElementById('modalTitle').textContent = seg.name
  document.getElementById('modalMeta').textContent = `${getSegLabel(seg)}${seg.role ? ' (' + seg.role + ')' : ''}${seg.count ? ' — ' + seg.count + ' tools' : ''}`

  // Stats
  const statsHtml = `
    <div class="modal-stat"><div class="modal-stat-value" style="color:${color}">${fmt(seg.tokens)}</div><div class="modal-stat-label">Tokens</div></div>
    <div class="modal-stat"><div class="modal-stat-value">${(seg.charLength || 0).toLocaleString()}</div><div class="modal-stat-label">Chars</div></div>
    <div class="modal-stat"><div class="modal-stat-value">${((seg.tokens / turn.totalEstimatedTokens) * 100).toFixed(1)}%</div><div class="modal-stat-label">Of total</div></div>
  `
  document.getElementById('modalStats').innerHTML = statsHtml

  // Show/hide tools view button
  const toolsBtn = document.getElementById('toolsViewBtn')
  toolsBtn.style.display = seg.type === 'tools' ? 'inline' : 'none'

  // Reset toolbar
  document.querySelectorAll('.modal-toolbar button').forEach(b => b.classList.remove('active'))
  if (seg.type === 'tools') {
    toolsBtn.classList.add('active')
  } else {
    document.getElementById('formattedBtn').classList.add('active')
  }
  document.getElementById('modalSearch').value = ''

  // Show loading state immediately
  document.getElementById('modalBody').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:200px;color:var(--text3);font-size:13px"><div style="text-align:center"><div style="font-size:24px;margin-bottom:8px;animation:pulse 1s ease-in-out infinite">&#x23F3;</div>Loading full content...</div></div>'
  document.getElementById('modalOverlay').classList.add('open')

  // Fetch full content from server via HTTP
  try {
    const data = await fetchContent(turn.turn, segIndex)
    if (data.content) {
      modalState.fullContent = data.content
      if (seg.type === 'tools') {
        try { modalState.parsedTools = JSON.parse(data.content) } catch (e) { modalState.parsedTools = null }
      }
    } else {
      modalState.fullContent = seg.preview || '(content no longer available — turn may have been evicted)'
    }
  } catch (err) {
    console.error('Failed to fetch segment content:', err)
    modalState.fullContent = seg.preview || '(failed to load content)'
  }

  modalState.loading = false
  renderModalContent()
}

export function closeModal() {
  document.getElementById('modalOverlay').classList.remove('open')
  modalState.segment = null
  modalState.parsedTools = null
}

export function setModalView(view, btn) {
  modalState.view = view
  document.querySelectorAll('.modal-toolbar button').forEach(b => b.classList.remove('active'))
  if (btn) btn.classList.add('active')
  renderModalContent()
}

export function renderModalContent() {
  const body = document.getElementById('modalBody')
  const content = modalState.fullContent

  if (modalState.loading) return

  // Tools view — show toggle cards
  if (modalState.view === 'tools' && modalState.parsedTools) {
    renderToolsView(body)
    return
  }

  if (modalState.view === 'raw') {
    body.innerHTML = `<div class="modal-content" style="white-space:pre-wrap;word-break:break-all">${escapeHtml(content)}</div>`
    return
  }

  // Formatted view — with line numbers
  const lines = content.split('\n')
  let html = '<div class="modal-content">'
  for (let i = 0; i < lines.length; i++) {
    html += `<span class="line"><span class="line-num">${i + 1}</span>${escapeHtml(lines[i])}</span>\n`
  }
  html += '</div>'
  body.innerHTML = html
}

function renderToolsView(body) {
  const tools = modalState.parsedTools
  if (!tools || !tools.length) {
    body.innerHTML = '<div style="padding:20px;color:var(--text3)">No tools found</div>'
    return
  }

  const profile = state.profiles[state.activeProfile]
  const isAllTools = state.activeProfile === 'All Tools'

  let html = '<div class="modal-tools">'

  // Header with select all / none
  const checkedCount = tools.filter(t => isToolEnabled(t.name, profile, isAllTools)).length
  html += `<div class="modal-tools-header">`
  html += `<div class="modal-tools-header-left"><strong>${checkedCount}</strong> of <strong>${tools.length}</strong> tools enabled</div>`
  html += `<div style="display:flex;gap:6px">`
  html += `<button class="btn-secondary" onclick="toggleAllTools(true)" style="padding:3px 8px;border-radius:4px;font-size:10px">All</button>`
  html += `<button class="btn-secondary" onclick="toggleAllTools(false)" style="padding:3px 8px;border-radius:4px;font-size:10px">None</button>`
  html += `</div></div>`

  // Tool cards
  for (const tool of tools) {
    const enabled = isToolEnabled(tool.name, profile, isAllTools)
    const toolTokens = estimateToolTokens(tool)
    const desc = (tool.description || '').slice(0, 120)
    html += `<div class="tool-card">`
    html += `<input type="checkbox" data-tool="${escapeHtml(tool.name)}" ${enabled ? 'checked' : ''} onchange="onToolToggle()">`
    html += `<div class="tool-card-info">`
    html += `<div class="tool-card-name">${escapeHtml(tool.name)}</div>`
    if (desc) html += `<div class="tool-card-desc">${escapeHtml(desc)}</div>`
    html += `</div>`
    html += `<div class="tool-card-tokens">~${fmt(toolTokens)} tok</div>`
    html += `</div>`
  }

  // Savings estimate
  html += `<div id="toolsSavings"></div>`

  // Save as profile bar
  html += `<div class="save-profile-bar">`
  html += `<input type="text" id="profileNameInput" placeholder="Profile name..." value="">`
  html += `<button class="btn-primary" onclick="saveCurrentAsProfile()">Save as Profile</button>`
  html += `</div>`

  html += '</div>'
  body.innerHTML = html

  // Trigger savings calculation
  onToolToggle()
}

export function toggleAllTools(enable) {
  document.querySelectorAll('.modal-tools input[type="checkbox"]').forEach(cb => {
    cb.checked = enable
  })
  onToolToggle()
}

export function onToolToggle() {
  const checkboxes = document.querySelectorAll('.modal-tools input[type="checkbox"]')
  const tools = modalState.parsedTools
  if (!tools || !checkboxes.length) return

  let enabledTokens = 0
  let disabledTokens = 0
  let enabledCount = 0

  checkboxes.forEach((cb) => {
    const tool = tools.find(t => t.name === cb.dataset.tool)
    if (!tool) return
    const tokens = estimateToolTokens(tool)
    if (cb.checked) {
      enabledTokens += tokens
      enabledCount++
    } else {
      disabledTokens += tokens
    }
  })

  const savingsEl = document.getElementById('toolsSavings')
  if (savingsEl && disabledTokens > 0) {
    savingsEl.innerHTML = `<div class="savings-banner">Disabling ${tools.length - enabledCount} tools saves ~${fmt(disabledTokens)} tokens per turn</div>`
  } else if (savingsEl) {
    savingsEl.innerHTML = ''
  }

  // Update header count
  const header = document.querySelector('.modal-tools-header-left')
  if (header) header.innerHTML = `<strong>${enabledCount}</strong> of <strong>${tools.length}</strong> tools enabled`
}

export async function saveCurrentAsProfile() {
  const nameInput = document.getElementById('profileNameInput')
  const name = (nameInput?.value || '').trim()
  if (!name) {
    nameInput.style.borderColor = 'var(--red)'
    nameInput.focus()
    setTimeout(() => nameInput.style.borderColor = '', 1500)
    return
  }

  const checkboxes = document.querySelectorAll('.modal-tools input[type="checkbox"]')
  const enabledTools = []
  checkboxes.forEach(cb => {
    if (cb.checked) enabledTools.push(cb.dataset.tool)
  })

  const result = await saveProfile(name, 'allowlist', enabledTools)
  if (result.success) {
    nameInput.value = ''
    const bar = document.querySelector('.save-profile-bar')
    if (bar) {
      const origBg = bar.style.background
      bar.style.background = 'rgba(16,185,129,0.1)'
      bar.style.borderColor = 'rgba(16,185,129,0.3)'
      setTimeout(() => { bar.style.background = origBg; bar.style.borderColor = '' }, 1500)
    }
  }
}

export function filterModalContent() {
  const query = document.getElementById('modalSearch').value.trim().toLowerCase()
  const body = document.getElementById('modalBody')

  if (!query) {
    renderModalContent()
    return
  }

  // If in tools view, filter tool cards
  if (modalState.view === 'tools') {
    document.querySelectorAll('.tool-card').forEach(card => {
      const name = card.querySelector('.tool-card-name')?.textContent?.toLowerCase() || ''
      const desc = card.querySelector('.tool-card-desc')?.textContent?.toLowerCase() || ''
      card.style.display = (name.includes(query) || desc.includes(query)) ? 'flex' : 'none'
    })
    return
  }

  const content = modalState.fullContent
  const lines = content.split('\n')
  let html = '<div class="modal-content">'
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const idx = line.toLowerCase().indexOf(query)
    if (idx !== -1) {
      const before = escapeHtml(line.slice(0, idx))
      const match = escapeHtml(line.slice(idx, idx + query.length))
      const after = escapeHtml(line.slice(idx + query.length))
      html += `<span class="line"><span class="line-num">${i + 1}</span>${before}<span class="highlight">${match}</span>${after}</span>\n`
    } else {
      html += `<span class="line" style="opacity:0.25"><span class="line-num">${i + 1}</span>${escapeHtml(line)}</span>\n`
    }
  }
  html += '</div>'
  body.innerHTML = html
}

export function copyModalContent() {
  navigator.clipboard.writeText(modalState.fullContent).then(() => {
    const btn = document.getElementById('copyBtn')
    const orig = btn.textContent
    btn.textContent = 'Copied!'
    btn.style.color = 'var(--green)'
    setTimeout(() => { btn.textContent = orig; btn.style.color = '' }, 1500)
  })
}
