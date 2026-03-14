// ─── Router Recall Regression Tests ──────────────────────────────────────────
//
// Deterministic tests based on real shadow-mode failures from Step 3 analysis.
// Each test case is derived from actual telemetry events where the router
// predicted a group should be stripped but the model used tools from that group.
//
// Run: node --test test/router-recall.test.js

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const { matchRules } = require("../router/rules");
const { selectIntentMessage, routeRequest } = require("../router/index");
const { getCatalogEntry, DEFAULT_CORE_TOOLS } = require("../router/catalog");
const { _setConfigForTest } = require("../router/log");

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const ALL_CATALOG_GROUPS = [
  "linear",
  "firebase",
  "playwright",
  "context7",
  "supabase",
];

// Representative tool names from a real 170-tool Claude Code session.
// Enough representatives per group to exceed min_tool_count (20) and
// min_tool_tokens (5000) thresholds so routeRequest doesn't skip routing.
const REALISTIC_TOOL_NAMES = [
  // Core
  "Agent", "Bash", "Read", "Write", "Edit", "Glob", "Grep",
  "WebSearch", "WebFetch", "LSP", "EnterPlanMode", "ExitPlanMode",
  "AskUserQuestion", "TaskCreate", "TaskUpdate", "TaskGet", "TaskList",
  // Linear (catalog: mcp__claude_ai_linear__*)
  "mcp__claude_ai_linear__list_issues",
  "mcp__claude_ai_linear__get_issue",
  "mcp__claude_ai_linear__save_issue",
  "mcp__claude_ai_linear__list_teams",
  "mcp__claude_ai_linear__list_projects",
  // Firebase (catalog: mcp__plugin_firebase_firebase__*)
  "mcp__plugin_firebase_firebase__firebase_get_project",
  "mcp__plugin_firebase_firebase__firebase_init",
  "mcp__plugin_firebase_firebase__firebase_get_environment",
  // Playwright (catalog: mcp__plugin_playwright_playwright__*)
  "mcp__plugin_playwright_playwright__browser_navigate",
  "mcp__plugin_playwright_playwright__browser_snapshot",
  "mcp__plugin_playwright_playwright__browser_click",
  "mcp__plugin_playwright_playwright__browser_take_screenshot",
  "mcp__plugin_playwright_playwright__browser_close",
  // Context7 (catalog: mcp__plugin_context7_context7__*)
  "mcp__plugin_context7_context7__resolve-library-id",
  "mcp__plugin_context7_context7__query-docs",
  // Supabase (catalog: mcp__supabase-production__*)
  "mcp__supabase-production__execute_sql",
  "mcp__supabase-production__list_tables",
  "mcp__supabase-staging__execute_sql",
  "mcp__supabase-staging__list_tables",
  // Other (uncategorized)
  "NotebookEdit", "NotebookRead", "Skill", "CronCreate",
  "EnterWorktree", "ExitWorktree", "ListMcpResourcesTool",
];

/**
 * Build a stored metadata object suitable for routeRequest().
 * Mirrors the shape created by server.js analyzeRequest() + reqStore.set().
 */
function buildStored(userMessages) {
  return {
    toolNames: REALISTIC_TOOL_NAMES,
    toolCount: REALISTIC_TOOL_NAMES.length,
    estimatedToolTokens: 44000, // ~44k tokens, realistic for 170 tools
    userMessages,
    sessionHash: "test-session",
    groupId: 0,
    model: "claude-opus-4-6",
    stream: true,
  };
}

// ─── Test setup ──────────────────────────────────────────────────────────────

// Seed deterministic router config. Does NOT read from disk — tests are
// independent of whatever router-state.json happens to exist locally.
before(() => {
  _setConfigForTest({
    mode: "shadow",
    min_tool_count: 20,
    min_tool_tokens: 5000,
    auto_confidence_threshold: 0.9,
    sticky_confidence_threshold: 0.92,
    sticky_ttl_ms: 1800000,
    core_tools: DEFAULT_CORE_TOOLS,
  });
});

