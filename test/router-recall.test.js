// ─── Router Recall Regression Tests ──────────────────────────────────────────
//
// Deterministic tests based on real shadow-mode failures from Step 3 analysis.
// Each test case is derived from actual telemetry events where the router
// predicted a group should be stripped but the model used tools from that group.
//
// Run: node --test test/router-recall.test.js

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { matchRules } = require("../router/rules");
const { selectIntentMessage } = require("../router/index");
const { getCatalogEntry } = require("../router/catalog");

// Realistic candidate groups for a full Claude Code setup with MCP servers
const ALL_CATALOG_GROUPS = [
  "linear",
  "firebase",
  "playwright",
  "context7",
  "supabase",
];

/**
 * Simulate the group-selection logic from router/index.js.
 * This mirrors the merge + stripping path without requiring async embeddings.
 */
function simulateGroupSelection(rulesResult, catalogGroups) {
  let matchedBy, mergedGroups, confidence;

  if (rulesResult) {
    matchedBy = "rules";
    mergedGroups = rulesResult.groups;
    confidence = rulesResult.confidence;
  } else {
    matchedBy = "default_core_only";
    mergedGroups = [];
    confidence = 0;
  }

  const selectedGroups = new Set(mergedGroups);
  selectedGroups.add("core");
  selectedGroups.add("other"); // unknown groups always retained

  const strippedGroups = catalogGroups.filter((g) => {
    if (selectedGroups.has(g)) return false;
    const entry = getCatalogEntry(g);
    return entry && entry.stripEligible === true;
  });

  return { matchedBy, selectedGroups: [...selectedGroups], strippedGroups, confidence };
}

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

// ─── Playwright Recall ───────────────────────────────────────────────────────
//
// Real failure from shadow telemetry:
//   turns: 29, 30, 31, 32
//   matched_by: default_core_only
//   stripped: playwright (among others)
//   used: browser_navigate, browser_wait_for, browser_take_screenshot, browser_close
//   intent: "yes.. see this https://demo.mercury.com/dashboard they have teh
//     entire stuff here for people to see/experince. maybe we should link from
//     the landing page of mobile app (as demo view - experince it)"

describe("playwright recall: URL + browser-review intent", () => {
  const REAL_INTENT =
    "yes.. see this https://demo.mercury.com/dashboard they have teh entire " +
    "stuff here for people to see/experince. maybe we should link from the " +
    "landing page of mobile app (as demo view - experince it)";

  it("rules match playwright for URL + demo/experience intent", () => {
    const result = matchRules(REAL_INTENT, ALL_CATALOG_GROUPS);
    assert.ok(result, "Rules should produce a match");
    assert.ok(
      result.groups.includes("playwright"),
      "playwright must be in matched groups"
    );
  });

  it("group selection retains playwright, strips others", () => {
    const rules = matchRules(REAL_INTENT, ALL_CATALOG_GROUPS);
    const selection = simulateGroupSelection(rules, ALL_CATALOG_GROUPS);
    assert.ok(
      !selection.strippedGroups.includes("playwright"),
      "playwright must NOT be stripped"
    );
    assert.ok(
      selection.strippedGroups.length > 0,
      "Other groups should still be stripped"
    );
  });

  // Variations of the same intent pattern
  it("matches URL + 'visit this site'", () => {
    const msg = "visit this site https://app.example.com and check the layout";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("playwright"));
  });

  it("matches URL + 'preview' intent", () => {
    const msg =
      "can you preview https://staging.myapp.com/onboarding and see if it works";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("playwright"));
  });

  it("matches 'navigate to' + URL", () => {
    const msg = "navigate to https://dashboard.stripe.com and get a screenshot";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("playwright"));
  });

  it("matches URL + 'demo' intent", () => {
    const msg =
      "the demo is at https://demo.mercury.com/dashboard, check what they did";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("playwright"));
  });

  it("matches URL + 'landing page' mention", () => {
    const msg =
      "look at their landing page https://www.linear.app and see the design";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("playwright"));
  });

  // Negative cases: URLs without browser-review intent
  it("does NOT match URL in code/API context", () => {
    const msg =
      "the API endpoint is https://api.example.com/v1/users, fix the auth header";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    // Should NOT match playwright (no browser-review intent)
    const hasPlaywright = result?.groups.includes("playwright") || false;
    assert.equal(hasPlaywright, false, "API URL should not trigger playwright");
  });

  it("does NOT match URL in error message", () => {
    const msg =
      "getting 500 error from https://prod.myapp.com/api/webhook, check the logs";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    const hasPlaywright = result?.groups.includes("playwright") || false;
    assert.equal(
      hasPlaywright,
      false,
      "Error investigation URL should not trigger playwright"
    );
  });

  it("does NOT match bare URL without action verb", () => {
    const msg = "the repo is at https://github.com/org/project";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    const hasPlaywright = result?.groups.includes("playwright") || false;
    assert.equal(
      hasPlaywright,
      false,
      "Bare URL mention should not trigger playwright"
    );
  });
});

