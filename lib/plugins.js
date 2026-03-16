// ─── Plugin Host ──────────────────────────────────────────────────────────────
//
// Lightweight hook system for extending the Jannal proxy server.
// Plugins implement named hooks that the server calls at specific points.
// Core runs fine with zero plugins (free tier). Pro features register via plugin.

class PluginHost {
  constructor() {
    this.plugins = [];
  }

  register(plugin) {
    this.plugins.push(plugin);
  }

  /** Called during server startup init (load config, init data dirs, etc.) */
  async onInit(context) {
    for (const p of this.plugins) {
      if (p.onInit) await p.onInit(context);
    }
  }

  /** Called after server.listen() succeeds (warm up models, etc.) */
  async onServerStart(context) {
    for (const p of this.plugins) {
      if (p.onServerStart) await p.onServerStart(context);
    }
  }

  /**
   * Custom API route handler. Returns true if the plugin handled the request.
   * Plugins are tried in registration order; first handler wins.
   */
  onRoute(req, res, helpers) {
    for (const p of this.plugins) {
      if (p.onRoute && p.onRoute(req, res, helpers)) return true;
    }
    return false;
  }

  /** Called after request is analyzed, before forwarding to Anthropic. */
  async onRequestAnalyzed(analysis, meta) {
    for (const p of this.plugins) {
      if (p.onRequestAnalyzed) await p.onRequestAnalyzed(analysis, meta);
    }
  }

  /** Called after response is fully received from Anthropic. */
  async onResponseComplete(reqId, data) {
    for (const p of this.plugins) {
      if (p.onResponseComplete) await p.onResponseComplete(reqId, data);
    }
  }

  /** Collect extra fields for the WS connect message. */
  getConnectPayload() {
    let extra = {};
    for (const p of this.plugins) {
      if (p.getConnectPayload) {
        Object.assign(extra, p.getConnectPayload());
      }
    }
    return extra;
  }
}

module.exports = { PluginHost };
