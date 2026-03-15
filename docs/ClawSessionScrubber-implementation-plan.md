# ClawSessionScrubber — Implementation Plan

> A lightweight vanilla HTML/CSS/JS app served by a single Bun HTTP server. No framework, no bundler, no build step.

---

## 1. Project Overview

ClawSessionScrubber is a single-developer local tool that:

- Lists all session `.jsonl` files across all agents, sorted by most recently updated
- Renders session messages in a readable chat-style UI with collapsible reasoning and tool calls
- Lets the user mark messages as **Important** and delete everything else in one click
- Quick-selects all thinking blocks and tool calls for fast bulk deletion of low-value content
- Exports starred messages to a dated memory file (`/memory/YYYY-MM-DD.md`)
- Supports per-message copy and delete operations

**Design constraint:** minimal resource usage. The server is a single Bun process, the frontend is plain ES-module JS loaded directly by the browser with no compilation step.

---

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Runtime | Bun | Built-in HTTP server, fast startup, zero deps for serving |
| Frontend | Vanilla HTML + CSS + ES modules | No framework overhead, no build step, instant reload |
| Styling | Plain CSS with custom properties | Dark/light mode via `prefers-color-scheme`, zero dependencies |
| JSON highlighting | Hand-rolled regex highlighter (~30 lines) | Avoids CDN dependency; no bundle |
| State | Plain JS module (`store.js`) + `localStorage` | No Zustand, no extra library |
| Testing | `bun test` (built-in) | Zero config, no extra test runner |

---

## 3. Architecture

```
Browser  ──fetch──►  Bun HTTP server (server.ts)
                         │
                         ├── GET  /*                → serves public/ static files
                         ├── GET  /api/sessions     → scans agents/*/sessions/
                         ├── GET  /api/sessions/:id → reads + parses .jsonl
                         ├── POST /api/sessions/:id/delete → rewrites .jsonl
                         └── POST /api/memory       → writes/appends memory .md
```

The server process reads directly from the filesystem — `OPENCLAW_DATA_DIR` is baked in via env at startup. No database, no extra processes.

---

## 4. Repository Layout

```
ClawSessionScrubber/
├── README.md
├── package.json               # { "scripts": { "start": "bun run server.ts" } }
├── server.ts                  # Bun HTTP server — static files + all API routes
├── .env.example               # OPENCLAW_DATA_DIR=~/.openclaw  PORT=17109
│
├── lib/                       # Server-side TypeScript modules (imported by server.ts)
│   ├── types.ts
│   ├── parseSession.ts
│   ├── sessionIndex.ts
│   ├── memoryWriter.ts
│   └── selectionHelpers.ts
│
├── public/                    # Served as-is by the Bun server
│   ├── index.html             # App shell — sidebar + main panel
│   ├── style.css              # All styles, CSS custom properties for theming
│   └── js/
│       ├── api.js             # fetch() wrappers for all API endpoints
│       ├── store.js           # In-memory state + localStorage persistence
│       ├── render.js          # DOM builders for message cards
│       ├── highlight.js       # Tiny hand-rolled JSON syntax highlighter
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

## 5. Server (`server.ts`)

A single file implementing all routes using Bun's native `Bun.serve()`.

**Static file serving:** Any request not starting with `/api/` maps to `public/`. Content-type is inferred from extension. 404 for missing files.

**Route table:**

| Method | Path | Handler |
|---|---|---|
| GET | `/api/sessions` | `handleListSessions` |
| GET | `/api/sessions/:id` | `handleGetSession` |
| POST | `/api/sessions/:id/delete` | `handleDeleteMessages` |
| POST | `/api/memory` | `handleExportMemory` |

Each handler is a plain `async function(req: Request): Promise<Response>` — no routing library needed.

**Error convention:** All API errors return `{ error: string }` JSON with an appropriate HTTP status code.

**Startup:**

```ts
const DATA_DIR = process.env.OPENCLAW_DATA_DIR ?? `${process.env.HOME}/.openclaw`;
const PORT = parseInt(process.env.PORT ?? "17109");