// ─── Supabase Recall ─────────────────────────────────────────────────────────
//
// Real failures from shadow telemetry:
//
// Case 1 (embeddings, conf=0.577):
//   stripped: supabase
//   used: supabase-production__execute_sql ×3
//   intent: "i think someone needs to see a demo client and then test and see
//     actual client. do we have data showing that?"
//
// Case 2 (default_core_only):
//   stripped: supabase
//   used: supabase-production__execute_sql ×3
//   intent: "improve your prmopt. ijprove your strategy, this looks like a
//     high school kid strategy"
//
// These are documented as KNOWN LIMITATIONS of message-level routing.
// The model's decision to use Supabase is not predictable from the user message.

describe("supabase recall: known limitation of message-level routing", () => {
  it("'do we have data showing that' does NOT match supabase rule (by design)", () => {
    const msg =
      "i think someone needs to see a demo client and then test and see actual client. do we have data showing that?";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    const hasSupabase = result?.groups.includes("supabase") || false;
    // This CORRECTLY does not match — "data" is too generic for a supabase rule.
    // The model's choice to query Supabase was not inferable from the message.
    assert.equal(
      hasSupabase,
      false,
      "Generic 'data' mention should not trigger supabase"
    );
  });

  it("'improve your strategy' does NOT match supabase rule (by design)", () => {
    const msg =
      "improve your prmopt. ijprove your strategy, this looks like a high school kid strategy";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    const hasSupabase = result?.groups.includes("supabase") || false;
    assert.equal(
      hasSupabase,
      false,
      "Unrelated feedback should not trigger supabase"
    );
  });

  it("group selection strips supabase for generic messages", () => {
    const msg = "improve the growth strategy and make it more compelling";
    const rules = matchRules(msg, ALL_CATALOG_GROUPS);
    const selection = simulateGroupSelection(rules, ALL_CATALOG_GROUPS);
    assert.equal(selection.matchedBy, "default_core_only");
    assert.ok(
      selection.strippedGroups.includes("supabase"),
      "supabase should be stripped for generic messages"
    );
  });

  // Positive: explicit supabase mention still works
  it("explicit 'supabase' keyword retains supabase", () => {
    const msg = "query supabase for the latest user signups";
    const result = matchRules(msg, ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("supabase"));
  });
});

// ─── Default Core Only Behavior ──────────────────────────────────────────────

describe("default_core_only: no signal strips all specialized groups", () => {
  it("generic message strips all catalog groups", () => {
    const msg = "help me refactor this function to be more readable";
    const rules = matchRules(msg, ALL_CATALOG_GROUPS);
    const selection = simulateGroupSelection(rules, ALL_CATALOG_GROUPS);
    assert.equal(selection.matchedBy, "default_core_only");
    assert.deepEqual(
      selection.strippedGroups.sort(),
      ALL_CATALOG_GROUPS.sort(),
      "All specialized groups should be stripped"
    );
  });

  it("retains core and other groups", () => {
    const msg = "what is the meaning of life";
    const rules = matchRules(msg, ALL_CATALOG_GROUPS);
    const selection = simulateGroupSelection(rules, ALL_CATALOG_GROUPS);
    assert.ok(selection.selectedGroups.includes("core"));
    assert.ok(selection.selectedGroups.includes("other"));
  });
});

// ─── Existing Rules Still Work ───────────────────────────────────────────────

describe("existing rules: positive signal retains group", () => {
  it("linear keyword retains linear", () => {
    const result = matchRules(
      "create a linear ticket for the auth bug",
      ALL_CATALOG_GROUPS
    );
    assert.ok(result?.groups.includes("linear"));
  });

  it("firebase keyword retains firebase", () => {
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

  it("supabase keyword retains supabase", () => {
    const result = matchRules("check supabase auth setup", ALL_CATALOG_GROUPS);
    assert.ok(result?.groups.includes("supabase"));
  });
});
