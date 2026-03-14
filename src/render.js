import { state } from './state.js'
import { getSegColor, getSegLabel, fmt, fmtCost, escapeHtml } from './utils.js'
import { getDailyCost, checkBudgetAlert } from './session.js'

// ─── Render ─────────────────────────────────────────────────────────────────

export function renderAll() {
  renderStatus()
  renderContextBar()
  renderTokenChart()
  renderReqList()
  renderDetail()
  renderExportButton()
}

function renderExportButton() {
  const btn = document.getElementById('exportBtn')
  if (btn) {
    btn.disabled = state.reqs.length === 0
    btn.title = state.reqs.length === 0 ? 'No data to export' : 'Export session as JSON or CSV'
  }
}

export function renderStatus() {
  document.getElementById('statusDot').className = `status-dot ${state.connected ? 'connected' : 'disconnected'}`
  const text = document.getElementById('statusText')
  text.textContent = state.connected ? 'Connected' : 'Disconnected'
  text.style.color = state.connected ? 'var(--green)' : 'var(--red)'
  document.getElementById('reqBadge').textContent = `Req ${state.reqs.length}`

  // Session cost
  let totalCost = 0
  for (const t of state.reqs) {
    if (t.actualCost) totalCost += t.actualCost.totalCost
    else if (t.estimatedCost) totalCost += t.estimatedCost.totalCost
  }
  document.getElementById('sessionCost').textContent = fmtCost(totalCost)

  // Tokens saved badge (when filtering active)
  const tokensSavedBadge = document.getElementById('tokensSavedBadge')
  if (state.activeProfile !== 'All Tools') {
    let totalSaved = 0
    for (const t of state.reqs) {
      if (t.filteringActive && t.tokensSaved) totalSaved += t.tokensSaved
    }
    if (totalSaved > 0) {
      tokensSavedBadge.style.display = 'inline'
      tokensSavedBadge.textContent = `~${fmt(totalSaved)} saved`
      tokensSavedBadge.title = 'Tokens saved by tool filtering this session'
    } else {
      tokensSavedBadge.style.display = 'none'
    }
  } else {
    tokensSavedBadge.style.display = 'none'
  }

  // Daily cost
  const daily = getDailyCost()
  const dailyEl = document.getElementById('dailyCost')
  if (daily > 0) {
    dailyEl.style.display = 'block'
    dailyEl.textContent = `Today: ${fmtCost(daily)}`
  } else {
    dailyEl.style.display = 'none'
  }

  // Budget alert banner (when daily cost exceeds user-set limit)
  const alertResult = checkBudgetAlert(daily)
  const budgetBanner = document.getElementById('budgetAlertBanner')
  if (budgetBanner) {
    if (alertResult.exceeded) {
      budgetBanner.style.display = 'flex'
      budgetBanner.innerHTML = `<span>Daily budget exceeded: ${fmtCost(alertResult.current)} / $${alertResult.limit} limit</span><button class="budget-banner-dismiss" onclick="this.parentElement.style.display='none'">Dismiss</button>`
    } else {
      budgetBanner.style.display = 'none'
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

  // Group consecutive segments of the same type to avoid overflow with many small segments
  const groups = []
  for (let i = 0; i < req.segments.length; i++) {
    const seg = req.segments[i]
    const color = getSegColor(seg)
    const last = groups[groups.length - 1]
    if (last && last.color === color) {
      last.tokens += seg.tokens
      last.count++
      last.endIndex = i
    } else {
      groups.push({ color, tokens: seg.tokens, name: seg.name, count: 1, startIndex: i, endIndex: i })
    }
  }

  let html = ''
  for (const g of groups) {
    const w = (g.tokens / budget) * 100
    if (w < 0.1) continue
    const label = g.count > 1 ? `${g.name} (×${g.count})` : g.name
    html += `<div class="bar-segment" style="width:${w}%;background:linear-gradient(180deg,${g.color}cc,${g.color}88);border-right:1.5px solid var(--bg3)" title="${label}: ${fmt(g.tokens)} tokens" onclick="openModal(${g.startIndex})">`
    if (w > 5) html += `<span>${w > 15 ? label : fmt(g.tokens)}</span>`
    html += '</div>'
  }
  if (fillPct < 100) html += `<div class="bar-empty"><span>${fmt(budget - total)} free</span></div>`
  barInner.innerHTML = html

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

  if (state.reqs.length < 2) {
    container.style.display = 'none'
    return
  }

  container.style.display = 'block'
  const reqs = state.reqs
  const values = reqs.map(t => t.actualUsage?.input_tokens ?? t.totalEstimatedTokens ?? 0)
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
  const cmd = getClaudeCommand()
  navigator.clipboard.writeText(cmd).then(() => {
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
  if (state.reqs.length === 0) {
    const cmd = getClaudeCommand()
    el.innerHTML = `<div class="empty"><div class="empty-icon waiting">&#x1F50D;</div><h2>Waiting for requests...</h2><p>Start Claude Code with:<br><code id="claudeCommand" style="color:var(--cyan);font-size:11px">${cmd}</code> <button id="copyCommandBtn" class="copy-command-btn" onclick="copyClaudeCommand()" title="Copy to clipboard">Copy</button></p></div>`
    return
  }

  // Update toggle button state
  const toggleBtn = document.getElementById('viewToggleBtn')
  if (toggleBtn) {
    toggleBtn.textContent = state.groupView ? 'Grouped' : 'Flat'
    toggleBtn.classList.toggle('active', state.groupView)
  }

  if (state.groupView && Object.keys(state.groups).length > 0) {
    renderGroupedList(el)
  } else {
    renderFlatList(el)
  }
}

function renderFlatList(el) {
  let html = ''
  for (let i = state.reqs.length - 1; i >= 0; i--) {
    html += renderReqCard(i)
  }
  el.innerHTML = html
}

function renderReqCard(i) {
  const t = state.reqs[i]
  const total = t.actualUsage ? t.actualUsage.input_tokens : t.totalEstimatedTokens
  const fillPct = Math.min((total / t.budget) * 100, 100)
  const color = fillPct > 95 ? 'var(--red)' : fillPct > 80 ? 'var(--orange)' : 'var(--green)'
  const time = new Date(t.timestamp).toLocaleTimeString()

  let html = `<div class="req-card${i === state.selectedReq ? ' selected' : ''}" onclick="selectReq(${i})" title="Each request is one API call to Anthropic. Click to see its full context breakdown.">`
  const tokenLabel = t.actualUsage ? fmt(t.actualUsage.input_tokens) : (t.tokenCountSource === 'count_tokens' ? fmt(t.totalEstimatedTokens) : '~' + fmt(t.totalEstimatedTokens))
  html += `<div class="req-card-head"><span class="req-label">Req ${t.turn}</span><span class="req-tokens" style="color:${color}">${tokenLabel}</span></div>`
  html += `<div class="req-mini-bar"><div class="req-mini-fill" style="width:${fillPct}%;background:${color}"></div></div>`
  html += `<div class="req-meta"><span>${t.model}</span><span>${t.segments.length} segs</span><span>${time}</span></div>`

  if (t.actualUsage) {
    html += `<div class="req-actual">Actual: ${t.actualUsage.input_tokens.toLocaleString()} in / ${t.actualUsage.output_tokens.toLocaleString()} out</div>`
  }

  if (t.actualCost) {
    html += `<div class="req-cost" style="color:var(--amber)">${fmtCost(t.actualCost.totalCost)}</div>`
  } else if (t.estimatedCost) {
    html += `<div class="req-cost" style="color:var(--text3)">~${fmtCost(t.estimatedCost.totalCost)}</div>`
  }

  if (t.latencyMs != null) {
    html += `<div class="req-latency" style="font-size:9px;color:var(--text3)">${t.latencyMs}ms</div>`
  }

  if (t.filteringActive) {
    html += `<div style="margin-top:2px;font-size:9px;color:var(--orange);font-weight:600">Filtered: -${t.removedTools.length} tools</div>`
  }

  html += `</div>`
  return html
}

function renderGroupedList(el) {
  // Get group IDs sorted by most recent first
  const groupIds = Object.keys(state.groups)
    .map(Number)
    .sort((a, b) => b - a)

  let html = ''
  for (const gid of groupIds) {
    const group = state.groups[gid]
    const expanded = state.expandedGroups[gid] !== false // default to expanded for first

    // Compute group totals
    let totalCost = 0
    let totalTokens = 0
    for (const ri of group.reqIndices) {
      const t = state.reqs[ri]
      if (!t) continue
      if (t.actualCost) totalCost += t.actualCost.totalCost
      else if (t.estimatedCost) totalCost += t.estimatedCost.totalCost
      totalTokens += t.actualUsage?.input_tokens ?? t.totalEstimatedTokens ?? 0
    }

    const reqCount = group.reqIndices.length
    const sessionKeys = Object.keys(group.sessions)
    const isMultiSession = sessionKeys.length > 1
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

    if (isMultiSession) {
      // Multiple sessions: show session labels
      // Main session first (most messages), then subagents
      const sorted = sessionKeys.sort((a, b) => {
        const aCount = group.sessions[a].reqIndices.length
        const bCount = group.sessions[b].reqIndices.length
        return bCount - aCount
      })

      let sessionNum = 0
      for (const sh of sorted) {
        const session = group.sessions[sh]
        const model = session.model || 'unknown'
        const isMain = sessionNum === 0
        const label = isMain ? 'Main' : 'Subagent'
        const pillClass = isMain ? 'main' : 'subagent'

        html += `<div class="group-session-label">`
        html += `<span class="session-pill ${pillClass}">${label}</span>`
        html += `<span>${model} · ${session.reqIndices.length} req${session.reqIndices.length !== 1 ? 's' : ''}</span>`
        html += `</div>`

        for (const ri of session.reqIndices) {
          html += renderReqCard(ri)
        }
        sessionNum++
      }
    } else {
      // Single session: just render requests
      for (const ri of group.reqIndices) {
        html += renderReqCard(ri)
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

  // System prompt size warning
  const systemSeg = req.segments?.find(s => s.type === 'system')
  if (systemSeg && req.budget) {
    const systemPct = (systemSeg.tokens / req.budget) * 100
    if (systemPct > 15) {
      html += `<div class="warning-box">`
      html += `<div class="warning-box-title">System prompt is large</div>`
      html += `<div class="usage-row"><span class="usage-label">System prompt</span><span class="usage-value" style="color:var(--orange)">${fmt(systemSeg.tokens)} tokens (${systemPct.toFixed(1)}% of context)</span></div>`
      html += `<div style="margin-top:6px;font-size:10px;color:var(--text3)">Consider trimming or splitting to free context for conversation.</div>`
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

  // Latency (TTFT, total duration)
  if (req.latencyMs != null || req.ttftMs != null) {
    html += `<div class="usage-box">`
    html += `<div class="usage-box-title">Request latency</div>`
    if (req.ttftMs != null) html += `<div class="usage-row"><span class="usage-label">Time to first token</span><span class="usage-value" style="color:var(--cyan)">${req.ttftMs}ms</span></div>`
    if (req.latencyMs != null) html += `<div class="usage-row"><span class="usage-label">Total duration</span><span class="usage-value" style="color:var(--cyan)">${req.latencyMs}ms</span></div>`
    html += `</div>`
  }

  // Usage + cost comparison
  if (req.actualUsage) {
    const diff = req.actualUsage.input_tokens - req.totalEstimatedTokens
    const diffPct = ((diff / req.actualUsage.input_tokens) * 100).toFixed(1)
    html += `<div class="usage-box">`
    html += `<div class="usage-row"><span class="usage-label">Estimated input</span><span class="usage-value estimated">~${req.totalEstimatedTokens.toLocaleString()}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Actual input</span><span class="usage-value actual">${req.actualUsage.input_tokens.toLocaleString()}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Estimation error</span><span class="usage-value" style="color:${Math.abs(parseFloat(diffPct)) < 15 ? 'var(--green)' : 'var(--orange)'}">${diff > 0 ? '+' : ''}${diff.toLocaleString()} (${diffPct}%)</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Output tokens</span><span class="usage-value">${req.actualUsage.output_tokens.toLocaleString()}</span></div>`
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
