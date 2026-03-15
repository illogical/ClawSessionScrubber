import { readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { parseSession } from "./lib/parseSession.ts";
import { buildSessionIndex, resolveSessionFile } from "./lib/sessionIndex.ts";
import { writeMemory } from "./lib/memoryWriter.ts";
import { logger } from "./lib/logger.ts";
import type { DeleteResponse, MemoryExportMessage, MemoryResponse } from "./lib/types.ts";

const DATA_DIR =
  process.env.OPENCLAW_DATA_DIR ??
  `${process.env.HOME ?? "/tmp"}/.openclaw`;
const PORT = parseInt(process.env.PORT ?? "17109");
const PUBLIC_DIR = join(import.meta.dir, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function mimeFor(path: string): string {
  return MIME[extname(path)] ?? "application/octet-stream";
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function err(message: string, status: number): Response {
  return json({ error: message }, status);
}

// --- Handlers ---

async function handleListSessions(): Promise<Response> {
  try {
    const items = await buildSessionIndex(DATA_DIR);
    logger.info("Session list loaded", { count: items.length });
    return json(items);
  } catch (e) {
    logger.error("Failed to build session index", e, { dataDir: DATA_DIR });
    return err("Failed to load sessions", 500);
  }
}

async function handleGetSession(sessionId: string): Promise<Response> {
  const filePath = await resolveSessionFile(DATA_DIR, sessionId);
  if (!filePath) {
    logger.warn("Session not found", { sessionId });
    return err("Session not found", 404);
  }
  try {
    const content = await readFile(filePath, "utf8");
    const messages = parseSession(content);
    logger.info("Session loaded", { sessionId, filePath, messageCount: messages.length });
    return json(messages);
  } catch (e) {
    logger.error("Failed to read/parse session file", e, { sessionId, filePath });
    return err("Failed to read session file", 500);
  }
}

async function handleDeleteMessages(
  sessionId: string,
  req: Request
): Promise<Response> {
  let body: { lineIndices?: number[] };
  try {
    body = (await req.json()) as { lineIndices?: number[] };
  } catch (e) {
    logger.warn("Invalid JSON body in delete request", { sessionId });
    return err("Invalid JSON body", 400);
  }

  const { lineIndices } = body;
  if (!Array.isArray(lineIndices) || lineIndices.length === 0) {
    return err("lineIndices must be a non-empty array", 400);
  }
  if (lineIndices.includes(0)) {
    return err("Cannot delete line 0 (session root event)", 400);
  }

  const filePath = await resolveSessionFile(DATA_DIR, sessionId);
  if (!filePath) {
    logger.warn("Session not found for delete", { sessionId });
    return err("Session not found", 404);
  }

  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (e) {
    logger.error("Failed to read session file for delete", e, { sessionId, filePath });
    return err("Failed to read session file", 500);
  }

  const lines = content.split("\n");
  const toDelete = new Set(lineIndices);
  // Map lineIndices to actual lines (accounting for blank lines in the index)
  const nonBlankIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) nonBlankIndices.push(i);
  }

  const linesToRemove = new Set<number>();
  for (const idx of toDelete) {
    if (idx < nonBlankIndices.length) {
      linesToRemove.add(nonBlankIndices[idx]);
    }
  }

  const newLines = lines.filter((_, i) => !linesToRemove.has(i));
  try {
    await writeFile(filePath, newLines.join("\n"), "utf8");
  } catch (e) {
    logger.error("Failed to write session file after delete", e, { sessionId, filePath });
    return err("Failed to write session file", 500);
  }

  logger.info("Messages deleted", { sessionId, deleted: linesToRemove.size });
  return json({ deleted: linesToRemove.size } satisfies DeleteResponse);
}

async function handleExportMemory(req: Request): Promise<Response> {
  let body: { messages?: MemoryExportMessage[]; date?: string };
  try {
    body = (await req.json()) as { messages?: MemoryExportMessage[]; date?: string };
  } catch {
    return err("Invalid JSON body", 400);
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return err("messages must be a non-empty array", 400);
  }

  try {
    const path = await writeMemory(DATA_DIR, body.messages, body.date);
    logger.info("Memory exported", { path, messageCount: body.messages.length });
    return json({ path } satisfies MemoryResponse);
  } catch (e) {
    logger.error("Failed to export memory", e);
    return err((e as Error).message, 500);
  }
}

async function serveStatic(pathname: string): Promise<Response> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(PUBLIC_DIR, safePath);
  // Prevent directory traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const data = await readFile(filePath);
    return new Response(data, {
      headers: { "Content-Type": mimeFor(filePath) },
    });
  } catch {
    return new Response("Not Found", { status: 404 });
  }
}

// --- Router ---

async function router(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  if (pathname.startsWith("/api/")) {
    logger.info(`${method} ${pathname}`);
  }

  // API routes
  if (pathname === "/api/sessions" && method === "GET") {
    return handleListSessions();
  }

  const sessionDetailMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
  if (sessionDetailMatch && method === "GET") {
    return handleGetSession(decodeURIComponent(sessionDetailMatch[1]));
  }

  const deleteMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/delete$/);
  if (deleteMatch && method === "POST") {
    return handleDeleteMessages(decodeURIComponent(deleteMatch[1]), req);
  }

  if (pathname === "/api/memory" && method === "POST") {
    return handleExportMemory(req);
  }

  // Static files
  return serveStatic(pathname);
}

export default router;

if (import.meta.main) {
  Bun.serve({ port: PORT, fetch: router });
  console.log(`ClawSessionScrubber running at http://localhost:${PORT}`);
}
