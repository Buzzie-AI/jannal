import { state } from './state.js'
import { getSegColor, getSegLabel, fmt, fmtCost, inputRate, escapeHtml } from './utils.js'
import { getDailyCost, getDailySavings } from './session.js'

// ─── Render ─────────────────────────────────────────────────────────────────

export function renderAll(opts = {}) {
  renderStatus()
  renderContextBar()
  renderTokenChart()
  renderSessionTabs()
  renderReqList()
  // Only re-render detail if the selected request's data changed,
  // or if explicitly requested (e.g. user clicked a different request).
  if (!opts.skipDetail) renderDetail()
  renderExportButton()
  renderStripBadge()
}

function renderStripBadge() {
  const badge = document.getElementById('stripBadge')
  if (badge) badge.style.display = state.strip.mode !== 'off' ? 'flex' : 'none'
}

function renderExportButton() {
  const btn = document.getElementById('exportBtn')
  if (btn) {
    btn.disabled = state.reqs.length === 0
    btn.title = state.reqs.length === 0 ? 'No data to export' : 'Export session as JSON or CSV'
  }
}

/**
 * Returns array of { originalIndex, req } filtered by active session tab.
 * When activeSessionTab is null ("All"), returns all requests.
 */
export function getFilteredReqs() {
  const result = []
  for (let i = 0; i < state.reqs.length; i++) {
    const req = state.reqs[i]
    if (state.activeSessionTab === null || req.tabKey === state.activeSessionTab) {
      result.push({ originalIndex: i, req })
    }
  }
  return result
}

export function renderSessionTabs() {
  const el = document.getElementById('sessionTabs')
  if (!el) return
  const sessionIds = Object.keys(state.sessions)
  if (sessionIds.length === 0) {
    el.classList.remove('visible')
    return
  }
  el.classList.add('visible')

  let html = `<div class="session-tab${state.activeSessionTab === null ? ' active' : ''}" data-tab="">All</div>`
  for (const sid of sessionIds) {
    const s = state.sessions[sid]
    const isActive = state.activeSessionTab === sid
    html += `<div class="session-tab${isActive ? ' active' : ''}" data-tab="${escapeHtml(sid)}">`
    html += `<span class="session-tab-label">${escapeHtml(s.label)}</span>`
    if (s.path) html += `<span class="session-tab-path">${escapeHtml(s.path)}</span>`
    html += `<span class="session-tab-close" data-tab-close="${escapeHtml(sid)}">&times;</span>`
    html += `</div>`
  }
  el.innerHTML = html

  // Bind click handlers via delegation (avoids inline onclick with special chars in paths)
  el.onclick = (e) => {
    const closeBtn = e.target.closest('[data-tab-close]')
    if (closeBtn) {
      e.stopPropagation()
      window.dismissSessionTab(closeBtn.dataset.tabClose)
      return
    }
    const tab = e.target.closest('[data-tab]')
    if (tab) {
      window.selectSessionTab(tab.dataset.tab || null)
    }
  }
}

