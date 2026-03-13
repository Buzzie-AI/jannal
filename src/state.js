// ─── Application state ──────────────────────────────────────────────────────

export const state = {
  connected: false,
  turns: [],
  selectedTurn: null,
  profiles: {},
  activeProfile: 'All Tools',
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

export const MAX_TURNS = 50

export const SEGMENT_COLORS = {
  system: '#3B82F6',
  tools: '#F97316',
  message: '#06B6D4',
  assistant: '#10B981',
  tool_result: '#EAB308',
  tool_use: '#8B5CF6',
}
