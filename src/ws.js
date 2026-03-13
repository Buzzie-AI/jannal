import { state, MAX_REQS } from './state.js'
import { renderAll, renderStatus } from './render.js'
import { renderProfileSelector } from './profiles.js'
import { persistSession } from './session.js'

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
      state.reqs.push(data)
      // Evict oldest requests to keep memory bounded
      if (state.reqs.length > MAX_REQS) {
        state.reqs.splice(0, state.reqs.length - MAX_REQS)
      }
      state.selectedReq = state.reqs.length - 1
      renderAll()
      persistSession(state)
    }

    if (data.type === 'token_count_update') {
      const req = state.reqs.find(t => t.turn === data.turn)
      if (req) {
        req.exactInputTokens = data.exactInputTokens
        req.segments = data.segments
        req.totalEstimatedTokens = data.exactInputTokens
        req.estimatedCost = data.estimatedCost
        req.tokenCountSource = 'count_tokens'
        renderAll()
        persistSession(state)
      }
    }

    if (data.type === 'response_complete') {
      const latest = state.reqs[state.reqs.length - 1]
      if (latest) {
        latest.actualUsage = data.usage
        latest.stopReason = data.stopReason
        if (data.cost) latest.actualCost = data.cost
        renderAll()
        persistSession(state)
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
