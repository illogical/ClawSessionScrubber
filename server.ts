import { readFile, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { parseSession } from "./lib/parseSession.ts";
import { buildSessionIndex, resolveSessionFile } from "./lib/sessionIndex.ts";
import { writeMemory } from "./lib/memoryWriter.ts";
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
  const items = await buildSessionIndex(DATA_DIR);
  return json(items);
}

async function handleGetSession(sessionId: string): Promise<Response> {
  const filePath = await resolveSessionFile(DATA_DIR, sessionId);
  if (!filePath) return err("Session not found", 404);
  try {
    const content = await readFile(filePath, "utf8");
    const messages = parseSession(content);
    return json(messages);
  } catch {
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
  } catch {
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
  if (!filePath) return err("Session not found", 404);

  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
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
  } catch {
    return err("Failed to write session file", 500);
  }

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
    return json({ path } satisfies MemoryResponse);
  } catch (e) {
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
