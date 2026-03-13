import { state } from './state.js'
import { getSegColor, getSegLabel, fmt, fmtCost, escapeHtml } from './utils.js'
import { getDailyCost } from './session.js'

// ─── Render ─────────────────────────────────────────────────────────────────

export function renderAll() {
  renderStatus()
  renderContextBar()
  renderTokenChart()
  renderTurnList()
  renderDetail()
  renderExportButton()
}

function renderExportButton() {
  const btn = document.getElementById('exportBtn')
  if (btn) {
    btn.disabled = state.turns.length === 0
    btn.title = state.turns.length === 0 ? 'No data to export' : 'Export session as JSON or CSV'
  }
}

export function renderStatus() {
  document.getElementById('statusDot').className = `status-dot ${state.connected ? 'connected' : 'disconnected'}`
  const text = document.getElementById('statusText')
  text.textContent = state.connected ? 'Connected' : 'Disconnected'
  text.style.color = state.connected ? 'var(--green)' : 'var(--red)'
  document.getElementById('turnBadge').textContent = `Turn ${state.turns.length}`

  // Session cost
  let totalCost = 0
  for (const t of state.turns) {
    if (t.actualCost) totalCost += t.actualCost.totalCost
    else if (t.estimatedCost) totalCost += t.estimatedCost.totalCost
  }
  document.getElementById('sessionCost').textContent = fmtCost(totalCost)

  // Tokens saved badge (when filtering active)
  const tokensSavedBadge = document.getElementById('tokensSavedBadge')
  if (state.activeProfile !== 'All Tools') {
    let totalSaved = 0
    for (const t of state.turns) {
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
}

export function renderContextBar() {
  const turn = state.selectedTurn !== null ? state.turns[state.selectedTurn] : null
  const barInner = document.getElementById('barInner')
  const barOuter = document.getElementById('barOuter')

  if (!turn) {
    barInner.innerHTML = '<div class="bar-empty"><span>No data yet</span></div>'
    barOuter.className = 'bar-outer'
    document.getElementById('barLegend').innerHTML = ''
    document.getElementById('barTotal').textContent = '0 / 0'
    document.getElementById('barPct').textContent = '0%'
    return
  }

  const budget = turn.budget
  const total = turn.actualUsage ? turn.actualUsage.input_tokens : turn.totalEstimatedTokens
  const fillPct = (total / budget) * 100
  barOuter.className = 'bar-outer' + (fillPct > 95 ? ' pressure-critical' : fillPct > 80 ? ' pressure-high' : '')

  let html = ''
  for (let i = 0; i < turn.segments.length; i++) {
    const seg = turn.segments[i]
    const w = Math.max((seg.tokens / budget) * 100, 0.3)
    const color = getSegColor(seg)
    html += `<div class="bar-segment" style="width:${w}%;background:linear-gradient(180deg,${color}cc,${color}88);border-right:1.5px solid var(--bg3)" title="${seg.name}: ${fmt(seg.tokens)} tokens" onclick="openModal(${i})">`
    if (w > 5) html += `<span>${w > 15 ? seg.name : fmt(seg.tokens)}</span>`
    html += '</div>'
  }
  if (fillPct < 100) html += `<div class="bar-empty"><span>${fmt(budget - total)} free</span></div>`
  barInner.innerHTML = html

  const seen = new Map()
  for (const seg of turn.segments) { const k = getSegLabel(seg), c = getSegColor(seg); if (!seen.has(k)) seen.set(k, c) }
  document.getElementById('barLegend').innerHTML = Array.from(seen.entries()).map(([l, c]) => `<div class="legend-item"><div class="legend-dot" style="background:${c}"></div>${l}</div>`).join('')

  const totalLabel = turn.actualUsage ? fmt(turn.actualUsage.input_tokens) : (turn.tokenCountSource === 'count_tokens' ? fmt(turn.totalEstimatedTokens) : `~${fmt(turn.totalEstimatedTokens)}`)
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

  if (state.turns.length < 2) {
    container.style.display = 'none'
    return
  }

  container.style.display = 'block'
  const turns = state.turns
  const values = turns.map(t => t.actualUsage?.input_tokens ?? t.totalEstimatedTokens ?? 0)
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
    <div class="token-chart-hint">${values.length} turns · ${fmt(minVal)} → ${fmt(maxVal)} tokens</div>
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

export function renderTurnList() {
  const el = document.getElementById('turnList')
  if (state.turns.length === 0) {
    const cmd = getClaudeCommand()
    el.innerHTML = `<div class="empty"><div class="empty-icon waiting">&#x1F50D;</div><h2>Waiting for requests...</h2><p>Start Claude Code with:<br><code id="claudeCommand" style="color:var(--cyan);font-size:11px">${cmd}</code> <button id="copyCommandBtn" class="copy-command-btn" onclick="copyClaudeCommand()" title="Copy to clipboard">Copy</button></p></div>`
    return
  }
  let html = ''
  for (let i = state.turns.length - 1; i >= 0; i--) {
    const t = state.turns[i]
    const total = t.actualUsage ? t.actualUsage.input_tokens : t.totalEstimatedTokens
    const fillPct = Math.min((total / t.budget) * 100, 100)
    const color = fillPct > 95 ? 'var(--red)' : fillPct > 80 ? 'var(--orange)' : 'var(--green)'
    const time = new Date(t.timestamp).toLocaleTimeString()

    html += `<div class="turn-card${i === state.selectedTurn ? ' selected' : ''}" onclick="selectTurn(${i})">`
    const tokenLabel = t.actualUsage ? fmt(t.actualUsage.input_tokens) : (t.tokenCountSource === 'count_tokens' ? fmt(t.totalEstimatedTokens) : '~' + fmt(t.totalEstimatedTokens))
    html += `<div class="turn-card-head"><span class="turn-label">Turn ${t.turn}</span><span class="turn-tokens" style="color:${color}">${tokenLabel}</span></div>`
    html += `<div class="turn-mini-bar"><div class="turn-mini-fill" style="width:${fillPct}%;background:${color}"></div></div>`
    html += `<div class="turn-meta"><span>${t.model}</span><span>${t.segments.length} segs</span><span>${time}</span></div>`

    if (t.actualUsage) {
      html += `<div class="turn-actual">Actual: ${t.actualUsage.input_tokens.toLocaleString()} in / ${t.actualUsage.output_tokens.toLocaleString()} out</div>`
    }

    // Cost
    if (t.actualCost) {
      html += `<div class="turn-cost" style="color:var(--cyan)">${fmtCost(t.actualCost.totalCost)}</div>`
    } else if (t.estimatedCost) {
      html += `<div class="turn-cost" style="color:var(--text3)">~${fmtCost(t.estimatedCost.totalCost)}</div>`
    }

    // Filtering indicator
    if (t.filteringActive) {
      html += `<div style="margin-top:2px;font-size:9px;color:var(--orange);font-weight:600">Filtered: -${t.removedTools.length} tools</div>`
    }

    html += `</div>`
  }
  el.innerHTML = html
}

export function renderDetail() {
  const el = document.getElementById('detailBody')
  const title = document.getElementById('detailTitle')
  const meta = document.getElementById('detailMeta')

  if (state.selectedTurn === null || !state.turns[state.selectedTurn]) {
    title.textContent = 'Segment Breakdown'
    meta.textContent = ''
    el.innerHTML = '<div class="empty"><div class="empty-icon">&#x1F4CA;</div><h2>No turn selected</h2><p>Click a turn on the left to see its context breakdown.</p></div>'
    return
  }

  const turn = state.turns[state.selectedTurn]
  title.textContent = `Turn ${turn.turn} — Segment Breakdown`
  meta.textContent = `${turn.model} | ${turn.segments.length} segments | ${turn.messageCount} messages`

  let html = ''

  // System prompt size warning
  const systemSeg = turn.segments?.find(s => s.type === 'system')
  if (systemSeg && turn.budget) {
    const systemPct = (systemSeg.tokens / turn.budget) * 100
    if (systemPct > 15) {
      html += `<div class="warning-box">`
      html += `<div class="warning-box-title">System prompt is large</div>`
      html += `<div class="usage-row"><span class="usage-label">System prompt</span><span class="usage-value" style="color:var(--orange)">${fmt(systemSeg.tokens)} tokens (${systemPct.toFixed(1)}% of context)</span></div>`
      html += `<div style="margin-top:6px;font-size:10px;color:var(--text3)">Consider trimming or splitting to free context for conversation.</div>`
      html += `</div>`
    }
  }

  // Filtering info
  if (turn.filteringActive && turn.removedTools && turn.removedTools.length > 0) {
    html += `<div class="filter-box">`
    html += `<div class="filter-box-title">Filtering Active</div>`
    html += `<div class="usage-row"><span class="usage-label">Original tools</span><span class="usage-value" style="color:var(--text2)">${turn.originalToolCount}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">After filtering</span><span class="usage-value" style="color:var(--green)">${turn.filteredToolCount}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Removed</span><span class="usage-value" style="color:var(--orange)">${turn.removedTools.length} tools</span></div>`
    if (turn.tokensSaved) {
      html += `<div class="usage-row"><span class="usage-label">Tokens saved</span><span class="usage-value" style="color:var(--green)">~${fmt(turn.tokensSaved)}</span></div>`
    }
    html += `<div style="margin-top:6px;font-size:10px;color:var(--text3);line-height:1.4">${turn.removedTools.join(', ')}</div>`
    html += `</div>`
  }

  // Usage + cost comparison
  if (turn.actualUsage) {
    const diff = turn.actualUsage.input_tokens - turn.totalEstimatedTokens
    const diffPct = ((diff / turn.actualUsage.input_tokens) * 100).toFixed(1)
    html += `<div class="usage-box">`
    html += `<div class="usage-row"><span class="usage-label">Estimated input</span><span class="usage-value estimated">~${turn.totalEstimatedTokens.toLocaleString()}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Actual input</span><span class="usage-value actual">${turn.actualUsage.input_tokens.toLocaleString()}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Estimation error</span><span class="usage-value" style="color:${Math.abs(parseFloat(diffPct)) < 15 ? 'var(--green)' : 'var(--orange)'}">${diff > 0 ? '+' : ''}${diff.toLocaleString()} (${diffPct}%)</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Output tokens</span><span class="usage-value">${turn.actualUsage.output_tokens.toLocaleString()}</span></div>`
    if (turn.actualCost) {
      html += `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px">`
      html += `<div class="usage-row"><span class="usage-label">Input cost</span><span class="usage-value" style="color:var(--cyan)">${fmtCost(turn.actualCost.inputCost)}</span></div>`
      html += `<div class="usage-row"><span class="usage-label">Output cost</span><span class="usage-value" style="color:var(--cyan)">${fmtCost(turn.actualCost.outputCost)}</span></div>`
      html += `<div class="usage-row"><span class="usage-label">Total cost</span><span class="usage-value" style="color:var(--cyan);font-size:13px">${fmtCost(turn.actualCost.totalCost)}</span></div>`
      html += `</div>`
    }
    html += `</div>`
  } else if (turn.estimatedCost) {
    const isExact = turn.tokenCountSource === 'count_tokens'
    html += `<div class="usage-box">`
    html += `<div class="usage-row"><span class="usage-label">Input tokens ${isExact ? '(exact)' : '(est.)'}</span><span class="usage-value" style="color:${isExact ? 'var(--green)' : 'var(--text2)'}">${isExact ? '' : '~'}${turn.totalEstimatedTokens.toLocaleString()}</span></div>`
    html += `<div class="usage-row"><span class="usage-label">Input cost ${isExact ? '' : '(est.)'}</span><span class="usage-value" style="color:${isExact ? 'var(--cyan)' : 'var(--text3)'}">${isExact ? '' : '~'}${fmtCost(turn.estimatedCost.totalCost)}</span></div>`
    if (isExact) html += `<div style="margin-top:4px;font-size:9px;color:var(--text3)">via count_tokens API</div>`
    html += `</div>`
  }

  // Segments — each row is clickable to open modal
  for (let i = 0; i < turn.segments.length; i++) {
    const seg = turn.segments[i]
    const color = getSegColor(seg)
    const pct = ((seg.tokens / turn.totalEstimatedTokens) * 100).toFixed(1)
    const barW = Math.min(pct, 100)
    const previewText = seg.preview ? seg.preview.slice(0, 80).replace(/\n/g, ' ') : ''

    html += `<div class="segment-row" onclick="openModal(${i})">`
    html += `<div class="seg-color" style="background:${color}"></div>`
    html += `<div class="seg-info">`
    html += `<div class="seg-name" style="color:${color}">${seg.name}</div>`
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
