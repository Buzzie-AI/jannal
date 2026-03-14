// ─── Keyword/Pattern Matcher ──────────────────────────────────────────────────
//
// Fast-path intent detection via regex patterns. Returns matched groups,
// confidence, and reason — or null if no patterns match.
// Multi-intent: if multiple rules match, all matched groups are included.

const RULES = [
  {
    patterns: [/\b(linear|ticket|sprint|roadmap|backlog)\b/i],
    groups: ["linear"],
    reason: "Keyword: project tracking",
  },
  {
    patterns: [/\b(firebase|firestore|cloud\s*function|hosting|realtime\s*database)\b/i],
    groups: ["firebase"],
    reason: "Keyword: Firebase",
  },
  {
    // "database", "query", etc. removed — too generic, false-match on non-supabase contexts
    patterns: [/\b(supabase)\b/i],
    groups: ["supabase"],
    reason: "Keyword: Supabase",
  },
  {
    // "page", "click", "navigate" removed — too generic, false-match on UI/code discussions
    patterns: [/\b(playwright|browser\s*(?:test|automat)|screenshot|take\s*a?\s*screenshot)\b/i],
    groups: ["playwright"],
    reason: "Keyword: browser automation",
  },
  {
    // URL + browser-review intent: user wants to view/inspect/test a webpage.
    // Requires BOTH a URL and a specific browser-review verb to avoid matching
    // API endpoints, GitHub links, or error URLs mentioned in code discussions.
    patterns: [
      /https?:\/\/\S+[\s\S]{0,200}\b(?:visit|navigate\s+to|browse|demo|experience|preview|landing\s*page|open\s+(?:this|it|the))\b/i,
      /\b(?:visit|navigate\s+to|browse|demo|experience|preview|landing\s*page|open\s+(?:this|it|the))\b[\s\S]{0,200}https?:\/\/\S+/i,
    ],
    groups: ["playwright"],
    reason: "Keyword: URL + browser review",
  },
  {
    // "doc", "reference" removed — too generic, match JSDoc/code references
    patterns: [/\b(context7|documentation|library\s*docs?|look\s*up\s*docs?)\b/i],
    groups: ["context7"],
    reason: "Keyword: documentation",
  },
];

const RULES_CONFIDENCE = 0.85;

/**
 * Match user message against keyword rules.
 * Only returns groups that exist in the candidate set.
 *
 * @param {string} message - The user message to match
 * @param {string[]} candidateGroups - Groups available in this request
 * @returns {{ groups: string[], confidence: number, reason: string } | null}
 */
function matchRules(message, candidateGroups) {
  if (!message || !candidateGroups || candidateGroups.length === 0) return null;

  const candidateSet = new Set(candidateGroups);
  const matchedGroups = [];
  const reasons = [];

  for (const rule of RULES) {
    const hit = rule.patterns.some((p) => p.test(message));
    if (!hit) continue;

    // Only include groups present in the candidate set
    const validGroups = rule.groups.filter((g) => candidateSet.has(g));
    if (validGroups.length > 0) {
      matchedGroups.push(...validGroups);
      reasons.push(rule.reason);
    }
  }

  if (matchedGroups.length === 0) return null;

  return {
    groups: [...new Set(matchedGroups)],
    confidence: RULES_CONFIDENCE,
    reason: reasons.join("; "),
  };
}

module.exports = { matchRules, RULES_CONFIDENCE };
