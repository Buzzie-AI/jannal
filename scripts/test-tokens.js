#!/usr/bin/env node
/**
 * Test token estimation and context window logic without UI or server.
 * Run: node scripts/test-tokens.js
 */

const {
  estimateTokens,
  estimateToolTokens,
  getBudget,
  inferBudget,
  analyzeSegments,
  CHARS_PER_TOKEN,
  CONTEXT_TIERS,
} = require("../lib/tokens");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log("Testing lib/tokens.js\n");

// ─── estimateTokens ────────────────────────────────────────────────────────
console.log("1. estimateTokens");
assert(estimateTokens("") === 0, "empty string => 0");
assert(estimateTokens(null) === 0, "null => 0");
assert(estimateTokens(undefined) === 0, "undefined => 0");
const hello = "Hello, world!";
assert(estimateTokens(hello) === Math.ceil(hello.length / CHARS_PER_TOKEN), "string estimate");
assert(estimateTokens({ a: 1, b: "foo" }) > 0, "object serialized");
console.log("   ✓ estimateTokens OK\n");

// ─── estimateToolTokens ────────────────────────────────────────────────────
console.log("2. estimateToolTokens");
const tool = { name: "test_tool", description: "A test", input_schema: {} };
assert(estimateToolTokens(tool) === estimateTokens(tool), "matches estimateTokens");
console.log("   ✓ estimateToolTokens OK\n");

// ─── getBudget ──────────────────────────────────────────────────────────────
console.log("3. getBudget (context window size)");
assert(getBudget(null) === 200000, "null => 200k default");
assert(getBudget("claude-sonnet-4-20250514") === 200000, "claude-sonnet => 200k");
assert(getBudget("claude-opus-4-5") === 1000000, "opus-4-5 => 1M");
assert(getBudget("claude-3-5-haiku") === 200000, "haiku => 200k");
assert(getBudget("gpt-4o") === 128000, "gpt-4o => 128k");
console.log("   ✓ getBudget OK\n");

// ─── inferBudget ────────────────────────────────────────────────────────────
console.log("4. inferBudget");
assert(inferBudget("claude-sonnet-4", 50000) === 200000, "50k usage => 200k budget");
assert(inferBudget("claude-sonnet-4", 250000) === 1000000, "250k usage => 1M tier");
assert(inferBudget("claude-opus-4-5", 500000) === 1000000, "opus 500k => 1M");
console.log("   ✓ inferBudget OK\n");

// ─── analyzeSegments ────────────────────────────────────────────────────────
console.log("5. analyzeSegments (pure request analysis)");
const body = {
  model: "claude-sonnet-4-20250514",
  system: "You are helpful.",
  messages: [{ role: "user", content: "Hi" }],
};
const { segments, totalEstimatedTokens, budget } = analyzeSegments(body);
assert(segments.length === 2, "system + 1 message");
assert(segments[0].type === "system", "first is system");
assert(segments[1].type === "message", "second is message");
assert(totalEstimatedTokens > 0, "has total");
assert(budget === 200000, "budget 200k for small request");
console.log(`   Segments: ${segments.length}, Total: ${totalEstimatedTokens}, Budget: ${budget}`);
console.log("   ✓ analyzeSegments OK\n");

// ─── With tools ─────────────────────────────────────────────────────────────
const bodyWithTools = {
  model: "claude-sonnet-4",
  system: "Help",
  tools: [{ name: "foo", description: "bar", input_schema: {} }],
  messages: [],
};
const out2 = analyzeSegments(bodyWithTools);
assert(out2.segments.some((s) => s.type === "tools"), "has tools segment");
console.log("   ✓ analyzeSegments with tools OK\n");

console.log("All tests passed.");
console.log(`\nConstants: CHARS_PER_TOKEN=${CHARS_PER_TOKEN}, CONTEXT_TIERS=[${CONTEXT_TIERS.join(", ")}]`);
