// ─── App Config ──────────────────────────────────────────────────────────────
//
// Simple feature flag config for free/premium tier gating.
// Reads from data/app-config.json. Defaults to premium: false if missing.
// Designed to be swapped later for a real entitlement/licensing system.

const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", "data", "app-config.json");

const DEFAULTS = {
  premium: false,
};

let config = null;

function loadAppConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) };
    } else {
      config = { ...DEFAULTS };
      // Create the file with defaults so it's easy to find and edit
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
    }
  } catch (err) {
    console.error("  [config] Failed to load app config:", err.message);
    config = { ...DEFAULTS };
  }
  return config;
}

function isPremium() {
  if (!config) loadAppConfig();
  return config.premium === true;
}

function getAppConfig() {
  if (!config) loadAppConfig();
  return { ...config };
}

module.exports = { loadAppConfig, isPremium, getAppConfig };