export function renderStatus() {
  document.getElementById('statusDot').className = `status-dot ${state.connected ? 'connected' : 'disconnected'}`
  const text = document.getElementById('statusText')
  text.textContent = state.connected ? 'Connected' : 'Disconnected'
  text.style.color = state.connected ? 'var(--green)' : 'var(--red)'
  const reqBadge = document.getElementById('reqBadge')
  if (reqBadge) reqBadge.textContent = `Req ${state.reqs.length}`

  // Daily metrics (persisted across eviction/reload/reconnect)
  const dailyCost = getDailyCost()
  const costEl = document.getElementById('dailyCost')
  if (costEl) costEl.textContent = `Cost: ${fmtCost(dailyCost)}`

  const savedEl = document.getElementById('dailySaved')
  if (savedEl) {
    if (!state.premium) {
      savedEl.textContent = 'Saved: Pro'
      savedEl.className = 'daily-saved premium-locked'
      savedEl.title = 'Savings intelligence requires Pro'
    } else {
      const { cost: savedCost, tokens: savedTokens } = getDailySavings()
      const tokenStr = savedTokens > 0 ? ` (${fmt(savedTokens)})` : ''
      savedEl.textContent = `Saved: ${fmtCost(savedCost)}${tokenStr}`
      savedEl.className = 'daily-saved'
      savedEl.classList.toggle('has-savings', savedCost > 0)
      savedEl.title = 'Estimated daily savings from router intelligence'
    }
  }

  // Router badge
  const badge = document.getElementById('routerBadge')
  if (badge) {
    if (!state.premium) {
      badge.textContent = 'Router Pro'
      badge.className = 'router-badge premium-locked'
      // Disable popover options
      const popover = document.getElementById('routerPopover')
      if (popover) {
        for (const btn of popover.querySelectorAll('.router-popover-opt')) {
          btn.classList.add('premium-locked')
          btn.classList.remove('active')
        }
      }
    } else {
      const mode = state.routerMode || 'off'
      const labels = { off: 'Router Off', shadow: 'Router Shadow', auto: 'Router Auto' }
      badge.textContent = labels[mode] || 'Router'
      badge.className = `router-badge router-badge--${mode}`

      // Mark active option in popover
      const popover = document.getElementById('routerPopover')
      if (popover) {
        for (const btn of popover.querySelectorAll('.router-popover-opt')) {
          btn.classList.toggle('active', btn.dataset.mode === mode)
          btn.classList.remove('premium-locked')
        }
      }
    }
  }
}

export function renderContextBar() {
  const req = state.selectedReq !== null ? state.reqs[state.selectedReq] : null
  const barInner = document.getElementById('barInner')
  const barOuter = document.getElementById('barOuter')

  if (!req) {
    barInner.innerHTML = '<div class="bar-empty"><span>No data yet</span></div>'
    barOuter.className = 'bar-outer'
    document.getElementById('barLegend').innerHTML = ''
    document.getElementById('barTotal').textContent = '0 / 0'
    document.getElementById('barPct').textContent = '0%'
    return
  }

  const budget = req.budget
  const total = req.actualUsage ? req.actualUsage.input_tokens : req.totalEstimatedTokens
  const fillPct = (total / budget) * 100
  barOuter.className = 'bar-outer' + (fillPct > 95 ? ' pressure-critical' : fillPct > 80 ? ' pressure-high' : '')

  // Auto-zoom: when fill% is low, scale colored segments up so they're readable
  const ZOOM_THRESHOLD = 30
  const ZOOM_TARGET = 65
  let zoomScale = 1
  let breakOpacity = 0
  if (fillPct > 0 && fillPct < ZOOM_THRESHOLD) {
    const blend = Math.pow(1 - fillPct / ZOOM_THRESHOLD, 2)
    const effectiveTarget = fillPct + (ZOOM_TARGET - fillPct) * blend
    zoomScale = effectiveTarget / fillPct
    breakOpacity = blend
  }
  const zoomed = zoomScale > 1

  // Group consecutive segments of the same color, but only merge tiny ones (< 0.3% of bar)
  // so that each visible segment remains individually clickable with correct token count
  const groups = []
  for (let i = 0; i < req.segments.length; i++) {
    const seg = req.segments[i]
    const color = getSegColor(seg)
    const rawW = (seg.tokens / budget) * 100 * zoomScale
    const last = groups[groups.length - 1]
    if (last && last.color === color && rawW < 0.3) {
      last.tokens += seg.tokens
      last.count++
      last.endIndex = i
    } else {
      groups.push({ color, tokens: seg.tokens, name: seg.name, count: 1, startIndex: i, endIndex: i })
    }
  }

  let html = ''
  for (const g of groups) {
    const w = (g.tokens / budget) * 100 * zoomScale
    if (w < 0.1) continue
    const label = g.count > 1 ? `${g.name} (×${g.count})` : g.name
    html += `<div class="bar-segment" style="width:${w}%;background:linear-gradient(180deg,${g.color}cc,${g.color}88);border-right:1.5px solid var(--bg3)" title="${label}: ${fmt(g.tokens)} tokens" onclick="openModal(${g.startIndex})">`
    if (w > 5) html += `<span>${w > 15 ? label : fmt(g.tokens)}</span>`
    html += '</div>'
  }
  if (zoomed) html += `<div class="bar-break" style="opacity:${breakOpacity}"></div>`
  if (fillPct < 100) html += `<div class="bar-empty"><span>${fmt(budget - total)} free</span></div>`
  barInner.innerHTML = html

  // Hide bar markers when zoom is active — thresholds are irrelevant at <30% utilization
  barOuter.querySelectorAll('.bar-marker').forEach(el => { el.style.display = zoomed ? 'none' : '' })

  const seen = new Map()
  for (const seg of req.segments) { const k = getSegLabel(seg), c = getSegColor(seg); if (!seen.has(k)) seen.set(k, c) }
  document.getElementById('barLegend').innerHTML = Array.from(seen.entries()).map(([l, c]) => `<div class="legend-item"><div class="legend-dot" style="background:${c}"></div>${l}</div>`).join('')

  const totalLabel = req.actualUsage ? fmt(req.actualUsage.input_tokens) : (req.tokenCountSource === 'count_tokens' ? fmt(req.totalEstimatedTokens) : `~${fmt(req.totalEstimatedTokens)}`)
  const bt = document.getElementById('barTotal'), bp = document.getElementById('barPct')
  bt.textContent = `${totalLabel} / ${fmt(budget)}`
  bt.style.color = fillPct > 95 ? 'var(--red)' : fillPct > 80 ? 'var(--orange)' : 'var(--text)'
  bp.textContent = `${fillPct.toFixed(1)}%`
  bp.style.color = fillPct > 95 ? 'var(--red)' : fillPct > 80 ? 'var(--orange)' : 'var(--text3)'
}

