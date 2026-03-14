import { state, MAX_REQS } from './state.js'
import { renderAll, renderStatus, renderDetail } from './render.js'
import { renderProfileSelector } from './profiles.js'
import { persistSession, addDailyCost } from './session.js'

// ─── Group helpers ──────────────────────────────────────────────────────────

function addReqToGroup(reqIndex, data) {
  const gid = data.groupId
  if (gid == null) return

  if (!state.groups[gid]) {
    state.groups[gid] = {
      id: gid,
      reqIndices: [],
      sessions: {},
      startTime: data.timestamp,
      endTime: data.timestamp,
    }
    // Collapse previous groups, expand the new one
    for (const k of Object.keys(state.expandedGroups)) {
      state.expandedGroups[k] = false
    }
    state.expandedGroups[gid] = true
  }

  const group = state.groups[gid]
  group.reqIndices.push(reqIndex)
  group.endTime = Math.max(group.endTime, data.timestamp)

  // Track sessions within the group
  const sh = data.sessionHash || 'unknown'
  if (!group.sessions[sh]) {
    group.sessions[sh] = { reqIndices: [], model: data.model }
  }
  group.sessions[sh].reqIndices.push(reqIndex)
}

export function rebuildGroups() {
  state.groups = {}
  state.expandedGroups = {}
  for (let i = 0; i < state.reqs.length; i++) {
    addReqToGroup(i, state.reqs[i])
  }
  // Only expand the most recent group
  const gids = Object.keys(state.groups).map(Number)
  if (gids.length > 0) {
    const maxGid = Math.max(...gids)
    for (const gid of gids) {
      state.expandedGroups[gid] = gid === maxGid
    }
  }
}

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
      if (data.routerMode != null) state.routerMode = data.routerMode
      renderProfileSelector()
      renderStatus()
      return
    }

    if (data.type === 'request') {
      if (data.toolsUsed && data.toolsUsed.length) {
        data.toolsUsed.forEach(name => state.toolsUsed.add(name))
      }
      state.reqs.push(data)
      // Evict oldest requests to keep memory bounded
      if (state.reqs.length > MAX_REQS) {
        state.reqs.splice(0, state.reqs.length - MAX_REQS)
        // Rebuild groups after eviction
        rebuildGroups()
      } else {
        addReqToGroup(state.reqs.length - 1, data)
      }
      // Only auto-select if nothing is currently selected.
      // If the user is inspecting a request, don't steal focus.
      if (state.selectedReq === null) {
        state.selectedReq = state.reqs.length - 1
      }
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
      // Match by turn for correct correlation under concurrent requests
      const req = data.turn != null
        ? state.reqs.find(r => r.turn === data.turn)
        : state.reqs[state.reqs.length - 1]
      if (req) {
        req.actualUsage = data.usage
        req.stopReason = data.stopReason
        if (data.cost) {
          req.actualCost = data.cost
          addDailyCost(data.cost.totalCost)
        }
        if (data.toolsUsed) req.toolsUsed = data.toolsUsed
        renderAll()
        persistSession(state)
      }
    }

    if (data.type === 'router_decision') {
      const req = state.reqs.find(r => r.turn === data.turn)
      if (req) {
        req.router = {
          mode: data.mode,
          eligible: data.eligible,
          skip_reason: data.skip_reason,
          matched_by: data.matched_by,
          confidence: data.confidence,
          selected_groups: data.selected_groups,
          stripped_groups: data.stripped_groups,
          estimated_tokens_saved: data.estimated_tokens_saved,
          sticky_reused: data.sticky_reused,
        }
        if (state.selectedReq !== null && state.reqs[state.selectedReq]?.turn === data.turn) {
          renderDetail()
        }
        persistSession(state)
      }
    }

    if (data.type === 'router_mode_changed') {
      state.routerMode = data.mode
      renderStatus()
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