// ─── Intent Message Selection ────────────────────────────────────────────────

describe("selectIntentMessage", () => {
  it("skips compact/continuation boilerplate", () => {
    const msgs = [
      "This session is being continued from a previous conversation that ran out of context.",
    ];
    assert.equal(selectIntentMessage(msgs), "");
  });

  it("prefers last non-boilerplate message", () => {
    const msgs = [
      "deploy to firebase hosting",
      "This session is being continued from a previous conversation.",
    ];
    assert.equal(selectIntentMessage(msgs), "deploy to firebase hosting");
  });

  it("skips short/empty messages", () => {
    const msgs = ["  ", "hi", "create a linear ticket for the auth bug"];
    assert.equal(
      selectIntentMessage(msgs),
      "create a linear ticket for the auth bug"
    );
  });

  it("returns empty for all-boilerplate messages", () => {
    const msgs = [
      "Summary: here is what happened...",
      "This session is being continued from a previous conversation.",
    ];
    assert.equal(selectIntentMessage(msgs), "");
  });
});

// ─── Playwright Recall: Unit Tests ───────────────────────────────────────────
//
// Real failure from shadow telemetry:
//   turns: 29, 30, 31, 32
//   matched_by: default_core_only
//   stripped: playwright (among others)
//   used: browser_navigate, browser_wait_for, browser_take_screenshot, browser_close
//   intent: "yes.. see this https://demo.mercury.com/dashboard they have teh
//     entire stuff here for people to see/experince. maybe we should link from
//     the landing page of mobile app (as demo view - experince it)"

describe("playwright recall: rules unit tests", () => {
  const REAL_INTENT =
    "yes.. see this https://demo.mercury.com/dashboard they have teh entire " +
    "stuff here for people to see/experince. maybe we should link from the " +
    "landing page of mobile app (as demo view - experince it)";

  it("real telemetry message matches via 'landing page' + URL", () => {
    const result = matchRules(REAL_INTENT, ALL_CATALOG_GROUPS);
    assert.ok(result, "Rules should produce a match");
    assert.ok(
      result.groups.includes("playwright"),
      "playwright must be in matched groups"
    );
  });

  // Positive: specific browser-review phrases + URL
  it("matches URL + 'visit'", () => {
    const msg = "visit https://app.example.com and check the layout";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("playwright"));
  });

  it("matches URL + 'preview'", () => {
    const msg = "can you preview https://staging.myapp.com/onboarding";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("playwright"));
  });

  it("matches 'navigate to' + URL", () => {
    const msg = "navigate to https://dashboard.stripe.com and get a screenshot";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("playwright"));
  });

  it("matches URL + 'landing page'", () => {
    const msg =
      "look at their landing page https://www.linear.app and see the design";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("playwright"));
  });

  it("matches 'open in browser' + URL", () => {
    const msg = "open in browser https://localhost:3000/dashboard";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("playwright"));
  });

  // Negative: URLs without browser-review intent — the precision boundary
  it("does NOT match URL in code/API context", () => {
    const msg =
      "the API endpoint is https://api.example.com/v1/users, fix the auth header";
    const hasPlaywright =
      matchRules(msg, ALL_CATALOG_GROUPS)?.groups.includes("playwright") ||
      false;
    assert.equal(hasPlaywright, false, "API URL should not trigger playwright");
  });

  it("does NOT match URL in error message", () => {
    const msg =
      "getting 500 error from https://prod.myapp.com/api/webhook, check the logs";
    const hasPlaywright =
      matchRules(msg, ALL_CATALOG_GROUPS)?.groups.includes("playwright") ||
      false;
    assert.equal(hasPlaywright, false);
  });

  it("does NOT match bare URL without action verb", () => {
    const msg = "the repo is at https://github.com/org/project";
    const hasPlaywright =
      matchRules(msg, ALL_CATALOG_GROUPS)?.groups.includes("playwright") ||
      false;
    assert.equal(hasPlaywright, false);
  });

  it("does NOT match 'open this' + docs URL", () => {
    const msg = "open this https://react.dev/reference/react/useEffect";
    const hasPlaywright =
      matchRules(msg, ALL_CATALOG_GROUPS)?.groups.includes("playwright") ||
      false;
    assert.equal(hasPlaywright, false, "'open this' + docs URL is too generic");
  });

  it("does NOT match 'see this PR' link", () => {
    const msg =
      "see this PR https://github.com/org/repo/pull/123 for the context";
    const hasPlaywright =
      matchRules(msg, ALL_CATALOG_GROUPS)?.groups.includes("playwright") ||
      false;
    assert.equal(hasPlaywright, false, "PR link should not trigger playwright");
  });

  it("does NOT match 'check this Notion page'", () => {
    const msg =
      "check this Notion page https://notion.so/team/design-spec-abc123";
    const hasPlaywright =
      matchRules(msg, ALL_CATALOG_GROUPS)?.groups.includes("playwright") ||
      false;
    assert.equal(
      hasPlaywright,
      false,
      "Notion doc link should not trigger playwright"
    );
  });

  it("does NOT match generic 'demo' + URL without browser phrase", () => {
    const msg =
      "the demo is at https://demo.example.com/dashboard, check what they did";
    const hasPlaywright =
      matchRules(msg, ALL_CATALOG_GROUPS)?.groups.includes("playwright") ||
      false;
    assert.equal(
      hasPlaywright,
      false,
      "'demo' alone near URL is too generic"
    );
  });

  it("does NOT match 'experience' + URL without browser phrase", () => {
    const msg =
      "experience the new onboarding at https://app.example.com/signup";
    const hasPlaywright =
      matchRules(msg, ALL_CATALOG_GROUPS)?.groups.includes("playwright") ||
      false;
    assert.equal(
      hasPlaywright,
      false,
      "'experience' alone near URL is too generic"
    );
  });
});

