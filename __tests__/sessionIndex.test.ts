import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { buildSessionIndex } from "../lib/sessionIndex.ts";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

const TEST_DIR = join(os.tmpdir(), `claw-test-index-${Date.now()}`);

async function makeSessionFile(
  dir: string,
  agentName: string,
  sessionId: string,
  lines: string[],
  updatedAt?: number
): Promise<string> {
  const sessionsDir = join(dir, "agents", agentName, "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, `${sessionId}.jsonl`);
  await writeFile(filePath, lines.join("\n") + "\n", "utf8");

  // Also write a sessions.json
  const sessionsJsonPath = join(sessionsDir, "sessions.json");
  const now = updatedAt ?? Date.now();
  const sessionsJson = {
    [`agent:${agentName}:main`]: {
      sessionId,
      updatedAt: now,
      chatType: "direct",
      origin: { label: "heartbeat", from: "heartbeat", to: "heartbeat" },
      sessionFile: filePath,
    },
  };
  await writeFile(sessionsJsonPath, JSON.stringify(sessionsJson), "utf8");
  return filePath;
}

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe("buildSessionIndex", () => {
  it("reads sessions.json and returns SessionListItem[] with all fields", async () => {
    await makeSessionFile(
      TEST_DIR,
      "main",
      "abc123",
      ['{"type":"session","id":"abc123","timestamp":"2026-01-01T00:00:00Z"}'],
      1773000000000
    );
    const items = await buildSessionIndex(TEST_DIR);
    expect(items.length).toBeGreaterThan(0);
    const item = items.find((i) => i.sessionId === "abc123");
    expect(item).toBeDefined();
    expect(item?.agentName).toBe("main");
    expect(item?.updatedAt).toBe(1773000000000);
    expect(item?.updatedAtLabel).toBeTruthy();
    expect(item?.filePath).toBeTruthy();
    expect(item?.chatType).toBe("direct");
  });

  it("sorts by updatedAt descending", async () => {
    await makeSessionFile(TEST_DIR, "main", "old-session", ["{}"], 1000);
    await makeSessionFile(TEST_DIR, "agent2", "new-session", ["{}"], 9999999999000);
    const items = await buildSessionIndex(TEST_DIR);
    expect(items[0].updatedAt).toBeGreaterThan(items[items.length - 1].updatedAt);
  });

  it("returns empty array without throwing when no agents dir exists", async () => {
    const emptyDir = join(os.tmpdir(), `claw-empty-${Date.now()}`);
    const items = await buildSessionIndex(emptyDir);
    expect(items).toEqual([]);
  });

  it("discovers loose .jsonl files not in any sessions.json", async () => {
    const sessionsDir = join(TEST_DIR, "agents", "orphan", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    const filePath = join(sessionsDir, "loose-session-id.jsonl");
    await writeFile(filePath, '{"type":"session","id":"loose"}\n', "utf8");
    // No sessions.json written
    const items = await buildSessionIndex(TEST_DIR);
    const found = items.find((i) => i.sessionId === "loose-session-id");
    expect(found).toBeDefined();
  });

  it("deduplicates sessions appearing in both index and loose scan", async () => {
    const filePath = await makeSessionFile(TEST_DIR, "main", "dup-session", ["{}"], Date.now());
    const items = await buildSessionIndex(TEST_DIR);
    const dupes = items.filter((i) => i.sessionId === "dup-session");
    expect(dupes.length).toBe(1);
  });

  it("updatedAtLabel is a non-empty string", async () => {
    await makeSessionFile(TEST_DIR, "main", "lbl-session", ["{}"], Date.now() - 5000);
    const items = await buildSessionIndex(TEST_DIR);
    const item = items.find((i) => i.sessionId === "lbl-session");
    expect(item?.updatedAtLabel.length).toBeGreaterThan(0);
  });

  it("messageCount matches number of non-blank lines", async () => {
    await makeSessionFile(
      TEST_DIR,
      "main",
      "counted",
      [
        '{"type":"session","id":"counted"}',
        '{"type":"message","id":"m1"}',
        '{"type":"message","id":"m2"}',
      ],
      Date.now()
    );
    const items = await buildSessionIndex(TEST_DIR);
    const item = items.find((i) => i.sessionId === "counted");
    expect(item?.messageCount).toBe(3);
  });

  it("skips files with .reset. or .deleted. suffixes", async () => {
    const sessionsDir = join(TEST_DIR, "agents", "main2", "sessions");
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      join(sessionsDir, "some-id.jsonl.reset.2026-01-01"),
      '{"type":"session"}\n',
      "utf8"
    );
    await writeFile(
      join(sessionsDir, "some-id.jsonl.deleted.2026-01-02"),
      '{"type":"session"}\n',
      "utf8"
    );
    const items = await buildSessionIndex(TEST_DIR);
    const bad = items.filter(
      (i) => i.filePath.includes(".reset.") || i.filePath.includes(".deleted.")
    );
    expect(bad.length).toBe(0);
  });
});