export function renderTokenChart() {
  const container = document.getElementById('tokenChartContainer')
  const chart = document.getElementById('tokenChart')
  if (!container || !chart) return

  const filtered = getFilteredReqs()
  if (filtered.length < 2) {
    container.style.display = 'none'
    return
  }

  container.style.display = 'block'
  const values = filtered.map(f => f.req.actualUsage?.input_tokens ?? f.req.totalEstimatedTokens ?? 0)
  const maxVal = Math.max(...values)
  const minVal = Math.min(...values)
  const range = maxVal - minVal || 1
  const height = 36
  const width = 200

  // SVG sparkline
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width
    const y = height - ((v - minVal) / range) * (height - 4) - 2
    return `${x},${y}`
  }).join(' ')

  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="token-chart-svg">
      <polyline
        fill="none"
        stroke="var(--cyan)"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        points="${points}"
      />
    </svg>
    <div class="token-chart-hint">${values.length} reqs · ${fmt(minVal)} → ${fmt(maxVal)} tokens</div>
  `
}

function getClaudeCommand() {
  const port = location.port === '5173' ? '4455' : (location.port || '4455')
  return `ANTHROPIC_BASE_URL=http://localhost:${port} claude`
}

export function copyClaudeCommand() {
  navigator.clipboard.writeText(getClaudeCommand()).then(() => {
    const btn = document.getElementById('copyCommandBtn')
    if (btn) {
      const orig = btn.textContent
      btn.textContent = 'Copied!'
      btn.style.color = 'var(--green)'
      setTimeout(() => { btn.textContent = orig; btn.style.color = '' }, 1500)
    }
  })
}