Bun.serve({ port: PORT, fetch: router });
console.log(`ClawSessionScrubber running at http://localhost:${PORT}`);
```

---

## 6. Data Model

### 6.1 Source: `sessions.json`

Path: `<DATA_DIR>/agents/<agentName>/sessions/sessions.json`

Relevant fields per entry:

```ts
interface SessionMeta {
  sessionId: string;
  updatedAt: number;       // Unix ms timestamp
  sessionFile: string;     // absolute path to .jsonl
  chatType: string;
  origin: { label: string; from: string };
}
```

### 6.2 Source: `.jsonl` files

One JSON object per line. Each line has at minimum `{ type, id, parentId, timestamp }`.

**Line types:**

```ts
type RawLine =
  | SessionStartLine       // type: "session"
  | ModelChangeLine        // type: "model_change"
  | ThinkingLevelLine      // type: "thinking_level_change"
  | CustomLine             // type: "custom"
  | MessageLine;           // type: "message", message.role: "user" | "assistant" | "toolResult"
```

**Content block types in `message.content[]`:**

```ts
type ContentBlock =
  | { type: "text";       text: string }
  | { type: "thinking";   thinking: string; thinkingSignature: string }
  | { type: "toolCall";   id: string; name: string; arguments: Record<string, unknown> }
  | { type: "toolResult"; toolCallId: string; content: ContentBlock[] };
```

### 6.3 Normalised `ParsedMessage` (`lib/types.ts`)

```ts
interface ParsedMessage {
  lineIndex: number;
  id: string;
  parentId: string | null;
  timestamp: string;
  kind: "user" | "assistant" | "toolResult" | "system";
  content: ContentBlock[];
  hasThinking: boolean;    // precomputed — any content block is type "thinking"
  hasToolCall: boolean;    // precomputed — any content block is type "toolCall"
  meta?: {
    model?: string;
    provider?: string;
    usage?: { inputTokens: number; outputTokens: number };
    stopReason?: string;
  };
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  raw: Record<string, unknown>;
}
```

### 6.4 API response types

```ts
// GET /api/sessions
type SessionListResponse = SessionListItem[];

interface SessionListItem {
  sessionId: string;
  agentName: string;
  updatedAt: number;
  updatedAtLabel: string;   // "2 hours ago"
  filePath: string;
  chatType: string;
  originLabel: string;
  messageCount: number;
}

// GET /api/sessions/:id
type SessionDetailResponse = ParsedMessage[];

// POST /api/sessions/:id/delete
interface DeleteResponse { deleted: number }

