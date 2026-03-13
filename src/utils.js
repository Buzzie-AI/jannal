import { SEGMENT_COLORS } from './state.js'

export function getSegColor(seg) {
  if (seg.type === 'message' && seg.role === 'assistant') return SEGMENT_COLORS.assistant
  if (seg.type === 'message') return SEGMENT_COLORS.message
  return SEGMENT_COLORS[seg.type] || '#64748B'
}

export function getSegLabel(seg) {
  if (seg.type === 'message') return seg.role === 'user' ? 'User Message' : 'Assistant Message'
  if (seg.type === 'tool_result') return 'Tool Result'
  if (seg.type === 'tool_use') return 'Tool Use'
  if (seg.type === 'system') return 'System Prompt'
  if (seg.type === 'tools') return 'Tool Definitions'
  return seg.type
}

export function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toString()
}

export function fmtCost(n) {
  if (n >= 1) return '$' + n.toFixed(2)
  if (n >= 0.01) return '$' + n.toFixed(3)
  return '$' + n.toFixed(4)
}

export function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

export function isToolEnabled(toolName, profile, isAllTools) {
  if (isAllTools || !profile || !profile.tools || profile.tools.length === 0) return true
  if (profile.mode === 'blocklist') {
    return !profile.tools.includes(toolName)
  } else {
    return profile.tools.includes(toolName)
  }
}

export function estimateToolTokens(tool) {
  return Math.ceil(JSON.stringify(tool).length / 3.8)
}