export function renderReqList() {
  const el = document.getElementById('reqList')
  const filtered = getFilteredReqs()
  if (filtered.length === 0) {
    if (state.reqs.length === 0) {
      const cmd = getClaudeCommand()
      el.innerHTML = `<div class="empty"><div class="empty-icon waiting">&#x1F50D;</div><h2>Waiting for requests...</h2><p>Start Claude Code with:<br><code style="color:var(--cyan);font-size:11px">${cmd}</code> <button id="copyCommandBtn" class="copy-command-btn" onclick="copyClaudeCommand()" title="Copy to clipboard">Copy</button></p></div>`
    } else {
      el.innerHTML = `<div class="empty"><div class="empty-icon">&#x1F50D;</div><h2>No requests in this session</h2></div>`
    }
    return
  }

  // Update toggle button state
  const toggleBtn = document.getElementById('viewToggleBtn')
  if (toggleBtn) {
    toggleBtn.textContent = state.groupView ? 'Grouped' : 'Flat'
    toggleBtn.classList.toggle('active', state.groupView)
  }

  // Preserve scroll position across re-renders
  const scrollTop = el.scrollTop

  if (state.groupView && Object.keys(state.groups).length > 0) {
    renderGroupedList(el, filtered)
  } else {
    renderFlatList(el, filtered)
  }

  el.scrollTop = scrollTop
}

function renderFlatList(el, filtered) {
  let html = ''
  for (let j = filtered.length - 1; j >= 0; j--) {
    html += renderReqCard(filtered[j].originalIndex, j + 1)
  }
  el.innerHTML = html
}

function renderReqCard(i, displayNum) {
  const t = state.reqs[i]
  const total = t.actualUsage ? t.actualUsage.input_tokens : t.totalEstimatedTokens
  const fillPct = Math.min((total / t.budget) * 100, 100)
  const color = fillPct > 95 ? 'var(--red)' : fillPct > 80 ? 'var(--orange)' : 'var(--green)'

  // Short model name: claude-opus-4-6 → opus-4-6, claude-haiku-4-5-20251001 → haiku-4-5
  const shortModel = t.model.replace('claude-', '').replace(/-\d{8,}$/, '')

  const tokenLabel = t.actualUsage ? fmt(t.actualUsage.input_tokens) : (t.tokenCountSource === 'count_tokens' ? fmt(t.totalEstimatedTokens) : '~' + fmt(t.totalEstimatedTokens))

  // Compact in/out display
  let ioLabel = ''
  if (t.actualUsage) {
    ioLabel = `${fmt(t.actualUsage.input_tokens)} in / ${fmt(t.actualUsage.output_tokens)} out`
  }

  const cost = t.actualCost ? fmtCost(t.actualCost.totalCost) : t.estimatedCost ? '~' + fmtCost(t.estimatedCost.totalCost) : ''

  let html = `<div class="req-card${i === state.selectedReq ? ' selected' : ''}" onclick="selectReq(${i})">`
  // Row 1: Req N + token size + mini bar
  const reqNum = displayNum != null ? displayNum : t.turn
  html += `<div class="req-card-head"><span class="req-label">Req ${reqNum}</span><span class="req-tokens" style="color:${color}">${tokenLabel}</span></div>`
  html += `<div class="req-mini-bar"><div class="req-mini-fill" style="width:${fillPct}%;background:${color}"></div></div>`
  // Row 2: model | in/out | cost
  html += `<div class="req-meta"><span>${shortModel}</span>`
  if (ioLabel) html += `<span class="req-io">${ioLabel}</span>`
  if (cost) html += `<span class="req-cost-inline">${cost}</span>`
  html += `</div>`
  html += `</div>`
  return html
}

