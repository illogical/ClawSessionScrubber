import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import type { SessionListItem, SessionMeta } from "./types.ts";
import { logger } from "./logger.ts";

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

async function countLines(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, "utf8");
    return content.split("\n").filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

function agentNameFromPath(sessionsJsonPath: string): string {
  // path: .../agents/<agentName>/sessions/sessions.json
  const parts = sessionsJsonPath.split("/");
  const sessionsIdx = parts.lastIndexOf("sessions");
  if (sessionsIdx > 0) return parts[sessionsIdx - 1];
  return "unknown";
}

export async function buildSessionIndex(dataDir: string): Promise<SessionListItem[]> {
  const agentsDir = join(dataDir, "agents");
  const seen = new Set<string>();
  const items: SessionListItem[] = [];

  // Phase 1: read sessions.json files
  let agentEntries: string[] = [];
  try {
    agentEntries = await readdir(agentsDir);
  } catch {
    // no agents dir yet
  }

  for (const agentName of agentEntries) {
    const sessionsDir = join(agentsDir, agentName, "sessions");
    const sessionsJsonPath = join(sessionsDir, "sessions.json");
    try {
      const raw = await readFile(sessionsJsonPath, "utf8");
      const obj = JSON.parse(raw) as Record<string, SessionMeta>;
      for (const meta of Object.values(obj)) {
        if (!meta.sessionId || seen.has(meta.sessionId)) continue;
        seen.add(meta.sessionId);
        // sessionFile may be an absolute path from a different machine — resolve
        // it relative to the local sessionsDir using only the filename.
        const filePath = join(sessionsDir, basename(meta.sessionFile));
        if (filePath !== meta.sessionFile) {
          logger.info("Remapped sessionFile to local path", { sessionId: meta.sessionId, original: meta.sessionFile, resolved: filePath });
        } else {
          logger.info("Indexed session from sessions.json", { sessionId: meta.sessionId, filePath });
        }
        items.push({
          sessionId: meta.sessionId,
          agentName,
          updatedAt: meta.updatedAt,
          updatedAtLabel: formatRelativeTime(meta.updatedAt),
          filePath,
          chatType: meta.chatType ?? "direct",
          originLabel: meta.origin?.label ?? "",
          messageCount: await countLines(filePath),
        });
      }
    } catch (e) {
      logger.warn("Could not read sessions.json, falling back to file scan", { path: sessionsJsonPath, error: (e as Error).message });
    }

    // Phase 2: also pick up loose .jsonl files in this agent's sessions dir
    let files: string[] = [];
    try {
      files = await readdir(sessionsDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(sessionsDir, file);
      // derive session id from filename (strip extension)
      const sessionId = basename(file, ".jsonl");
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);
      try {
        const s = await stat(filePath);
        items.push({
          sessionId,
          agentName,
          updatedAt: s.mtimeMs,
          updatedAtLabel: formatRelativeTime(s.mtimeMs),
          filePath,
          chatType: "direct",
          originLabel: "",
          messageCount: await countLines(filePath),
        });
      } catch {
        // skip unreadable
      }
    }
  }

  // Sort descending by updatedAt
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return items;
}

export async function resolveSessionFile(
  dataDir: string,
  sessionId: string
): Promise<string | null> {
  const sessions = await buildSessionIndex(dataDir);
  const found = sessions.find((s) => s.sessionId === sessionId);
  if (!found) {
    logger.warn("resolveSessionFile: no match in index", { sessionId, indexSize: sessions.length });
    return null;
  }
  logger.info("resolveSessionFile: resolved", { sessionId, filePath: found.filePath });
  return found.filePath;
}
