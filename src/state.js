// ─── Application state ──────────────────────────────────────────────────────

export const state = {
  connected: false,
  reqs: [],
  selectedReq: null,
  profiles: {},
  activeProfile: 'All Tools',
  premium: false,      // set from server on connect
  routerMode: 'off',   // 'off' | 'shadow' | 'auto'
  metricsScope: 'lifetime', // 'lifetime' | 'today' — toggled by clicking header badges
  toolsUsed: new Set(), // tools used across session (for "never used" indicator)
  groups: {},          // groupId → { id, reqIndices, sessions, startTime, endTime }
  groupView: true,     // true = grouped, false = flat list
  expandedGroups: {},  // groupId → boolean
}

export let modalState = {
  segment: null,
  segIndex: null,
  view: 'formatted', // 'formatted' | 'raw' | 'tools'
  fullContent: '',
  parsedTools: null,
  loading: false,
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const MAX_REQS = 50

export const SEGMENT_COLORS = {
  system: '#60A5FA',
  tools: '#FB923C',
  message: '#22D3EE',
  assistant: '#34D399',
  tool_result: '#FBBF24',
  tool_use: '#A78BFA',
}

// Dynamic getter that reads current CSS variable values (theme-aware)
const SEG_VAR_MAP = {
  system: '--seg-system',
  tools: '--seg-tools',
  message: '--seg-message',
  assistant: '--seg-assistant',
  tool_result: '--seg-tool-result',
  tool_use: '--seg-tool-use',
}

export function getSegmentColor(type) {
  const cssVar = SEG_VAR_MAP[type]
  if (cssVar) {
    const val = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
    if (val) return val
  }
  return SEGMENT_COLORS[type] || '#64748B'
}