function renderGroupedList(el, filtered) {
  // Build set of filtered original indices for quick lookup
  const filteredSet = new Set(filtered.map(f => f.originalIndex))
  // Build per-session display number map (1-based, ordered by appearance)
  const displayNumMap = new Map()
  let counter = 0
  for (const f of filtered) {
    displayNumMap.set(f.originalIndex, ++counter)
  }

  // Get group IDs sorted by most recent first
  const groupIds = Object.keys(state.groups)
    .map(Number)
    .sort((a, b) => b - a)

  let html = ''
  for (const gid of groupIds) {
    const group = state.groups[gid]

    // Filter group's reqIndices to only those matching the session filter
    const visibleIndices = group.reqIndices.filter(ri => filteredSet.has(ri))
    if (visibleIndices.length === 0) continue

    const expanded = state.expandedGroups[gid] !== false // default to expanded for first

    // Compute group totals (only for visible requests)
    let totalCost = 0
    let totalTokens = 0
    for (const ri of visibleIndices) {
      const t = state.reqs[ri]
      if (!t) continue
      if (t.actualCost) totalCost += t.actualCost.totalCost
      else if (t.estimatedCost) totalCost += t.estimatedCost.totalCost
      totalTokens += t.actualUsage?.input_tokens ?? t.totalEstimatedTokens ?? 0
    }

    const reqCount = visibleIndices.length
    const turnNum = gid + 1

    // Group header
    html += `<div class="group-card">`
    html += `<div class="group-header" onclick="toggleGroup(${gid})">`
    html += `<span class="group-chevron ${expanded ? 'expanded' : ''}">&#9654;</span>`
    html += `<span class="group-title">Turn ${turnNum}</span>`
    html += `<div class="group-summary">`
    html += `<span class="group-tokens">${fmt(totalTokens)}</span>`
    html += `<span class="group-cost">${fmtCost(totalCost)}</span>`
    html += `<span class="group-req-count">${reqCount} req${reqCount !== 1 ? 's' : ''}</span>`
    html += `</div></div>`

    // Children
    html += `<div class="group-children ${expanded ? '' : 'collapsed'}">`

    // Check if this group has multiple sessions (among visible requests)
    const visibleSessions = {}
    for (const ri of visibleIndices) {
      const t = state.reqs[ri]
      const sh = t?.sessionHash || 'unknown'
      if (!visibleSessions[sh]) visibleSessions[sh] = { reqIndices: [], model: t?.model || 'unknown' }
      visibleSessions[sh].reqIndices.push(ri)
    }
    const sessionKeys = Object.keys(visibleSessions)
    const isMultiSession = sessionKeys.length > 1

    if (isMultiSession) {
      const sorted = sessionKeys.sort((a, b) => {
        return visibleSessions[b].reqIndices.length - visibleSessions[a].reqIndices.length
      })

      let sessionNum = 0
      for (const sh of sorted) {
        const session = visibleSessions[sh]
        const model = session.model || 'unknown'
        const isMain = sessionNum === 0
        const label = isMain ? 'Main' : 'Subagent'
        const pillClass = isMain ? 'main' : 'subagent'

        html += `<div class="group-session-label">`
        html += `<span class="session-pill ${pillClass}">${label}</span>`
        html += `<span>${model} · ${session.reqIndices.length} req${session.reqIndices.length !== 1 ? 's' : ''}</span>`
        html += `</div>`

        for (let k = session.reqIndices.length - 1; k >= 0; k--) {
          html += renderReqCard(session.reqIndices[k], displayNumMap.get(session.reqIndices[k]))
        }
        sessionNum++
      }
    } else {
      for (let k = visibleIndices.length - 1; k >= 0; k--) {
        html += renderReqCard(visibleIndices[k], displayNumMap.get(visibleIndices[k]))
      }
    }

    // Time range
    const start = new Date(group.startTime).toLocaleTimeString()
    const end = new Date(group.endTime).toLocaleTimeString()
    const timeLabel = start === end ? start : `${start} – ${end}`
    html += `<div class="group-time">${timeLabel}</div>`

    html += `</div></div>`
  }

  el.innerHTML = html
}

export function renderSettings() {
  const el = document.getElementById('settingsBody')
  const overlay = document.getElementById('settingsOverlay')

  const s = state.strip
  const checked = (mode) => s.mode === mode ? 'checked' : ''

  el.innerHTML = `<div class="settings-view">
    <div class="settings-section">
      <div class="settings-section-title">Smart Strip</div>
      <div class="settings-section-desc">Reduce token usage by stripping tool call/result messages from past conversation turns. Only the user message and final assistant response are kept.</div>
      <div class="settings-radio">
        <label><input type="radio" name="stripMode" value="off" ${checked('off')}> Off <span style="color:var(--text3);font-size:10px">— no modification</span></label>
        <label><input type="radio" name="stripMode" value="keep_n" ${checked('keep_n')}> Keep last <input type="number" class="settings-inline-input" id="stripKeepN" value="${s.keepN}" min="1" max="20"> turns intact</label>
        <label><input type="radio" name="stripMode" value="strip_all" ${checked('strip_all')}> Strip all past turns <span style="color:var(--text3);font-size:10px">— most aggressive</span></label>
        <label><input type="radio" name="stripMode" value="smart_size" ${checked('smart_size')}> Strip turns over <input type="number" class="settings-inline-input" id="stripThreshold" value="${s.threshold}" min="100" step="500"> tokens</label>
      </div>
      ${s.mode !== 'off' ? '<div class="settings-savings">Smart Strip is active. Savings will appear per request in the context bar.</div>' : ''}
    </div>
  </div>`

  if (state.showSettings) overlay.classList.add('open')
  else overlay.classList.remove('open')
}