// ─── Playwright Recall: Integration via routeRequest() ───────────────────────

describe("playwright recall: integration via routeRequest()", () => {
  const REAL_INTENT =
    "yes.. see this https://demo.mercury.com/dashboard they have teh entire " +
    "stuff here for people to see/experince. maybe we should link from the " +
    "landing page of mobile app (as demo view - experince it)";

  it("routeRequest retains playwright for URL + landing page intent", async () => {
    const result = await routeRequest({
      stored: buildStored([REAL_INTENT]),
      allToolNames: REALISTIC_TOOL_NAMES,
    });
    assert.ok(result.eligible, "Request should be eligible");
    assert.ok(
      !result.stripped_groups.includes("playwright"),
      "playwright must NOT be in stripped_groups"
    );
    assert.ok(
      result.selected_groups.includes("playwright"),
      "playwright must be in selected_groups"
    );
    // Other specialized groups without signal should still be stripped
    assert.ok(result.stripped_groups.length > 0, "Should still strip others");
  });

  it("routeRequest uses intent selection to skip boilerplate", async () => {
    const result = await routeRequest({
      stored: buildStored([
        "visit https://staging.myapp.com and check the design",
        "This session is being continued from a previous conversation.",
      ]),
      allToolNames: REALISTIC_TOOL_NAMES,
    });
    assert.ok(result.eligible);
    // Intent selection should find the visit+URL message, not the boilerplate
    assert.ok(
      result.selected_groups.includes("playwright"),
      "Should find playwright intent despite boilerplate being last message"
    );
  });
});

// ─── Supabase Recall: Known Limitation ───────────────────────────────────────

