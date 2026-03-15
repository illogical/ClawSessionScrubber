# 🦞 ClawSessionScrubber

> A lightweight session history reviewer and cleanup tool for OpenClaw agents — reduce LLM costs by trimming context windows with precision.

[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)
[![Vanilla JS](https://img.shields.io/badge/Frontend-Vanilla%20ES%20Modules-FFC600)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules)
[![No build step](https://img.shields.io/badge/Build%20step-none-9DFEFE)](https://bun.sh)

---

## Overview

ClawSessionScrubber is a single-process local tool that lets you review, annotate, and surgically clean OpenClaw agent session `.jsonl` files — cutting down the context tokens your agents carry into every new run.

### Key Features

| Feature | Description |
|---|---|
| 📂 **Session browser** | Lists all agent sessions, sorted by most recently updated, with live filtering |
| 💬 **Conversation view** | Chat-style thread with collapsible thinking blocks and tool calls |
| ⭐ **Mark important** | Star key messages to protect them from bulk deletion |
| 🗑 **Bulk delete** | One click to delete all thinking/tool-call noise, or everything except important messages |
| 📋 **Per-message copy** | Copy any message text to clipboard instantly |
| 🧠 **Memory export** | Export starred messages to a dated markdown memory file |
| 🔎 **Message detail modal** | Click any message to see the full content + metadata (model, tokens, stop reason, tool details) |
| ⚡ **Zero build step** | Plain ES modules served directly — instant reload, no bundler |

---

## Why it matters

Every token in an agent's session history costs money. Over time, sessions accumulate:
- `thinking` blocks (large internal monologues, often thousands of tokens)
- `toolCall` and `toolResult` pairs (verbose tool I/O)
- Duplicate or low-value exchanges

ClawSessionScrubber lets you visually review a session, mark only what matters, and delete everything else — then your agent starts its next run with a lean, focused context window.

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.0
- OpenClaw data directory (default: `~/.openclaw`)

---

## Installation

```bash
git clone https://github.com/illogical/ClawSessionScrubber.git
cd ClawSessionScrubber
```

No `npm install` needed — there are zero runtime dependencies.

---

## Configuration

Copy the example environment file and set your OpenClaw data directory:

```bash
cp .env.example .env
```

`.env`:
```env
OPENCLAW_DATA_DIR=/Users/you/.openclaw
PORT=17109
```

Bun reads `.env` automatically at startup — no dotenv library required.

---

## Running

```bash
bun run start
# → ClawSessionScrubber running at http://localhost:17109
```

Then open [http://localhost:17109](http://localhost:17109) in your browser.

---

## Testing

```bash
bun test
```

56 tests across 5 test files, covering:
- `parseSession` — JSONL parser for all message types
- `sessionIndex` — session discovery and metadata
- `selectionHelpers` — pure selection and partition utilities
- `memoryWriter` — memory file creation and appending
- `server` — full HTTP integration tests (real Bun server)

---

## Project Layout

```
ClawSessionScrubber/
├── README.md
├── package.json               # { "scripts": { "start": "bun run server.ts" } }
├── server.ts                  # Bun HTTP server — static files + all API routes
├── .env.example               # OPENCLAW_DATA_DIR=~/.openclaw  PORT=17109
│
├── lib/                       # Server-side TypeScript modules
│   ├── types.ts               # All shared TypeScript interfaces
│   ├── parseSession.ts        # JSONL session file parser
│   ├── sessionIndex.ts        # Session discovery and metadata builder
│   ├── memoryWriter.ts        # Memory markdown file writer
│   └── selectionHelpers.ts    # Pure selection/partition utilities
│
├── public/                    # Static files served as-is
│   ├── index.html             # App shell — sidebar + main panel + modal
│   ├── style.css              # Full dark-mode stylesheet, CSS custom properties
│   └── js/
│       ├── api.js             # fetch() wrappers for all API endpoints
│       ├── store.js           # In-memory state + localStorage persistence
│       ├── render.js          # DOM builders for message cards and modal
│       ├── highlight.js       # Hand-rolled JSON syntax highlighter (~25 lines)
│       └── app.js             # Entry point — wires everything together
│
└── __tests__/
    ├── parseSession.test.ts
    ├── sessionIndex.test.ts
    ├── memoryWriter.test.ts
    ├── selectionHelpers.test.ts
    └── server.test.ts
```

---

## API Reference

All endpoints return JSON. Errors return `{ "error": "<message>" }` with an appropriate HTTP status code.

### `GET /api/sessions`

Returns all discovered sessions sorted by most recently updated.

```json
[
  {
    "sessionId": "ab9b55c4-f540-4587-ab94-72b63b29147c",
    "agentName": "main",
    "updatedAt": 1773538952929,
    "updatedAtLabel": "2 hours ago",
    "filePath": "/Users/you/.openclaw/agents/main/sessions/ab9b55c4.jsonl",
    "chatType": "direct",
    "originLabel": "heartbeat",
    "messageCount": 42
  }
]
```

### `GET /api/sessions/:id`

Returns the parsed messages for a session.

```json
[
  {
    "lineIndex": 0,
    "id": "5aa69cdb",
    "kind": "system",
    "timestamp": "2026-02-25T05:18:55.852Z",
    "content": [{ "type": "text", "text": "[session]" }],
    "hasThinking": false,
    "hasToolCall": false,
    "raw": { "type": "session", ... }
  }
]
```

### `POST /api/sessions/:id/delete`

Body: `{ "lineIndices": [2, 3, 5] }`

Deletes the specified lines from the session file. Returns `{ "deleted": 3 }`.

- `400` if `lineIndices` is empty
- `400` if `lineIndices` contains `0` (session root is never deletable)
- `404` if session ID is unknown

### `POST /api/memory`

Body:
```json
{
  "messages": [
    {
      "sessionId": "abc",
      "id": "msg-1",
      "timestamp": "2026-02-25T05:18:55.858Z",
      "kind": "user",
      "textContent": "Move DE-16 to top priority"
    }
  ],
  "date": "2026-02-25"
}
```

Appends the messages to `<OPENCLAW_DATA_DIR>/memory/<date>.md`. Returns `{ "path": "<absolute path>" }`.

- `400` if `messages` is empty or missing

---

## UI Design

The interface uses a custom dark colour palette throughout:

| Token | Value | Usage |
|---|---|---|
| `--bg` | `#15232D` | App background |
| `--fg` | `#1A3549` | Cards, sidebar, toolbar |
| `--text` | `#FFF` | Primary text |
| `--text2` | `#AAA` | Metadata, secondary labels |
| `--accent-1` | `#FFC600` | Important stars, tool call chips |
| `--accent-2` | `#9DFEFE` | Active session, links, accent labels |
| `--accent-3` | `#F6980B` | Thinking block indicators |

Message cards use role-specific left border colours for quick visual scanning:
- **User** — blue
- **Assistant** — green
- **Tool result** — purple
- **System events** — grey chips

Thinking blocks and tool calls are collapsed by default using native `<details>/<summary>` — zero JS required for expand/collapse.

---

## Data Format

Session files (`.jsonl`) contain one JSON object per line. Supported line types:

| Type | `kind` | Notes |
|---|---|---|
| `session` | `system` | Session root — never deletable |
| `model_change` | `system` | Model switch event |
| `thinking_level_change` | `system` | Thinking level event |
| `custom` | `system` | Custom typed events |
| `message` (user) | `user` | User messages |
| `message` (assistant) | `assistant` | AI responses, may include thinking + tool calls |
| `message` (toolResult) | `toolResult` | Tool execution output |

Only files ending in `.jsonl` are processed. Files with `.reset.*` or `.deleted.*` suffixes are ignored.

---

## Memory Export Format

Exported to `<OPENCLAW_DATA_DIR>/memory/YYYY-MM-DD.md`:

```markdown
# Memory — 2026-02-25

> Auto-generated by ClawSessionScrubber. Edit freely.

## Curated from session ab9b55c4 — 2026-02-25T10:00:00.000Z

**Messages exported:** 3

---

### [2026-02-25T05:18:55.858Z] user

Move DE-16 to top priority

---
```

---

## License

MIT
