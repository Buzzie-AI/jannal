// ─── Session export & persistence ───────────────────────────────────────────

const STORAGE_KEY = 'jannal_session'
const DEBOUNCE_MS = 500

let persistTimeout = null

export function persistSession(state) {
  if (persistTimeout) clearTimeout(persistTimeout)
  persistTimeout = setTimeout(() => {
    try {
      const data = {
        turns: state.turns,
        selectedTurn: state.selectedTurn,
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
    if (data.turns && Array.isArray(data.turns) && data.turns.length > 0) {
      state.turns = data.turns
      state.selectedTurn = data.selectedTurn != null && data.selectedTurn < state.turns.length
        ? data.selectedTurn
        : state.turns.length - 1
      return true
    }
  } catch (e) {
    console.warn('Failed to restore session:', e.message)
  }
  return false
}

export function exportSessionJSON(state) {
  let totalCost = 0
  const turns = state.turns.map(t => {
    const cost = t.actualCost?.totalCost ?? t.estimatedCost?.totalCost ?? 0
    totalCost += cost
    return {
      turn: t.turn,
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
    turnCount: turns.length,
    totalCost,
    turns,
  }
  return JSON.stringify(data, null, 2)
}

export function exportSessionCSV(state) {
  const headers = ['Turn', 'Model', 'Timestamp', 'Input Tokens', 'Output Tokens', 'Cost ($)']
  const rows = state.turns.map(t => [
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

export function downloadExport(content, filename) {
  const blob = new Blob([content], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
