# Privacy Policy

**Last updated:** March 29, 2026

## Overview

Jannal is a local proxy and inspector tool. It runs entirely on your machine. We do not collect, store, or transmit any personal data.

## Data Handling

- **API Keys:** Your Anthropic API key passes through the proxy in HTTP request headers. It is never stored, logged, or transmitted to any server other than `api.anthropic.com`.
- **Request Content:** API requests and responses are held temporarily in memory for inspection in the browser UI. They are never written to disk or sent to external services.
- **Local Storage:** The browser UI uses `localStorage` to persist session data (request history, costs, settings) on your machine. This data never leaves your browser.
- **Settings:** Tool filtering profiles and Smart Strip settings are saved as local JSON files on your machine.

## No Data Collection

Jannal does not:
- Collect analytics or telemetry
- Track usage patterns
- Send data to third-party services
- Use cookies for tracking
- Require user accounts or sign-in

## No Network Connections

Jannal only makes network connections to:
1. `api.anthropic.com` — forwarding your API requests (using your API key)
2. `localhost` — serving the inspector UI to your browser

No other network connections are made.

## Pro Edition

Jannal Pro includes an Electron desktop app with auto-update checking via GitHub Releases. This checks `github.com` for new versions. No personal data is sent during update checks.

The Router Intelligence feature runs a local keyword matching system. All processing happens on your machine — no external API calls are made for routing decisions.

## Changes

If this policy changes, the updated version will be posted at this URL.

## Contact

For questions about this privacy policy, open an issue at [github.com/Buzzie-AI/jannal](https://github.com/Buzzie-AI/jannal/issues).
