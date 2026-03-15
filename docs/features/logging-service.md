# Logging Service

## Overview

A structured logging service (`lib/logger.ts`) that writes timestamped log lines to both the server console and daily rotating log files under `logs/`.

## Log File Location

```
logs/
  2026-03-15.log
  2026-03-16.log
  ...
```

- One file per day, named `YYYY-MM-DD.log`
- Appended to if the file already exists for that day
- Created automatically on first write (directory is also created if absent)
- `logs/` is git-ignored

## Log Format

```
[2026-03-15T10:30:00.000Z] [LEVEL] message | {"key":"value"}
```

- Timestamp: ISO 8601 UTC
- Level: `INFO `, `WARN `, `ERROR`
- Meta: optional JSON object appended after ` | `

## API

```typescript
import { logger } from "./lib/logger.ts";

logger.info("Session loaded", { sessionId, messageCount });
logger.warn("Session not found", { sessionId });
logger.error("Failed to read file", err, { sessionId, filePath });
```

### `logger.info(message, meta?)`
Informational events — successful operations, counts, resolved paths.

### `logger.warn(message, meta?)`
Non-fatal issues — session not found, malformed data skipped, fallback triggered.

### `logger.error(message, err?, meta?)`
Errors that cause a failed response. Captures `err.message` and `err.stack` automatically.

## Instrumented Locations

| File | What is logged |
|------|---------------|
| `server.ts` | All `/api/*` requests; session load success/failure; delete success/failure; memory export |
| `lib/sessionIndex.ts` | Each session indexed from `sessions.json`; `sessions.json` read failures; `resolveSessionFile` result |
| `lib/parseSession.ts` | Unparseable JSONL lines (with line index and preview) |

## Motivation

The original `catch {}` blocks in `server.ts` silently discarded all errors, making it impossible to diagnose 500/404 failures when clicking sessions. The logging service surfaces these errors in real time (server console) and persists them (daily log file) for post-mortem debugging.