export function renderDetail() {
  const el = document.getElementById('detailBody')
  const title = document.getElementById('detailTitle')
  const meta = document.getElementById('detailMeta')

  if (state.selectedReq === null || !state.reqs[state.selectedReq]) {
    title.textContent = 'Segment Breakdown'
    meta.textContent = ''
    el.innerHTML = '<div class="empty"><div class="empty-icon">&#x1F4CA;</div><h2>No request selected</h2><p>Click a request on the left to see its context breakdown.</p></div>'
    return
  }

  const req = state.reqs[state.selectedReq]
  title.textContent = `Req ${req.turn} — Segment Breakdown`
  meta.textContent = `${req.model} | ${req.segments.length} segments | ${req.messageCount} messages`

  let html = ''

  // Stats grid — compact multi-column layout for stat cards
  html += `<div class="stats-grid">`

  // System prompt size warning
  const systemSeg = req.segments?.find(s => s.type === 'system')
  if (systemSeg && req.budget) {
    const systemPct = (systemSeg.tokens / req.budget) * 100
    if (systemPct > 15) {
      html += `<div class="warning-box">`
      html += `<div class="warning-box-title">System prompt is large</div>`
      html += `<div class="usage-row"><span class="usage-label">System prompt</span><span class="usage-value" style="color:var(--orange)">${fmt(systemSeg.tokens)} tokens (${systemPct.toFixed(1)}% of context)</span></div>`
      html += `<div style="margin-top:6px;font-size:10px;color:var(--text3)">Consider trimming to free context for conversation.</div>`
      html += `</div>`
    }
  }

  // Filtering info
  if (req.filteringActive && req.removedTools && req.removedTools.length > 0) {
    html += `<div class="filter-box">`
    html += `<div class="filter-box-title">Filtering Active</div>`
    html += `<div class="usage-row"><span class="usage-label">Original tools</span><span class="usage-value" style="color:var(--text2)">${req.originalToolCount}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">After filtering</span><span class="usage-value" style="color:var(--green)">${req.filteredToolCount}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Removed</span><span class="usage-value" style="color:var(--orange)">${req.removedTools.length} tools</span></div>`
    if (req.tokensSaved) {
      html += `<div class="usage-row"><span class="usage-label">Tokens saved</span><span class="usage-value" style="color:var(--green)">~${fmt(req.tokensSaved)}</span></div>`
    }
    html += `</div>`
  }

  // Router decision (premium gate — short-circuit before rendering any router details)
  if (!state.premium) {
    html += `<div class="router-box premium-locked">`
    html += `<div class="router-box-title">Router Intelligence</div>`
    html += `<div class="premium-locked-msg">Intelligent routing, savings analysis, and auto-filtering.<br>Available in Pro.</div>`
    html += `</div>`
  } else if (req.router) {
    const r = req.router
    const modeLabel = r.mode === 'shadow' ? 'Shadow (observe only)' : r.mode === 'auto' ? 'Auto' : r.mode || 'off'

    html += `<div class="router-box">`
    html += `<div class="router-box-title">Router Decision</div>`
    html += `<div class="usage-row"><span class="usage-label">Mode</span><span class="usage-value router-mode-${r.mode}">${modeLabel}</span></div>`

    if (r.eligible) {
      const isShadow = r.mode === 'shadow'
      html += `<div class="usage-row"><span class="usage-label">Matched by</span><span class="usage-value" style="color:var(--cyan)">${escapeHtml(r.matched_by || '\u2014')}</span></div>`
      if (r.confidence != null) {
        const confColor = r.confidence >= 0.9 ? 'var(--green)' : r.confidence >= 0.7 ? 'var(--amber)' : 'var(--orange)'
        html += `<div class="usage-row"><span class="usage-label">Confidence</span><span class="usage-value" style="color:${confColor}">${(r.confidence * 100).toFixed(0)}%</span></div>`
      }
      if (r.selected_groups && r.selected_groups.length > 0) {
        const groups = r.selected_groups.filter(g => g !== 'core').join(', ') || '\u2014'
        html += `<div class="usage-row"><span class="usage-label">${isShadow ? 'Would keep' : 'Selected groups'}</span><span class="usage-value" style="color:var(--text2);font-size:10px">${escapeHtml(groups)}</span></div>`
      }
      if (r.stripped_groups && r.stripped_groups.length > 0) {
        html += `<div class="usage-row"><span class="usage-label">${isShadow ? 'Would strip' : 'Stripped groups'}</span><span class="usage-value" style="color:var(--text3);font-size:10px">${escapeHtml(r.stripped_groups.join(', '))}</span></div>`
      }
      if (r.estimated_tokens_saved > 0) {
        const pct = req.totalEstimatedTokens > 0 ? ((r.estimated_tokens_saved / req.totalEstimatedTokens) * 100).toFixed(1) : '?'
        html += `<div class="usage-row"><span class="usage-label">${isShadow ? 'Potential savings' : 'Est. savings'}</span><span class="usage-value" style="color:var(--green)">~${fmt(r.estimated_tokens_saved)} tokens (${pct}%)</span></div>`
      }
      if (r.sticky_reused) {
        html += `<div style="margin-top:4px;font-size:9px;color:var(--purple)">Sticky route reused</div>`
      }
    } else {
      const reason = r.skip_reason === 'router_off' ? 'Router is off'
        : r.skip_reason === 'below_threshold' ? 'Below threshold'
        : r.skip_reason === 'no_request_data' ? 'No request data'
        : (r.skip_reason || 'Skipped')
      html += `<div class="usage-row"><span class="usage-label">Status</span><span class="usage-value" style="color:var(--text3)">${escapeHtml(reason)}</span></div>`
    }

    if (r.mode === 'shadow') {
      html += `<div class="router-shadow-note">All tools forwarded \u2014 shadow mode</div>`
    }
    html += `</div>`
  }

  // Usage + cost comparison
  if (req.actualUsage) {
    const u = req.actualUsage
    const cacheRead = u.cache_read_input_tokens || 0
    const cacheCreate = u.cache_creation_input_tokens || 0
    const hasCacheData = cacheRead > 0 || cacheCreate > 0
    const diff = u.input_tokens - req.totalEstimatedTokens
    const diffPct = u.input_tokens ? ((diff / u.input_tokens) * 100).toFixed(1) : '0.0'
    html += `<div class="usage-box">`
    html += `<div class="usage-row"><span class="usage-label">Estimated input</span><span class="usage-value estimated">~${req.totalEstimatedTokens.toLocaleString()}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Actual input</span><span class="usage-value actual">${u.input_tokens.toLocaleString()}</span></div>`
    if (hasCacheData) {
      html += `<div class="usage-row"><span class="usage-label" style="padding-left:12px">Cache read</span><span class="usage-value" style="color:var(--green)">${cacheRead.toLocaleString()}</span></div>`
      html += `<div class="usage-row"><span class="usage-label" style="padding-left:12px">Cache write</span><span class="usage-value" style="color:var(--cyan,var(--blue))">${cacheCreate.toLocaleString()}</span></div>`
      const uncached = Math.max(0, u.input_tokens - cacheRead - cacheCreate)
      html += `<div class="usage-row"><span class="usage-label" style="padding-left:12px">Uncached</span><span class="usage-value">${uncached.toLocaleString()}</span></div>`
    }
    html += `<div class="usage-row"><span class="usage-label">Estimation error</span><span class="usage-value" style="color:${Math.abs(parseFloat(diffPct)) < 15 ? 'var(--green)' : 'var(--orange)'}">${diff > 0 ? '+' : ''}${diff.toLocaleString()} (${diffPct}%)</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Output tokens</span><span class="usage-value">${u.output_tokens.toLocaleString()}</span></div>`
    if (req.actualCost) {
      html += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px">`
      html += `<div class="usage-row"><span class="usage-label">Input cost</span><span class="usage-value" style="color:var(--amber)">${fmtCost(req.actualCost.inputCost)}</span></div>`
      html += `<div class="usage-row"><span class="usage-label">Output cost</span><span class="usage-value" style="color:var(--amber)">${fmtCost(req.actualCost.outputCost)}</span></div>`
      html += `<div class="usage-row"><span class="usage-label">Total cost</span><span class="usage-value" style="color:var(--amber);font-size:13px">${fmtCost(req.actualCost.totalCost)}</span></div>`
      html += `</div>`
    }
    html += `</div>`
  } else if (req.estimatedCost) {
    const isExact = req.tokenCountSource === 'count_tokens'
    html += `<div class="usage-box">`
    html += `<div class="usage-row"><span class="usage-label">Input tokens ${isExact ? '(exact)' : '(est.)'}</span><span class="usage-value" style="color:${isExact ? 'var(--green)' : 'var(--text2)'}">${isExact ? '' : '~'}${req.totalEstimatedTokens.toLocaleString()}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Input cost ${isExact ? '' : '(est.)'}</span><span class="usage-value" style="color:${isExact ? 'var(--amber)' : 'var(--text3)'}">${isExact ? '' : '~'}${fmtCost(req.estimatedCost.totalCost)}</span></div>`
    if (isExact) html += `<div style="margin-top:4px;font-size:9px;color:var(--text3)">via count_tokens API</div>`
    html += `</div>`
  }

  // Tool-use summary
  if (req.toolsUsed && req.toolsUsed.length > 0) {
    html += `<div class="usage-box">`
    html += `<div style="font-size:10px;font-weight:700;color:var(--cyan);margin-bottom:4px">Tools Used (${req.toolsUsed.length})</div>`
    for (const name of req.toolsUsed) {
      html += `<div style="font-size:10px;color:var(--text2);padding:1px 0">${escapeHtml(name)}</div>`
    }
    html += `</div>`
  }

  html += `</div>` // close stats-grid

  // Segments — each row is clickable to open modal
  for (let i = 0; i < req.segments.length; i++) {
    const seg = req.segments[i]
    const color = getSegColor(seg)
    const pct = ((seg.tokens / req.totalEstimatedTokens) * 100).toFixed(1)
    const barW = Math.min(pct, 100)
    const previewText = seg.preview ? seg.preview.slice(0, 80).replace(/\n/g, ' ') : ''

    const posLabel = seg.index !== undefined ? `msg #${seg.index}` : `#${i}`

    html += `<div class="segment-row" onclick="openModal(${i})">`
    html += `<div class="seg-color" style="background:${color}"></div>`
    html += `<div class="seg-info">`
    html += `<div class="seg-name" style="color:${color}">${seg.name} <span style="color:var(--text3);font-size:10px;font-weight:400">${posLabel}</span></div>`
    html += `<div class="seg-sub">${escapeHtml(previewText)}${seg.charLength > 80 ? '...' : ''}</div>`
    html += `</div>`
    html += `<div class="seg-bar"><div class="seg-bar-fill" style="width:${barW}%;background:${color}"></div></div>`
    html += `<div class="seg-pct">${pct}%</div>`
    html += `<div class="seg-tokens">${fmt(seg.tokens)}</div>`
    html += `<span class="seg-expand-hint">View</span>`
    html += `</div>`
  }

  el.innerHTML = html
}