// POST /api/memory
interface MemoryResponse { path: string }
```

---

## 7. API Route Behaviour

### `GET /api/sessions`

Scans `<DATA_DIR>/agents/*/sessions/sessions.json`. Also globs for loose `.jsonl` files not present in any index. Returns a deduplicated, descending-by-`updatedAt` sorted array of `SessionListItem`.

`messageCount` is obtained by counting newlines in the file (cheap, no full parse).

### `GET /api/sessions/:id`

Looks up the file path from the session index (or glob scan). Reads the file, parses via `lib/parseSession.ts`. Returns `ParsedMessage[]`.

Returns 404 if the session ID is unknown.

### `POST /api/sessions/:id/delete`

Body: `{ lineIndices: number[] }`

- Returns 400 if `lineIndices` is empty
- Returns 400 if `lineIndices` includes `0` (the session root event is never deletable)
- Reads the file into a lines array, removes the specified indices, rewrites the file
- Returns `{ deleted: N }`

### `POST /api/memory`

Body:

```ts
{
  messages: Array<{
    sessionId: string;
    id: string;
    timestamp: string;
    kind: string;
    textContent: string;
  }>;
  date?: string;   // YYYY-MM-DD, defaults to today
}
```

- Returns 400 if `messages` is empty or missing
- Resolves `<DATA_DIR>/memory/<date>.md`
- Creates the file with a header if it does not exist
- Appends a curated section (see §9)
- Returns `{ path: "<absolute path>" }`

---

## 8. Frontend Modules

All files are native ES modules loaded with `<script type="module">` — no bundler.

### `public/js/api.js`

Thin fetch wrappers. Each function returns the parsed JSON response or throws an `Error` with the server's error message.

```js
export async function listSessions() { ... }
export async function getSession(id) { ... }
export async function deleteMessages(id, lineIndices) { ... }
export async function exportToMemory(messages, date) { ... }
```

### `public/js/store.js`

A plain singleton object holding all mutable UI state. No reactivity framework — callers re-render explicitly after mutations.

```js
export const store = {
  sessions: [],          // SessionListItem[]
  activeSessionId: null,
  messages: [],          // ParsedMessage[] for active session
  importantIds: new Set(), // persisted to localStorage
  selectedIndices: new Set(),
  multiSelectMode: false,
};

export function toggleImportant(sessionId, messageId) { ... }
export function isImportant(sessionId, messageId) { ... }
export function setSelected(indices) { ... }
export function selectThinkingAndToolCalls() { ... }  // uses selectionHelpers logic
export function clearSelection() { ... }
export function loadImportantFromStorage(sessionId) { ... }
export function saveImportantToStorage(sessionId) { ... }
```

`localStorage` key: `claw-important:<sessionId>` — stores a JSON array of message IDs.

### `public/js/highlight.js`

A single exported function that takes a JSON string and returns an HTML string with `<span>` tags for keys, strings, numbers, booleans, and null.

```js
export function highlightJson(jsonString) { ... }
```

~30 lines using `String.prototype.replace` with named capture groups. No dependencies.

### `public/js/render.js`

DOM builder functions. Each returns an `HTMLElement`.

```js
export function renderSessionItem(item, isActive, onSelect) { ... }
export function renderMessage(msg, sessionId, store, callbacks) { ... }
export function renderThinkingBlock(block) { ... }        // collapsed by default
export function renderToolCallBlock(block) { ... }        // collapsed by default
export function renderToolResultBlock(msg, store) { ... } // collapsed by default
export function renderSystemEvent(msg) { ... }
export function renderToolbar(messages, store, callbacks) { ... }
```

Collapsible sections are implemented with a `<details>/<summary>` element pair — zero JS needed for expand/collapse behaviour.

### `public/js/app.js`

Entry point. Imports all other modules, wires event delegation on the document, makes the initial `listSessions()` call, and drives re-renders.

```js
import { listSessions, getSession, deleteMessages, exportToMemory } from './api.js';
import { store, toggleImportant, ... } from './store.js';
import { renderSessionItem, renderMessage, renderToolbar } from './render.js';

async function init() { ... }
async function loadSession(id) { ... }
async function handleDeleteSelected() { ... }
async function handleExportImportant() { ... }

document.addEventListener('DOMContentLoaded', init);
```

---

## 9. UI Layout & Visual Design

### Shell (`index.html`)

```
┌──────────────────────────────────────────────────────────────────┐
│  ClawSessionScrubber                                    [theme ☀] │
├─────────────────────┬────────────────────────────────────────────┤
│  Sessions           │  Toolbar (sticky)                          │
│  ─────────────      │  ────────────────────────────────────────  │
│  [agent] [time]     │  [Select thinking & tool calls (N)]        │
│  [session id...]    │  [Select all] [Deselect all]               │
│  ...                │  [Delete selected (N)] [Delete unimportant]│
│                     │  [Export important to memory]              │
│                     │  N important / M total                     │
│                     │  ────────────────────────────────────────  │
│                     │                                            │
│                     │  <message cards scrollable>                │
│                     │                                            │
└─────────────────────┴────────────────────────────────────────────┘
```

### Message Card Appearance

Each card has a left border colour by kind:

| Kind | Border colour | Background tint |
|---|---|---|
| `user` | Blue | Faint blue |
| `assistant` | Green | Faint green |
| `toolResult` | Purple | Faint purple |
| Thinking block | Orange | Faint orange |
| Tool call block | Amber | Faint amber |
| `system` | Grey | None (chip style) |

Card header row (flex, space-between):
- Left: icon + role label + timestamp
- Right: ⭐ 📋 🗑 (+ checkbox when multi-select active)

`thinking` and tool blocks use `<details>/<summary>` for collapse — no JS toggle needed.

Important messages get a ⭐ badge and a yellow ring around the card. The delete button (`🗑`) is `disabled` and visually dimmed when the message is important.

### Theming

All colours are CSS custom properties on `:root`. A single `data-theme` attribute on `<html>` swaps the palette. Default follows `prefers-color-scheme`.

---

## 10. `lib/selectionHelpers.ts`

Pure TypeScript functions — no DOM or state dependencies, fully unit-testable.

```ts
// Returns lineIndices of all messages that have thinking, tool calls, or are toolResult
export function selectThinkingAndToolCalls(messages: ParsedMessage[]): number[]

// Returns lineIndices of all non-system messages
export function selectAll(messages: ParsedMessage[]): number[]

// Splits a selection into deletable vs. blocked-by-importance
export function partitionByImportance(
  selected: number[],
  importantIds: Set<string>,
  messages: ParsedMessage[]
): { safe: number[]; blocked: number[] }

// Extracts plain text from a message for clipboard / memory export
export function extractPlainText(message: ParsedMessage): string
```

---

## 11. Memory File Format

Stored at `<DATA_DIR>/memory/YYYY-MM-DD.md`.

New file header:

```md
# Memory — YYYY-MM-DD

> Auto-generated by ClawSessionScrubber. Edit freely.
```

Each export appends:

```md
## Curated from session <sessionId> — <ISO datetime>

**Agent:** <agentName>
**Messages exported:** <count>

---

### [<timestamp>] <kind>

<plain-text content>

---
```

---

## 12. Environment

`.env.example`:

```env
OPENCLAW_DATA_DIR=/Users/you/.openclaw
PORT=17109
```

`server.ts` reads these at startup with fallbacks. No `.env` loading library needed — Bun reads `.env` files automatically.

---

## 13. Unit Tests

Test runner: **`bun test`** (zero config, built-in). Server-side tests mock `node:fs` via `mock.module`. No DOM tests — the frontend JS is thin enough that manual smoke-testing suffices; logic is in the server-side lib modules.

### 13.1 `__tests__/parseSession.test.ts`

| Test | Description |
|---|---|
| Parses a `session` line → `kind: "system"` | Type mapping |
| Parses a `model_change` line → `kind: "system"` | Type mapping |
| Parses a `user` message → correct `kind`, `content`, `hasThinking: false`, `hasToolCall: false` | Happy path |
| Parses an `assistant` message with `thinking` block → `hasThinking: true` | Flag |
| Parses an `assistant` message with `toolCall` block → `hasToolCall: true` | Flag |
| Parses a `toolResult` → correct `toolName`, `toolCallId`, `isError` | Role-specific fields |
| `lineIndex` matches zero-based position in file | Ordering |
| Malformed / non-JSON lines are skipped without throwing | Resilience |
| Empty file → empty array | Edge case |
| `raw` field equals the original parsed object | Immutability |

### 13.2 `__tests__/sessionIndex.test.ts`

| Test | Description |
|---|---|
| Reads `sessions.json` and returns `SessionListItem[]` with all expected fields | Happy path |
| Sorts by `updatedAt` descending | Ordering |
| Missing `sessions.json` → empty array, no throw | Resilience |
| Discovers loose `.jsonl` files not in any index | Glob fallback |
| Deduplicates sessions appearing in both index and loose scan | No duplicates |
| `updatedAtLabel` is a non-empty relative time string | Formatting |
| `messageCount` matches the number of newline-delimited lines in the file | Line count |

### 13.3 `__tests__/selectionHelpers.test.ts`

| Test | Description |
|---|---|
| `selectThinkingAndToolCalls` — selects messages with `hasThinking: true` | Basic |
| `selectThinkingAndToolCalls` — selects messages with `hasToolCall: true` | Basic |
| `selectThinkingAndToolCalls` — selects all `toolResult` messages | Basic |
| `selectThinkingAndToolCalls` — excludes plain text `user` / `assistant` | Negative |
| `selectThinkingAndToolCalls` — excludes `system` events | Negative |
| `selectThinkingAndToolCalls` — empty input → empty array | Edge case |
| `selectAll` — returns all non-system indices | Basic |
| `selectAll` — only system events → empty array | Edge case |
| `partitionByImportance` — important ids go to `blocked` | Basic |
| `partitionByImportance` — non-important ids go to `safe` | Basic |
| `partitionByImportance` — empty `importantIds` → everything in `safe` | Edge case |
| `extractPlainText` — concatenates all `text` blocks | Basic |
| `extractPlainText` — omits `thinking` block content | Thinking excluded |
| `extractPlainText` — `toolCall` block → includes tool name + argument summary | Memory export |
| `extractPlainText` — system event → empty string | Edge case |

### 13.4 `__tests__/memoryWriter.test.ts`

| Test | Description |
|---|---|
| Creates a new file with header when file does not exist | Creation |
| Appends to existing file without overwriting header | Appending |
| Written section contains session ID, kind, and text content | Content |
| Uses today's date in filename when `date` omitted | Default date |
| Respects explicit `date` override | Override |
| Returns absolute path of the written file | Return value |
| Re-throws a descriptive error when directory is not writable | Error handling |

### 13.5 `__tests__/server.test.ts`

Uses `Bun.fetch` against the running test server (started in `beforeAll`, torn down in `afterAll`). The server is started on a random port to avoid conflicts.

| Test | Description |
|---|---|
| `GET /api/sessions` → 200, array | Happy path |
| `GET /api/sessions` → 200, empty array when no sessions | Empty state |
| `GET /api/sessions/:id` → 200, `ParsedMessage[]` | Happy path |
| `GET /api/sessions/:id` → 404 for unknown ID | Not found |
| `POST /api/sessions/:id/delete` → 200, `{ deleted: N }` | Happy path |
| `POST /api/sessions/:id/delete` → 400 for empty `lineIndices` | Validation |
| `POST /api/sessions/:id/delete` → 400 when index 0 is included | Root protection |
| `POST /api/sessions/:id/delete` → 404 for unknown session | Not found |
| `POST /api/memory` → 200, `{ path }` | Happy path |
| `POST /api/memory` → 400 when `messages` is empty | Validation |
| `POST /api/memory` → 400 when `messages` is missing | Validation |
| `GET /` → 200, returns `index.html` | Static serving |
| `GET /style.css` → 200, `Content-Type: text/css` | Static serving |
| `GET /js/app.js` → 200, `Content-Type: application/javascript` | Static serving |
| `GET /nonexistent.txt` → 404 | Static 404 |

---

## 14. Implementation Order

1. **Scaffold** — create directory, `package.json`, `.env.example`, `.gitignore`
2. **`lib/types.ts`** — all TypeScript interfaces
3. **`lib/parseSession.ts`** + tests
4. **`lib/sessionIndex.ts`** + tests
5. **`lib/selectionHelpers.ts`** + tests
6. **`lib/memoryWriter.ts`** + tests
7. **`server.ts`** — Bun HTTP server with all API routes + static file serving + server tests
8. **`public/index.html`** — app shell markup
9. **`public/style.css`** — full stylesheet with CSS custom properties
10. **`public/js/highlight.js`** — JSON highlighter
11. **`public/js/api.js`** — fetch wrappers
12. **`public/js/store.js`** — state + localStorage
13. **`public/js/render.js`** — DOM builders for all message types
14. **`public/js/app.js`** — entry point, wires everything
15. **README.md**
16. **Polish** — empty states, loading indicators, toast notifications, error banners

---

## 15. Key Decisions & Constraints

| Decision | Rationale |
|---|---|
| Single `server.ts` | Entire backend in one file; easy to read and audit |
| Vanilla ES modules, no bundler | No build step, no `node_modules` in the browser, instant dev cycle |
| `<details>/<summary>` for collapse | Zero JS needed for collapse behaviour |
| Hand-rolled JSON highlighter | Avoids CDN dependency; ~30 lines; good enough for tool arguments |
| `bun test` instead of Vitest | Built-in, zero config, no extra dependency |
| `localStorage` for importance flags | Avoids mutating `.jsonl` schema |
| Deletion rewrites file in place | Simplest approach; no separate DB |
| `hasThinking` / `hasToolCall` precomputed at parse time | Avoids repeated content scans in UI |
| `selectionHelpers.ts` as pure functions | Fully unit-testable without DOM |
| `OPENCLAW_DATA_DIR` server-only | Session data never sent to any third party |
| Port 17109 | Required per spec |