describe("supabase recall: known limitation of message-level routing", () => {
  it("'do we have data showing that' does NOT match supabase rule (by design)", () => {
    const msg =
      "i think someone needs to see a demo client and then test and see actual client. do we have data showing that?";
    const hasSupabase =
      matchRules(msg, ALL_CATALOG_GROUPS)?.groups.includes("supabase") || false;
    assert.equal(hasSupabase, false);
  });

  it("'improve your strategy' does NOT match supabase rule (by design)", () => {
    const msg =
      "improve your prmopt. ijprove your strategy, this looks like a high school kid strategy";
    const hasSupabase =
      matchRules(msg, ALL_CATALOG_GROUPS)?.groups.includes("supabase") || false;
    assert.equal(hasSupabase, false);
  });

  it("explicit 'supabase' keyword retains supabase", () => {
    const result = matchRules(
      "query supabase for the latest user signups",
      ALL_CATALOG_GROUPS
    );
    assert.ok(result?.groups.includes("supabase"));
  });
});

// ─── Default Core Only: Integration via routeRequest() ───────────────────────

describe("default_core_only: integration via routeRequest()", () => {
  it("generic message strips all strip-eligible catalog groups", async () => {
    const result = await routeRequest({
      stored: buildStored([
        "help me refactor this function to be more readable",
      ]),
      allToolNames: REALISTIC_TOOL_NAMES,
    });
    assert.ok(result.eligible);
    assert.equal(result.matched_by, "default_core_only");
    assert.equal(result.confidence, 0);
    // All 5 catalog groups should be stripped
    for (const g of ALL_CATALOG_GROUPS) {
      assert.ok(
        result.stripped_groups.includes(g),
        `${g} should be stripped for generic message`
      );
    }
    // Core and unknown groups retained
    assert.ok(result.selected_groups.includes("core"));
  });

  it("all-boilerplate messages produce default_core_only", async () => {
    const result = await routeRequest({
      stored: buildStored([
        "This session is being continued from a previous conversation.",
      ]),
      allToolNames: REALISTIC_TOOL_NAMES,
    });
    assert.ok(result.eligible);
    assert.equal(result.matched_by, "default_core_only");
    assert.ok(result.estimated_tokens_saved > 0, "Should predict savings");
  });

  it("linear keyword retains linear via routeRequest", async () => {
    const result = await routeRequest({
      stored: buildStored(["create a linear ticket for the auth bug"]),
      allToolNames: REALISTIC_TOOL_NAMES,
    });
    assert.ok(result.eligible);
    assert.ok(result.selected_groups.includes("linear"));
    assert.ok(!result.stripped_groups.includes("linear"));
    // Other groups should be stripped
    assert.ok(result.stripped_groups.includes("firebase"));
    assert.ok(result.stripped_groups.includes("supabase"));
  });

  it("intent_message is included in result", async () => {
    const result = await routeRequest({
      stored: buildStored(["deploy to firebase hosting"]),
      allToolNames: REALISTIC_TOOL_NAMES,
    });
    assert.ok(result.intent_message, "Result should include intent_message");
    assert.ok(result.intent_message.includes("firebase"));
  });
});

// ─── Existing Rules Still Work ───────────────────────────────────────────────

describe("existing rules: positive signal retains group", () => {
  it("linear keyword", () => {
    const result = matchRules(
      "create a linear ticket for the auth bug",
      ALL_CATALOG_GROUPS
    );
    assert.ok(result?.groups.includes("linear"));
  });

  it("firebase keyword", () => {
    const result = matchRules(
      "deploy to firebase hosting",
      ALL_CATALOG_GROUPS
    );
    assert.ok(result?.groups.includes("firebase"));
  });

  it("screenshot keyword retains playwright", () => {
    const result = matchRules(
      "take a screenshot of the page",
      ALL_CATALOG_GROUPS
    );
    assert.ok(result?.groups.includes("playwright"));
  });

  it("documentation keyword retains context7", () => {
    const result = matchRules(
      "look up the documentation for React hooks",
      ALL_CATALOG_GROUPS
    );
    assert.ok(result?.groups.includes("context7"));
  });

  it("supabase keyword", () => {
    const result = matchRules("check supabase auth setup", ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("supabase"));
  });
});
