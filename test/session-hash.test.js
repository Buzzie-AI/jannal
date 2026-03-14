// ─── Session Hash Stability Tests ────────────────────────────────────────────
//
// Verifies that getSessionHash() produces stable hashes after billing header
// stripping, and that different sessions get different hashes.
//
// Run: node --test test/session-hash.test.js

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// We can't require server.js directly (it starts a server), so we inline
// the hash logic for testing. This mirrors getSessionHash() exactly.
function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

function getSessionHash(body) {
  if (!body.system) return "no-system";
  let text;
  if (typeof body.system === "string") {
    text = body.system.trim();
  } else if (Array.isArray(body.system)) {
    text = body.system
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text.trim())
      .join("\n")
      .trim();
  } else {
    return "no-system";
  }
  if (!text) return "no-system";
  text = text.replace(/^x-anthropic-billing-header:[^\n]*\n?/, "");
  const model = body.model || "unknown";
  return simpleHash(model + "|" + text.slice(0, 5000));
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

// Real system prompt structure from diagnostic logs
const SYSTEM_PROMPT_BASE =
  "You are Claude Code, Anthropic's official CLI for Claude.\n" +
  "You are an interactive agent that helps users with software engineering tasks.\n" +
  "IMPORTANT: Assist with authorized security testing...";

function makeSystemBlocks(billingCch, promptText) {
  return [
    {
      type: "text",
      text: `x-anthropic-billing-header: cc_version=2.1.76.4d1; cc_entrypoint=cli; cch=${billingCch};`,
    },
    { type: "text", text: promptText },
  ];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("getSessionHash: billing header stripping", () => {
  it("same prompt with different cch= produces same hash", () => {
    const body1 = {
      model: "claude-opus-4-6",
      system: makeSystemBlocks("c74c0", SYSTEM_PROMPT_BASE),
    };
    const body2 = {
      model: "claude-opus-4-6",
      system: makeSystemBlocks("5f177", SYSTEM_PROMPT_BASE),
    };
    const body3 = {
      model: "claude-opus-4-6",
      system: makeSystemBlocks("3b315", SYSTEM_PROMPT_BASE),
    };

    const h1 = getSessionHash(body1);
    const h2 = getSessionHash(body2);
    const h3 = getSessionHash(body3);

    assert.equal(h1, h2, "Different cch= values should produce same hash");
    assert.equal(h2, h3, "Different cch= values should produce same hash");
    assert.notEqual(h1, "no-system");
  });

  it("different prompts produce different hashes", () => {
    const body1 = {
      model: "claude-opus-4-6",
      system: makeSystemBlocks("abc", SYSTEM_PROMPT_BASE),
    };
    const body2 = {
      model: "claude-opus-4-6",
      system: makeSystemBlocks(
        "abc",
        "Different system prompt for a skill session"
      ),
    };

    assert.notEqual(
      getSessionHash(body1),
      getSessionHash(body2),
      "Different system prompts should produce different hashes"
    );
  });

  it("different models produce different hashes", () => {
    const body1 = {
      model: "claude-opus-4-6",
      system: makeSystemBlocks("abc", SYSTEM_PROMPT_BASE),
    };
    const body2 = {
      model: "claude-haiku-4-5-20251001",
      system: makeSystemBlocks("abc", SYSTEM_PROMPT_BASE),
    };

    assert.notEqual(
      getSessionHash(body1),
      getSessionHash(body2),
      "Different models should produce different hashes"
    );
  });

  it("no system prompt returns 'no-system'", () => {
    assert.equal(getSessionHash({ model: "claude-opus-4-6" }), "no-system");
    assert.equal(
      getSessionHash({ model: "claude-opus-4-6", system: [] }),
      "no-system"
    );
  });

  it("billing header at start of string system prompt is stripped", () => {
    const body1 = {
      model: "claude-opus-4-6",
      system:
        "x-anthropic-billing-header: cc_version=2.1.76.4d1; cch=aaa;\n" +
        SYSTEM_PROMPT_BASE,
    };
    const body2 = {
      model: "claude-opus-4-6",
      system:
        "x-anthropic-billing-header: cc_version=2.1.76.4d1; cch=bbb;\n" +
        SYSTEM_PROMPT_BASE,
    };

    assert.equal(
      getSessionHash(body1),
      getSessionHash(body2),
      "String system prompts with different cch= should hash the same"
    );
  });
});
