import { state } from './state.js'
import { fmt, escapeHtml, estimateToolTokens, groupToolsByServer } from './utils.js'
import { postProfile, putProfile, deleteProfile, fetchKnownTools } from './api.js'
import { onProfileChange, uniqueProfileName, renderProfileSelector } from './profiles.js'

// ─── Profile Manager ────────────────────────────────────────────────────────
// Select, edit, rename, duplicate and delete tool profiles.
//
// The editor works against a "tool universe": every tool the proxy has seen
// recently, plus any tool named in the profile that hasn't been seen (e.g. an
// MCP server that isn't loaded right now). Unseen tools stay in the profile
// untouched, so editing never silently drops them.

const DEFAULT = 'All Tools'

const pm = {
  open: false,
  selected: null,
  knownTools: [],       // tool definitions from /api/known-tools
  universe: [],         // knownTools ∪ selected profile's tools
  draft: null,          // { name, mode, enabled: Set<toolName> }
  snapshot: '',         // serialized saved state, for dirty checks
  expanded: new Set(),  // open accordion groups
  filter: '',
  pendingSwitch: null,  // profile name (or CLOSE) waiting on save/discard
  confirmDelete: false,
  saving: false,
  error: '',
}

const CLOSE = Symbol('close')

function escAttr(text) {
  return escapeHtml(String(text)).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ─── Draft model ────────────────────────────────────────────────────────────

function loadDraft(name) {
  const profile = state.profiles[name] || state.profiles[DEFAULT]
  pm.selected = profile?.name || DEFAULT
  pm.confirmDelete = false
  pm.pendingSwitch = null
  pm.error = ''

  const byName = new Map(pm.knownTools.map(t => [t.name, t]))
  for (const toolName of profile?.tools || []) {
    if (!byName.has(toolName)) byName.set(toolName, { name: toolName, _unseen: true })
  }
  pm.universe = [...byName.values()]

  const all = pm.universe.map(t => t.name)
  const listed = new Set(profile?.tools || [])
  let enabled
  if (pm.selected === DEFAULT) enabled = new Set(all)
  else if (profile.mode === 'blocklist') enabled = new Set(all.filter(n => !listed.has(n)))
  else enabled = new Set(listed)

  pm.draft = { name: pm.selected, mode: profile?.mode || 'allowlist', enabled }
  pm.snapshot = serializeDraft()
}

/** Checkboxes mean "reaches the model"; convert to the profile's stored list */
function draftTools() {
  const { mode, enabled } = pm.draft
  if (mode === 'blocklist') return pm.universe.map(t => t.name).filter(n => !enabled.has(n))
  return pm.universe.map(t => t.name).filter(n => enabled.has(n))
}

function serializeDraft() {
  return JSON.stringify([pm.draft.name.trim(), pm.draft.mode, [...draftTools()].sort()])
}

function isDirty() {
  return pm.selected !== DEFAULT && pm.draft && serializeDraft() !== pm.snapshot
}

// ─── Open / close / select ──────────────────────────────────────────────────

export function isProfileManagerOpen() {
  return pm.open
}

export async function openProfileManager(name = state.activeProfile) {
  pm.open = true
  pm.filter = ''
  pm.expanded.clear()
  document.getElementById('profileManagerOverlay').classList.add('open')
  try {
    const data = await fetchKnownTools()
    pm.knownTools = data.tools || []
  } catch (err) {
    console.error('Failed to load known tools:', err)
    pm.knownTools = []
  }
  loadDraft(name)
  render()
}

/** Returns false if blocked on unsaved changes (the footer then asks what to do) */
export function closeProfileManager() {
  if (isDirty()) {
    pm.pendingSwitch = CLOSE
    renderFooter()
    return false
  }
  pm.open = false
  pm.draft = null
  document.getElementById('profileManagerOverlay').classList.remove('open')
  document.getElementById('pmList').innerHTML = ''
  document.getElementById('pmEditor').innerHTML = ''
  return true
}

function selectProfile(name) {
  if (name === pm.selected) return
  if (isDirty()) {
    pm.pendingSwitch = name
    renderFooter()
    return
  }
  pm.filter = ''
  loadDraft(name)
  render()
}

function resolvePendingSwitch() {
  const target = pm.pendingSwitch
  pm.pendingSwitch = null
  if (target === CLOSE) { pm.snapshot = serializeDraft(); closeProfileManager(); return }
  if (target != null) { pm.filter = ''; loadDraft(target); render() }
}

/** Called from ws.js whenever profiles or the active profile change */
export function onProfilesUpdated() {
  if (!pm.open || pm.saving) return
  if (!state.profiles[pm.selected]) loadDraft(state.activeProfile)
  else if (!isDirty() && !pm.pendingSwitch) loadDraft(pm.selected)
  render()
}

// ─── Actions ────────────────────────────────────────────────────────────────

async function save() {
  if (!isDirty()) return true
  const newName = pm.draft.name.trim()
  if (!newName) { pm.error = 'Name is required'; renderFooter(); return false }

  pm.saving = true
  let result
  try {
    result = await putProfile(pm.selected, { newName, mode: pm.draft.mode, tools: draftTools() })
  } catch (err) {
    result = { error: err.message }
  }
  pm.saving = false

  if (!result.success) {
    pm.error = result.error || 'Save failed'
    renderFooter()
    return false
  }

  // Mirror the server locally in case the websocket broadcast hasn't landed yet
  if (newName !== pm.selected) {
    const next = {}
    for (const [k, v] of Object.entries(state.profiles)) next[k === pm.selected ? newName : k] = v
    state.profiles = next
    if (state.activeProfile === pm.selected) state.activeProfile = newName
  }
  state.profiles[newName] = result.profile
  renderProfileSelector()
  loadDraft(newName)
  render()
  return true
}

async function createProfile(baseName, mode, tools) {
  const name = uniqueProfileName(baseName)
  let result
  try {
    result = await postProfile(name, mode, tools)
  } catch (err) {
    result = { error: err.message }
  }
  if (!result.success) {
    pm.error = result.error || 'Could not create profile'
    renderFooter()
    return
  }
  state.profiles[name] = result.profile
  renderProfileSelector()
  pm.filter = ''
  loadDraft(name)
  render()
  const input = document.getElementById('pmName')
  if (input) { input.focus(); input.select() }
}

function newProfile() {
  if (isDirty()) { pm.pendingSwitch = null; pm.error = 'Save or revert your changes first'; renderFooter(); return }
  // Start from everything enabled — unchecking is quicker than hunting for tools to add
  createProfile('New profile', 'allowlist', pm.knownTools.map(t => t.name))
}

function duplicateProfile() {
  // Duplicating a dirty profile acts as "save as copy": the copy gets the
  // edits and the original is left as it was saved
  const base = pm.selected === DEFAULT ? 'Custom' : `${pm.draft.name.trim() || pm.selected} copy`
  const mode = pm.selected === DEFAULT ? 'allowlist' : pm.draft.mode
  const tools = pm.selected === DEFAULT ? pm.universe.map(t => t.name) : draftTools()
  createProfile(base, mode, tools)
}

async function removeProfile() {
  if (!pm.confirmDelete) {
    pm.confirmDelete = true
    renderEditorHead()
    return
  }
  const name = pm.selected
  try {
    const result = await deleteProfile(name)
    if (!result.success) throw new Error(result.error || 'Delete failed')
  } catch (err) {
    pm.error = err.message
    renderFooter()
    return
  }
  delete state.profiles[name]
  if (state.activeProfile === name) state.activeProfile = DEFAULT
  renderProfileSelector()
  loadDraft(state.activeProfile)
  render()
}

function setGroup(server, on) {
  for (const t of pm.universe) {
    if (groupKey(t) !== server) continue
    if (on) pm.draft.enabled.add(t.name)
    else pm.draft.enabled.delete(t.name)
  }
  syncCheckboxes()
}

function setAll(on) {
  pm.draft.enabled = on ? new Set(pm.universe.map(t => t.name)) : new Set()
  syncCheckboxes()
}

// ─── Rendering ──────────────────────────────────────────────────────────────

let groupKeyCache = new Map()
function groupKey(tool) {
  return groupKeyCache.get(tool.name)
}

function render() {
  renderList()
  renderEditor()
}

function renderList() {
  const list = document.getElementById('pmList')
  let html = ''
  for (const [name, profile] of Object.entries(state.profiles)) {
    const isActive = name === state.activeProfile
    const isSel = name === pm.selected
    const count = profile.tools?.length || 0
    const meta = name === DEFAULT
      ? 'Every tool, unfiltered'
      : profile.mode === 'blocklist'
        ? `Blocks ${count} tool${count === 1 ? '' : 's'}`
        : `Allows ${count} tool${count === 1 ? '' : 's'}`
    html += `<button class="pm-list-item${isSel ? ' selected' : ''}" data-action="select" data-name="${escAttr(name)}">`
    html += `<span class="pm-list-name">${escapeHtml(name)}${isSel && isDirty() ? ' <span class="pm-dirty-dot" title="Unsaved changes"></span>' : ''}</span>`
    html += `<span class="pm-list-meta">${isActive ? '<span class="pm-active-tag">Active</span>' : ''}${meta}</span>`
    html += `</button>`
  }
  list.innerHTML = html
}

function renderEditor() {
  const editor = document.getElementById('pmEditor')
  const isDefault = pm.selected === DEFAULT

  let html = `<div class="pm-editor-head" id="pmEditorHead"></div>`

  html += `<div class="pm-mode-row">`
  if (isDefault) {
    html += `<div class="pm-hint">The default profile sends every tool. Duplicate it to make a filtered profile.</div>`
  } else {
    const allow = pm.draft.mode !== 'blocklist'
    html += `<div class="pm-mode-toggle">`
    html += `<button class="${allow ? 'active' : ''}" data-action="mode" data-mode="allowlist">Allowlist</button>`
    html += `<button class="${!allow ? 'active' : ''}" data-action="mode" data-mode="blocklist">Blocklist</button>`
    html += `</div>`
    html += `<div class="pm-hint">${allow
      ? 'Only checked tools are sent. Tools that appear later are blocked until you add them.'
      : 'Unchecked tools are removed. Tools that appear later are allowed.'}</div>`
  }
  html += `</div>`

  html += `<div class="pm-tools-bar">`
  html += `<div class="modal-tools-header-left" id="pmCount"></div>`
  html += `<input class="pm-filter" id="pmFilter" type="text" placeholder="Filter tools..." value="${escAttr(pm.filter)}" />`
  if (!isDefault) {
    html += `<button class="btn-secondary pm-small-btn" data-action="all">All</button>`
    html += `<button class="btn-secondary pm-small-btn" data-action="none">None</button>`
  }
  html += `</div>`

  html += `<div class="pm-tools" id="pmTools">${renderTools(isDefault)}</div>`
  html += `<div class="pm-footer" id="pmFooter"></div>`

  editor.innerHTML = html
  renderEditorHead()
  syncCheckboxes()
  applyFilter()
  renderFooter()
}

function renderEditorHead() {
  const head = document.getElementById('pmEditorHead')
  if (!head) return
  const isDefault = pm.selected === DEFAULT
  const isActive = pm.selected === state.activeProfile

  let html = `<input class="pm-name-input" id="pmName" type="text" value="${escAttr(pm.draft.name)}" ${isDefault ? 'disabled' : ''} spellcheck="false" />`
  html += `<div class="pm-head-actions">`
  html += isActive
    ? `<span class="pm-active-tag pm-active-tag--lg">Active</span>`
    : `<button class="btn-primary pm-btn" data-action="activate" title="Use this profile for new requests">Set active</button>`
  html += `<button class="btn-secondary pm-btn" data-action="duplicate">${isDirty() ? 'Save as copy' : 'Duplicate'}</button>`
  if (!isDefault) {
    html += `<button class="btn-secondary pm-btn pm-btn-danger${pm.confirmDelete ? ' confirm' : ''}" data-action="delete">${pm.confirmDelete ? 'Confirm delete' : 'Delete'}</button>`
  }
  html += `</div>`
  head.innerHTML = html
}

function renderTools(isDefault) {
  if (pm.universe.length === 0) {
    return `<div class="pm-empty">No tools seen yet. Send a request through Jannal and its tools will show up here.</div>`
  }

  const groups = groupToolsByServer(pm.universe)
  groupKeyCache = new Map()
  const sections = [['MCP Servers', []], ['Other Tools', []]]
  for (const [server, tools] of groups) {
    for (const t of tools) groupKeyCache.set(t.name, server)
    sections[server === 'other' ? 1 : 0][1].push([server, tools])
  }

  let html = ''
  for (const [title, sectionGroups] of sections) {
    if (sectionGroups.length === 0) continue
    html += `<div class="pm-section"><div class="tool-section-header">${title}</div>`
    for (const [server, tools] of sectionGroups) {
      const sorted = [...tools].sort((a, b) => estimateToolTokens(b) - estimateToolTokens(a))
      const displayName = server === 'other' ? 'Other' : server.charAt(0).toUpperCase() + server.slice(1)
      const open = pm.expanded.has(server)
      html += `<div class="tool-group" data-server="${escAttr(server)}">`
      html += `<div class="tool-group-header" data-action="accordion" data-server="${escAttr(server)}">`
      html += `<input type="checkbox" class="pm-group-cb" data-server="${escAttr(server)}" ${isDefault ? 'disabled' : ''}>`
      html += `<span class="tool-group-chevron${open ? ' expanded' : ''}">&#9654;</span>`
      html += `<div class="tool-group-title"><span class="tool-group-name">${escapeHtml(displayName)}</span><span class="tool-group-meta" data-meta="${escAttr(server)}"></span></div>`
      if (!isDefault) {
        html += `<div class="tool-group-actions">`
        html += `<button class="btn-secondary pm-small-btn" data-action="group" data-server="${escAttr(server)}" data-value="1">All</button>`
        html += `<button class="btn-secondary pm-small-btn" data-action="group" data-server="${escAttr(server)}" data-value="0">None</button>`
        html += `</div>`
      }
      html += `</div>`
      html += `<div class="tool-group-body${open ? '' : ' collapsed'}">`
      for (const tool of sorted) {
        const desc = (tool.description || '').slice(0, 120)
        html += `<label class="tool-card" data-tool-name="${escAttr(tool.name)}">`
        html += `<input type="checkbox" class="pm-tool-cb" data-tool="${escAttr(tool.name)}" ${isDefault ? 'disabled' : ''}>`
        html += `<div class="tool-card-info">`
        html += `<div class="tool-card-name">${escapeHtml(tool.name)}${tool._unseen ? ' <span class="never-used-tag" title="In this profile but not seen in recent requests. Kept as-is.">not seen</span>' : ''}</div>`
        if (desc) html += `<div class="tool-card-desc">${escapeHtml(desc)}</div>`
        html += `</div>`
        html += `<div class="tool-card-tokens">${tool._unseen ? '—' : '~' + fmt(estimateToolTokens(tool)) + ' tok'}</div>`
        html += `</label>`
      }
      html += `</div></div>`
    }
    html += `</div>`
  }
  return html
}

/** Push draft.enabled into the DOM checkboxes, group states and counts */
function syncCheckboxes() {
  const root = document.getElementById('pmTools')
  if (!root) return
  root.querySelectorAll('.pm-tool-cb').forEach(cb => {
    cb.checked = pm.draft.enabled.has(cb.dataset.tool)
  })
  updateGroupStates()
  updateSummary()
}

function updateGroupStates() {
  const root = document.getElementById('pmTools')
  if (!root) return
  const totals = new Map()
  for (const t of pm.universe) {
    const key = groupKey(t)
    const entry = totals.get(key) || { total: 0, on: 0, tokens: 0, unseen: 0 }
    entry.total++
    if (pm.draft.enabled.has(t.name)) entry.on++
    if (t._unseen) entry.unseen++
    else entry.tokens += estimateToolTokens(t)
    totals.set(key, entry)
  }
  root.querySelectorAll('.pm-group-cb').forEach(cb => {
    const e = totals.get(cb.dataset.server)
    if (!e) return
    cb.checked = e.on === e.total
    cb.indeterminate = e.on > 0 && e.on < e.total
  })
  root.querySelectorAll('[data-meta]').forEach(el => {
    const e = totals.get(el.dataset.meta)
    if (!e) return
    // Token costs are only known for tools we have definitions for
    el.textContent = e.unseen === e.total
      ? `${e.on}/${e.total} tools · not seen recently`
      : `${e.on}/${e.total} tools · ~${fmt(e.tokens)} tok`
  })
}

function updateSummary() {
  let onTokens = 0
  let offTokens = 0
  for (const t of pm.universe) {
    if (t._unseen) continue
    if (pm.draft.enabled.has(t.name)) onTokens += estimateToolTokens(t)
    else offTokens += estimateToolTokens(t)
  }
  const count = document.getElementById('pmCount')
  if (count) {
    count.innerHTML = `<strong>${pm.draft.enabled.size}</strong> of <strong>${pm.universe.length}</strong> tools enabled · ~${fmt(onTokens)} tok`
      + (offTokens > 0 ? ` · <span class="pm-saves">saves ~${fmt(offTokens)} tok/request</span>` : '')
  }
  // The list's dirty dot and the Duplicate/Save-as-copy label depend on dirtiness
  renderList()
  renderEditorHead()
  renderFooter()
}

function renderFooter() {
  const footer = document.getElementById('pmFooter')
  if (!footer) return
  const dirty = isDirty()

  if (pm.pendingSwitch != null && dirty) {
    const target = pm.pendingSwitch === CLOSE ? 'closing' : `switching to “${escapeHtml(pm.pendingSwitch)}”`
    footer.innerHTML = `<div class="pm-footer-msg pm-footer-warn">Unsaved changes to “${escapeHtml(pm.selected)}” — save before ${target}?</div>`
      + `<button class="btn-secondary pm-btn" data-action="cancel-switch">Cancel</button>`
      + `<button class="btn-secondary pm-btn" data-action="discard-switch">Discard</button>`
      + `<button class="btn-primary pm-btn" data-action="save-switch">Save</button>`
    return
  }

  let html = `<div class="pm-footer-msg${pm.error ? ' pm-footer-error' : ''}">${pm.error ? escapeHtml(pm.error) : (dirty ? 'Unsaved changes' : '')}</div>`
  if (pm.selected !== DEFAULT) {
    html += `<button class="btn-secondary pm-btn" data-action="revert" ${dirty ? '' : 'disabled'}>Revert</button>`
    html += `<button class="btn-primary pm-btn" data-action="save" ${dirty ? '' : 'disabled'}>Save</button>`
  }
  footer.innerHTML = html
}

function applyFilter() {
  const q = pm.filter.trim().toLowerCase()
  document.querySelectorAll('#pmTools .tool-group').forEach(group => {
    let visible = 0
    group.querySelectorAll('.tool-card').forEach(card => {
      const text = card.textContent.toLowerCase()
      const match = !q || text.includes(q)
      card.style.display = match ? '' : 'none'
      if (match) visible++
    })
    group.style.display = visible > 0 ? '' : 'none'
    const body = group.querySelector('.tool-group-body')
    const chevron = group.querySelector('.tool-group-chevron')
    const open = q ? visible > 0 : pm.expanded.has(group.dataset.server)
    body?.classList.toggle('collapsed', !open)
    chevron?.classList.toggle('expanded', open)
  })
  document.querySelectorAll('#pmTools .pm-section').forEach(section => {
    const anyVisible = [...section.querySelectorAll('.tool-group')].some(g => g.style.display !== 'none')
    section.style.display = anyVisible ? '' : 'none'
  })
}

// ─── Event wiring ───────────────────────────────────────────────────────────

export function initProfileManager() {
  const overlay = document.getElementById('profileManagerOverlay')

  document.getElementById('profileManageBtn').addEventListener('click', () => openProfileManager())
  document.getElementById('pmCloseBtn').addEventListener('click', () => closeProfileManager())
  document.getElementById('pmNewBtn').addEventListener('click', newProfile)

  overlay.addEventListener('click', async (e) => {
    if (e.target === overlay) { closeProfileManager(); return }
    const el = e.target.closest('[data-action]')
    if (!el || !overlay.contains(el)) return
    // Checkbox clicks inside a group header shouldn't toggle the accordion
    if (el.dataset.action === 'accordion' && e.target.matches('input, button')) return

    switch (el.dataset.action) {
      case 'select': selectProfile(el.dataset.name); break
      case 'activate': onProfileChange(pm.selected); break
      case 'duplicate': duplicateProfile(); break
      case 'delete': removeProfile(); break
      case 'save': await save(); break
      case 'revert': loadDraft(pm.selected); render(); break
      case 'mode':
        pm.draft.mode = el.dataset.mode
        renderEditor()
        break
      case 'all': setAll(true); break
      case 'none': setAll(false); break
      case 'group': setGroup(el.dataset.server, el.dataset.value === '1'); break
      case 'accordion': {
        const server = el.dataset.server
        if (pm.expanded.has(server)) pm.expanded.delete(server)
        else pm.expanded.add(server)
        applyFilter()
        break
      }
      case 'cancel-switch': pm.pendingSwitch = null; renderFooter(); break
      case 'discard-switch': pm.snapshot = serializeDraft(); resolvePendingSwitch(); break
      case 'save-switch': {
        const target = pm.pendingSwitch
        pm.pendingSwitch = null
        if (await save()) { pm.pendingSwitch = target; resolvePendingSwitch() }
        break
      }
    }
  })

  overlay.addEventListener('change', (e) => {
    const cb = e.target
    if (cb.classList.contains('pm-tool-cb')) {
      if (cb.checked) pm.draft.enabled.add(cb.dataset.tool)
      else pm.draft.enabled.delete(cb.dataset.tool)
      pm.confirmDelete = false
      updateGroupStates()
      updateSummary()
    } else if (cb.classList.contains('pm-group-cb')) {
      setGroup(cb.dataset.server, cb.checked)
    }
  })

  overlay.addEventListener('input', (e) => {
    if (e.target.id === 'pmName') {
      pm.draft.name = e.target.value
      pm.error = ''
      // Keep focus in the input: only touch the list, footer and duplicate label
      renderList()
      renderFooter()
      const dup = overlay.querySelector('[data-action="duplicate"]')
      if (dup) dup.textContent = isDirty() ? 'Save as copy' : 'Duplicate'
    } else if (e.target.id === 'pmFilter') {
      pm.filter = e.target.value
      applyFilter()
    }
  })

  overlay.addEventListener('keydown', (e) => {
    if (e.target.id === 'pmName' && e.key === 'Enter') { e.preventDefault(); save() }
  })
}
