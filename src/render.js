import { state } from './state.js'
import { getSegColor, getSegLabel, fmt, fmtCost, inputRate, escapeHtml } from './utils.js'
import { getDailyCost } from './session.js'

// ─── Render ─────────────────────────────────────────────────────────────────

export function renderAll(opts = {}) {
  renderStatus()
  renderContextBar()
  renderTokenChart()
  renderReqList()
  // Only re-render detail if the selected request's data changed,
  // or if explicitly requested (e.g. user clicked a different request).
  if (!opts.skipDetail) renderDetail()
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
  const reqBadge = document.getElementById('reqBadge')
  if (reqBadge) reqBadge.textContent = `Req ${state.reqs.length}`

  // Session cost + savings
  let totalCost = 0
  let totalSavedTokens = 0
  let totalSavedCost = 0
  for (const t of state.reqs) {
    if (t.actualCost) totalCost += t.actualCost.totalCost
    else if (t.estimatedCost) totalCost += t.estimatedCost.totalCost
    const saved = t.router?.estimated_tokens_saved || 0
    if (saved > 0) {
      totalSavedTokens += saved
      // Saved tokens are tool definitions that would have been input tokens.
      // With prompt caching they'd mostly be cache reads (10% of base rate).
      const rate = inputRate(t.model)
      totalSavedCost += (saved / 1_000_000) * rate * 0.10
    }
  }
  document.getElementById('sessionCost').textContent = fmtCost(totalCost)
  const savedEl = document.getElementById('sessionSaved')
  if (savedEl) {
    const costStr = totalSavedCost >= 0.01 ? ` (${fmtCost(totalSavedCost)})` : ''
    savedEl.textContent = `Saved ~${fmt(totalSavedTokens)}${costStr}`
    savedEl.classList.toggle('has-savings', totalSavedTokens > 0)
  }

  // Daily cost (persisted across eviction)
  const daily = getDailyCost()
  const dailyEl = document.getElementById('dailyCost')
  if (dailyEl) {
    if (daily > 0) {
      dailyEl.style.display = 'flex'
      dailyEl.textContent = `Today: ${fmtCost(daily)}`
    } else {
      dailyEl.style.display = 'none'
    }
  }

  // Router badge
  const badge = document.getElementById('routerBadge')
  if (badge) {
    const mode = state.routerMode || 'off'
    const labels = { off: 'Router Off', shadow: 'Router Shadow', auto: 'Router Auto' }
    badge.textContent = labels[mode] || 'Router'
    badge.className = `router-badge router-badge--${mode}`

    // Mark active option in popover
    const popover = document.getElementById('routerPopover')
    if (popover) {
      for (const btn of popover.querySelectorAll('.router-popover-opt')) {
        btn.classList.toggle('active', btn.dataset.mode === mode)
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
  if (state.reqs.length === 0) {
    const cmd = getClaudeCommand()
    el.innerHTML = `<div class="empty"><div class="empty-icon waiting">&#x1F50D;</div><h2>Waiting for requests...</h2><p>Start Claude Code with:<br><code style="color:var(--cyan);font-size:11px">${cmd}</code> <button id="copyCommandBtn" class="copy-command-btn" onclick="copyClaudeCommand()" title="Copy to clipboard">Copy</button></p></div>`
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
    renderGroupedList(el)
  } else {
    renderFlatList(el)
  }

  el.scrollTop = scrollTop
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
  html += `<div class="req-card-head"><span class="req-label">Req ${t.turn}</span><span class="req-tokens" style="color:${color}">${tokenLabel}</span></div>`
  html += `<div class="req-mini-bar"><div class="req-mini-fill" style="width:${fillPct}%;background:${color}"></div></div>`
  // Row 2: model | in/out | cost
  html += `<div class="req-meta"><span>${shortModel}</span>`
  if (ioLabel) html += `<span class="req-io">${ioLabel}</span>`
  if (cost) html += `<span class="req-cost-inline">${cost}</span>`
  html += `</div>`
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

        // Newest requests on top within each session
        for (let k = session.reqIndices.length - 1; k >= 0; k--) {
          html += renderReqCard(session.reqIndices[k])
        }
        sessionNum++
      }
    } else {
      // Single session: just render requests, newest on top
      for (let k = group.reqIndices.length - 1; k >= 0; k--) {
        html += renderReqCard(group.reqIndices[k])
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

  // Router decision
  if (req.router) {
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
        html += `<div class="usage-row"><span class="usage-label">${isShadow ? 'Potential savings' : 'Est. savings'}</span><span class="usage-value" style="color:var(--green)">~${fmt(r.estimated_tokens_saved)} tokens</span></div>`
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
