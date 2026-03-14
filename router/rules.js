// ─── Keyword/Pattern Matcher ──────────────────────────────────────────────────
//
// Fast-path intent detection via regex patterns. Returns matched groups,
// confidence, and reason — or null if no patterns match.
// Multi-intent: if multiple rules match, all matched groups are included.

const RULES = [
  {
    patterns: [/\b(linear|ticket|issue|sprint|roadmap|backlog)\b/i],
    groups: ["linear"],
    reason: "Keyword: project tracking",
  },
  {
    patterns: [/\b(firebase|firestore|cloud\s*function|hosting|realtime\s*database)\b/i],
    groups: ["firebase"],
    reason: "Keyword: Firebase",
  },
  {
    patterns: [/\b(supabase|database|query|sql|table|schema|row|column)\b/i],
    groups: ["supabase"],
    reason: "Keyword: database",
  },
  {
    patterns: [/\b(playwright|browser|screenshot|click|navigate|page)\b/i],
    groups: ["playwright"],
    reason: "Keyword: browser automation",
  },
  {
    patterns: [/\b(docs?|documentation|library|reference|look\s*up)\b/i],
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
