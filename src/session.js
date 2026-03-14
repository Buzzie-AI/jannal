// ─── Session export & persistence ───────────────────────────────────────────

const STORAGE_KEY = 'jannal_session'
const DAILY_COSTS_KEY = 'jannal_daily_costs'
const DAILY_SAVINGS_KEY = 'jannal_daily_savings'
const DEBOUNCE_MS = 500

let persistTimeout = null

export function persistSession(state) {
  if (persistTimeout) clearTimeout(persistTimeout)
  persistTimeout = setTimeout(() => {
    try {
      const data = {
        reqs: state.reqs,
        selectedReq: state.selectedReq,
        groupView: state.groupView,
        savedAt: Date.now(),
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.warn('Failed to persist session:', e.message)
    }
    persistTimeout = null
  }, DEBOUNCE_MS)
}

export function restoreSession(state) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const data = JSON.parse(raw)
    // Support both old (turns/selectedTurn) and new (reqs/selectedReq) keys
    const reqs = data.reqs || data.turns
    const selectedReq = data.selectedReq ?? data.selectedTurn
    if (reqs && Array.isArray(reqs) && reqs.length > 0) {
      state.reqs = reqs
      state.selectedReq = selectedReq != null && selectedReq < state.reqs.length
        ? selectedReq
        : state.reqs.length - 1
      if (data.groupView != null) state.groupView = data.groupView
      // Rebuild toolsUsed from restored reqs
      if (state.toolsUsed) {
        state.toolsUsed.clear()
        for (const t of state.reqs) {
          if (t.toolsUsed?.length) t.toolsUsed.forEach(name => state.toolsUsed.add(name))
        }
      }
      return true
    }
  } catch (e) {
    console.warn('Failed to restore session:', e.message)
  }
  return false
}

export function exportSessionJSON(state) {
  let totalCost = 0
  const reqs = state.reqs.map(t => {
    const cost = t.actualCost?.totalCost ?? t.estimatedCost?.totalCost ?? 0
    totalCost += cost
    return {
      request: t.turn,
      model: t.model,
      timestamp: t.timestamp,
      inputTokens: t.actualUsage?.input_tokens ?? t.totalEstimatedTokens,
      outputTokens: t.actualUsage?.output_tokens ?? 0,
      cost,
      segments: t.segments?.map(s => ({ name: s.name, type: s.type, tokens: s.tokens })) ?? [],
    }
  })
  const data = {
    exportedAt: new Date().toISOString(),
    requestCount: reqs.length,
    totalCost,
    requests: reqs,
  }
  return JSON.stringify(data, null, 2)
}

export function exportSessionCSV(state) {
  const headers = ['Request', 'Model', 'Timestamp', 'Input Tokens', 'Output Tokens', 'Cost ($)']
  const rows = state.reqs.map(t => [
    t.turn,
    t.model,
    new Date(t.timestamp).toISOString(),
    t.actualUsage?.input_tokens ?? t.totalEstimatedTokens ?? '',
    t.actualUsage?.output_tokens ?? 0,
    (t.actualCost?.totalCost ?? t.estimatedCost?.totalCost ?? 0).toFixed(4),
  ])
  const csv = [headers.join(','), ...rows.map(r => r.map((v, i) => i === 5 ? v : `"${String(v)}"`).join(','))].join('\n')
  return csv
}

export function addDailyCost(cost) {
  if (!cost || cost <= 0) return
  try {
    const today = new Date().toISOString().slice(0, 10)
    const data = JSON.parse(localStorage.getItem(DAILY_COSTS_KEY) || '{}')
    data[today] = (data[today] || 0) + cost
    localStorage.setItem(DAILY_COSTS_KEY, JSON.stringify(data))
  } catch (e) { /* ignore */ }
}

export function getDailyCost() {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const data = JSON.parse(localStorage.getItem(DAILY_COSTS_KEY) || '{}')
    return data[today] || 0
  } catch (e) { return 0 }
}

export function addDailySavings(cost, tokens) {
  if ((!cost || cost <= 0) && (!tokens || tokens <= 0)) return
  try {
    const today = new Date().toISOString().slice(0, 10)
    const data = JSON.parse(localStorage.getItem(DAILY_SAVINGS_KEY) || '{}')
    if (!data[today]) data[today] = { cost: 0, tokens: 0 }
    // Migrate from old scalar format
    if (typeof data[today] === 'number') data[today] = { cost: data[today], tokens: 0 }
    data[today].cost += cost || 0
    data[today].tokens += tokens || 0
    localStorage.setItem(DAILY_SAVINGS_KEY, JSON.stringify(data))
  } catch (e) { /* ignore */ }
}

export function getDailySavings() {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const data = JSON.parse(localStorage.getItem(DAILY_SAVINGS_KEY) || '{}')
    const entry = data[today]
    if (!entry) return { cost: 0, tokens: 0 }
    if (typeof entry === 'number') return { cost: entry, tokens: 0 }
    return { cost: entry.cost || 0, tokens: entry.tokens || 0 }
  } catch (e) { return { cost: 0, tokens: 0 } }
}

export function downloadExport(content, filename) {
  const blob = new Blob([content], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
