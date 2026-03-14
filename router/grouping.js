// ─── Canonical Tool-to-Group Mapping ──────────────────────────────────────────
//
// Backend source of truth for assigning tools to server groups.
// Priority: core → catalog prefix → unknown MCP namespace → other
//
// Unknown MCP servers get their own first-class group derived from the
// namespace, without needing a catalog entry.

const { CATALOG, DEFAULT_CORE_TOOLS, getCatalogEntry } = require("./catalog");

let coreToolSet = new Set(DEFAULT_CORE_TOOLS);

/**
 * Update the core tool set (e.g., from router-state.json config).
 */
function setCoreTools(tools) {
  coreToolSet = new Set(tools);
}

/**
 * Get the group name for a single tool.
 *
 *   "Agent"                                        → "core"
 *   "mcp__claude_ai_linear__list_issues"            → "linear"
 *   "mcp__plugin_github_github__search_repos"       → "github"  (unknown MCP)
 *   "WebSearch"                                     → "other"
 */
function getToolGroup(toolName) {
  if (!toolName) return "other";

  // 1. Core tools
  if (coreToolSet.has(toolName)) return "core";

  // 2. Catalog prefix match
  for (const [groupName, entry] of Object.entries(CATALOG)) {
    if (entry.toolPrefixes.some((prefix) => toolName.startsWith(prefix))) {
      return groupName;
    }
  }

  // 3. Unknown MCP — derive group from full namespace
  //    Use the full namespace (parts[1]) as the group key to avoid collisions.
  //    e.g. "mcp__plugin_github_github__search" → "plugin_github_github"
  //         "mcp__acme_internal_tools__foo"     → "acme_internal_tools"
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    if (parts.length >= 3 && parts[1]) {
      return parts[1].toLowerCase();
    }
  }

  // 4. Fallback
  return "other";
}

/**
 * Group an array of tool names into a Map<groupName, toolName[]>.
 */
function groupTools(toolNames) {
  const groups = new Map();
  for (const name of toolNames) {
    const group = getToolGroup(name);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(name);
  }
  return groups;
}

/**
 * Get sorted unique group names for an array of tools.
 * "core" is always first, "other" is always last.
 */
function getAvailableGroups(toolNames) {
  if (!toolNames || toolNames.length === 0) return [];
  const groups = [...new Set(toolNames.map(getToolGroup))];
  return groups.sort((a, b) => {
    if (a === "core") return -1;
    if (b === "core") return 1;
    if (a === "other") return 1;
    if (b === "other") return -1;
    return a.localeCompare(b);
  });
}

/**
 * Get a display-friendly label for a group key.
 * Catalog groups use their label, unknown MCP groups title-case all segments.
 */
function formatGroupLabel(groupKey) {
  const entry = getCatalogEntry(groupKey);
  if (entry) return entry.label;
  if (groupKey === "core") return "Core";
  if (groupKey === "other") return "Other";
  // Unknown MCP: title-case all segments for full readable label
  return groupKey
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

module.exports = { getToolGroup, groupTools, getAvailableGroups, setCoreTools, formatGroupLabel };
