// ─── Server Group Catalog ─────────────────────────────────────────────────────
//
// Backend source of truth for known MCP server groups.
// Each entry describes a server's capabilities for routing and telemetry.
// Unknown MCP servers are handled dynamically by grouping.js — they don't
// need catalog entries to be first-class groups.

const CATALOG = {
  linear: {
    label: "Linear",
    description: "Project management, issues, tickets, sprint planning, roadmaps",
    examples: ["create issue", "plan sprint", "update ticket", "list issues"],
    toolPrefixes: ["mcp__claude_ai_linear__", "mcp__linear__", "mcp__linear-server__"],
  },
  firebase: {
    label: "Firebase",
    description: "Cloud functions, Firestore, hosting, auth, storage, app management",
    examples: ["deploy to firebase", "query firestore", "firebase auth", "create project"],
    toolPrefixes: ["mcp__plugin_firebase_firebase__", "mcp__firebase__"],
  },
  playwright: {
    label: "Playwright",
    description: "Browser automation, UI testing, screenshots, page interaction",
    examples: ["take screenshot", "click button", "browser test", "navigate to page"],
    toolPrefixes: ["mcp__plugin_playwright_playwright__", "mcp__playwright__"],
  },
  context7: {
    label: "Context7",
    description: "Documentation lookup, library docs, code examples",
    examples: ["look up docs", "find documentation", "library reference"],
    toolPrefixes: ["mcp__plugin_context7_context7__", "mcp__context7__"],
  },
  supabase: {
    label: "Supabase",
    description: "Database queries, auth, storage, edge functions, data management",
    examples: ["query database", "insert data", "supabase auth", "database schema"],
    toolPrefixes: ["mcp__supabase__", "mcp__supabase-production__", "mcp__supabase-staging__"],
  },
};

const DEFAULT_CORE_TOOLS = [
  // File & code tools
  "Agent", "Bash", "Read", "Write", "Edit", "Glob", "Grep",
  // Web & research tools
  "WebSearch", "WebFetch",
  // Code intelligence
  "LSP", "NotebookEdit", "NotebookRead",
  // Workflow tools
  "EnterPlanMode", "ExitPlanMode", "AskUserQuestion", "Skill",
  // Task management
  "TaskCreate", "TaskUpdate", "TaskGet", "TaskList", "TodoWrite",
  // Session management
  "EnterWorktree", "ExitWorktree",
  // Scheduling
  "CronCreate", "CronDelete", "CronList",
  // MCP resource tools
  "ListMcpResourcesTool", "ReadMcpResourceTool",
];

function getCatalogEntry(groupName) {
  return CATALOG[groupName] || null;
}

module.exports = { CATALOG, DEFAULT_CORE_TOOLS, getCatalogEntry };
