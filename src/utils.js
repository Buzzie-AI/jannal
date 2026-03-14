import { getSegmentColor } from './state.js'

// Re-export from shared lib for UI use (Vite bundles from project root)
export { estimateToolTokens } from '../lib/tokens.js'

export function getSegColor(seg) {
  if (seg.type === 'message' && seg.role === 'assistant') return getSegmentColor('assistant')
  if (seg.type === 'message') return getSegmentColor('message')
  return getSegmentColor(seg.type)
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

/** Infer MCP server name from tool name.
 *  MCP tools: mcp__<namespace>__<tool> → last segment of namespace
 *    e.g. "mcp__plugin_firebase_firebase__login" → "firebase"
 *  Non-MCP: first word before _ or /
 *    e.g. "github_search_repos" → "github"
 */
export function getToolServer(tool) {
  const name = tool?.name || ''
  // MCP tools: split by __ to get namespace, then take last _-separated segment
  if (name.startsWith('mcp__')) {
    const parts = name.split('__')
    if (parts.length >= 3) {
      const namespace = parts[1] // e.g. "plugin_firebase_firebase"
      const segments = namespace.split('_')
      return segments[segments.length - 1].toLowerCase()
    }
  }
  const match = name.match(/^([a-zA-Z0-9]+)[_\/]/)
  if (match) return match[1].toLowerCase()
  return 'other'
}

/** Group tools by inferred MCP server. Returns Map<serverName, tools[]> */
export function groupToolsByServer(tools) {
  const groups = new Map()
  for (const tool of tools) {
    const server = getToolServer(tool)
    if (!groups.has(server)) groups.set(server, [])
    groups.get(server).push(tool)
  }
  // Sort: "other" last, then alphabetically
  const sorted = new Map()
  const keys = [...groups.keys()].sort((a, b) => {
    if (a === 'other') return 1
    if (b === 'other') return -1
    return a.localeCompare(b)
  })
  for (const k of keys) sorted.set(k, groups.get(k))
  return sorted
}
