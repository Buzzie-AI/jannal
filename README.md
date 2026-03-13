# Jannal

**See what's eating your context window. Then fix it.**

Jannal sits between your AI tools and the Anthropic API. It intercepts every request, visualizes how your context window is being used, and lets you filter out tools you don't need — saving tokens and money.

Works with Claude Code, Cursor, or anything that speaks the Anthropic Messages API.

![License](https://img.shields.io/badge/license-MIT-blue)

## What it does

**Inspect** — Watch every API request in real time. See exactly how many tokens go to the system prompt, tool definitions, conversation history, and tool results. The context bar shows you at a glance where your tokens are going.

**Cost tracking** — See the cost of every turn, with per-model pricing (Opus, Sonnet, Haiku). Session cost accumulates in the header so you always know what you're spending. Uses the official `count_tokens` API for accurate counts before the response even finishes.

**Filter tools** — The killer feature. If you're running Claude Code with 40+ MCP tools defined, half of them are probably irrelevant to what you're doing right now. Jannal strips them from the request before it hits the API. Create named profiles ("Coding Only", "Browser Automation") and switch between them from the UI.

## Quick start

```bash
git clone https://github.com/Buzzie-AI/jannal.git
cd jannal
npm install
npm start
```

Then start your AI tool pointing at the proxy:

```bash
# Claude Code
ANTHROPIC_BASE_URL=http://localhost:3456 claude

# Or any tool that supports ANTHROPIC_BASE_URL
ANTHROPIC_BASE_URL=http://localhost:3456 your-tool
```

Open `http://localhost:3456` in your browser to see the Inspector.

## How it works

```
Your AI Tool  →  Jannal (localhost:3456)  →  api.anthropic.com
                      ↓
              Inspector UI (browser)
```

The proxy is transparent. It forwards requests to Anthropic and pipes responses back. The only modification it makes is tool filtering when you have an active profile.

Your API key passes through the proxy in the request headers — it's never stored or logged. The proxy runs entirely on your machine.

## Features

### Context bar
A visual breakdown of every segment in the context window. System prompt, tools, messages, tool results — each gets a colored block proportional to its token count. Pressure indicators glow when you're approaching the context limit.

### Turn timeline
Every API request appears as a turn in the left panel. Click one to see its full segment breakdown. Tokens, costs, and model info at a glance.

### Full content modal
Click any segment to see its complete content — system prompts, tool definitions with full JSON schemas, message text. Search, copy, and switch between formatted and raw views.

### Tool filtering profiles
Open the Tools segment, uncheck the tools you don't need, save as a named profile. Profiles persist across restarts (stored in `profiles.json`). Switch profiles from the header dropdown. An orange "FILTERING" badge reminds you when filtering is active.

### Accurate token counting
Three phases: instant char-based estimates, then exact counts via the `count_tokens` API (free, fires in parallel), then ground truth from the response. Per-segment breakdowns are proportionally scaled when exact totals arrive.

### Cost per turn
Pricing for all Claude models, updated to current rates. See input cost, output cost, and total per turn. Session cost accumulates in the header.

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `JANNAL_PORT` | `3456` | Port for the proxy and Inspector UI |

## Project structure

```
jannal/
├── server.js          # Proxy server, token analysis, profile management
├── public/
│   └── index.html     # Inspector UI (single file, no build step)
├── package.json
├── profiles.json      # Auto-created, stores your filtering profiles
└── README.md
```

Two files. No build step. No framework. Just a Node.js server and an HTML file.

## Limitations

- Only supports the Anthropic Messages API (not OpenAI, Google, etc. — yet)
- Per-segment token counts are proportionally scaled estimates, not exact per-field counts
- Tool filtering modifies the request body, which means Claude won't know those tools exist — this is the point, but be aware
- Profiles are stored in a local JSON file, not synced across machines

## Contributing

Issues and PRs welcome. The codebase is intentionally simple — two files, one dependency (`ws`). Keep it that way.

## License

MIT
