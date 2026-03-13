import { state } from './state.js'
import { renderAll, renderStatus } from './render.js'
import { renderProfileSelector } from './profiles.js'

// ─── WebSocket ──────────────────────────────────────────────────────────────

let ws

export function sendWs(msg) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(msg))
  }
}

export function connect() {
  // In dev (Vite on :5173), connect directly to the server on :3456
  // In production, connect to the same host serving the page
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsHost = location.port === '5173' ? 'localhost:4455' : location.host
  ws = new WebSocket(`${proto}//${wsHost}`)

  ws.onopen = () => {
    state.connected = true
    renderStatus()
  }

  ws.onclose = () => {
    state.connected = false
    renderStatus()
    setTimeout(connect, 2000)
  }

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)

    if (data.type === 'connected') {
      if (data.profiles) state.profiles = data.profiles
      if (data.activeProfile) state.activeProfile = data.activeProfile
      renderProfileSelector()
      return
    }

    if (data.type === 'request') {
      state.turns.push(data)
      state.selectedTurn = state.turns.length - 1
      renderAll()
    }

    if (data.type === 'token_count_update') {
      const turn = state.turns.find(t => t.turn === data.turn)
      if (turn) {
        turn.exactInputTokens = data.exactInputTokens
        turn.segments = data.segments
        turn.totalEstimatedTokens = data.exactInputTokens
        turn.estimatedCost = data.estimatedCost
        turn.tokenCountSource = 'count_tokens'
        renderAll()
      }
    }

    if (data.type === 'response_complete') {
      const latest = state.turns[state.turns.length - 1]
      if (latest) {
        latest.actualUsage = data.usage
        latest.stopReason = data.stopReason
        if (data.cost) latest.actualCost = data.cost
        renderAll()
      }
    }

    if (data.type === 'profiles_updated') {
      state.profiles = data.profiles || {}
      state.activeProfile = data.active || 'All Tools'
      renderProfileSelector()
    }

    if (data.type === 'active_profile_changed') {
      state.activeProfile = data.active || 'All Tools'
      renderProfileSelector()
    }
  }
}
