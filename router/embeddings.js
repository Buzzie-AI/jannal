// ─── Embedding Service ────────────────────────────────────────────────────────
//
// Singleton embedding service using BAAI/bge-small-en-v1.5 (384-dim, MIT, 33MB).
// Pre-computes catalog group embeddings at init. Ranks candidate groups by
// cosine similarity against the user message.
//
// Only catalog-backed groups can be ranked — unknown MCP groups have no
// description to embed, so they're never scored or stripped here.

const path = require("path");
const { CATALOG } = require("./catalog");

const MODEL_NAME = "BAAI/bge-small-en-v1.5";
const CACHE_DIR = path.join(__dirname, "..", "data", "models-cache");
const SIMILARITY_THRESHOLD = 0.4;
const RANK_TIMEOUT_MS = 200;

// ─── Singleton state ──────────────────────────────────────────────────────────

let pipeline = null;
let catalogEmbeddings = null; // Map<groupName, Float32Array>
let ready = false;
let failed = false;
let initError = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function embed(text) {
  if (!pipeline) return null;
  const result = await pipeline(text, { pooling: "mean", normalize: true });
  return result.data;
}

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget initialization. Loads the embedding model and pre-computes
 * embeddings for all catalog group descriptions. Failure is logged but does
 * not prevent the proxy from running (falls back to rules-only mode).
 */
async function initEmbeddings() {
  try {
    console.log("  [embeddings] Loading model:", MODEL_NAME);
    const startMs = Date.now();

    // Dynamic import for ESM module in CommonJS context
    const { pipeline: createPipeline, env } = await import("@huggingface/transformers");

    // Configure cache directory
    env.cacheDir = CACHE_DIR;

    pipeline = await createPipeline("feature-extraction", MODEL_NAME, {
      dtype: "fp32",
    });

    const loadMs = Date.now() - startMs;
    console.log(`  [embeddings] Model loaded in ${loadMs}ms`);

    // Pre-compute catalog embeddings
    catalogEmbeddings = new Map();
    for (const [groupName, entry] of Object.entries(CATALOG)) {
      const text = `${entry.description}. ${entry.examples.join(", ")}`;
      const embedding = await embed(text);
      if (embedding) {
        catalogEmbeddings.set(groupName, embedding);
      }
    }

    const totalMs = Date.now() - startMs;
    console.log(
      `  [embeddings] Ready: ${catalogEmbeddings.size} groups embedded in ${totalMs}ms`
    );

    ready = true;
  } catch (err) {
    failed = true;
    initError = err.message;
    console.error("  [embeddings] Failed to initialize:", err.message);
  }
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * @returns {boolean} Whether the embedding service is ready for queries
 */
function isEmbeddingsReady() {
  return ready && !failed;
}

/**
 * @returns {{ ready: boolean, failed: boolean, error: string | null }}
 */
function getEmbeddingsStatus() {
  return { ready, failed, error: initError };
}

/**
 * Rank candidate groups by similarity to the user message.
 * Only scores catalog-backed groups (those with pre-computed embeddings).
 *
 * @param {string} userMessage - The user's message text
 * @param {string[]} catalogGroups - Catalog-backed candidate group names
 * @returns {Promise<{ groups: string[], confidence: number, scores: Object } | null>}
 */
async function rankGroups(userMessage, catalogGroups) {
  if (!ready || !pipeline || !catalogEmbeddings) return null;
  if (!userMessage || !catalogGroups || catalogGroups.length === 0) return null;

  // Apply timeout
  const result = await Promise.race([
    _rankGroupsInner(userMessage, catalogGroups),
    new Promise((resolve) => setTimeout(() => resolve(null), RANK_TIMEOUT_MS)),
  ]);

  return result;
}

async function _rankGroupsInner(userMessage, catalogGroups) {
  try {
    const msgEmbedding = await embed(userMessage);
    if (!msgEmbedding) return null;

    const scores = {};
    const matched = [];

    for (const group of catalogGroups) {
      const groupEmb = catalogEmbeddings.get(group);
      if (!groupEmb) continue;

      const score = cosineSimilarity(msgEmbedding, groupEmb);
      scores[group] = parseFloat(score.toFixed(4));

      if (score >= SIMILARITY_THRESHOLD) {
        matched.push({ group, score });
      }
    }

    if (matched.length === 0) return null;

    // Sort by score descending
    matched.sort((a, b) => b.score - a.score);
    const topScore = matched[0].score;

    return {
      groups: matched.map((m) => m.group),
      confidence: parseFloat(topScore.toFixed(4)),
      scores,
    };
  } catch (err) {
    console.error("  [embeddings] rankGroups error:", err.message);
    return null;
  }
}

module.exports = {
  initEmbeddings,
  isEmbeddingsReady,
  getEmbeddingsStatus,
  rankGroups,
  MODEL_NAME,
  CACHE_DIR,
};
