import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

// We start a real Bun server on a random port for integration testing.

const TEST_DATA_DIR = join(os.tmpdir(), `claw-server-test-${Date.now()}`);
const TEST_SESSION_ID = "test-session-srv";
const TEST_AGENT = "srv-agent";

let server: ReturnType<typeof Bun.serve>;
let BASE: string;

async function setupTestData() {
  const sessionsDir = join(TEST_DATA_DIR, "agents", TEST_AGENT, "sessions");
  await mkdir(sessionsDir, { recursive: true });

  const sessionFile = join(sessionsDir, `${TEST_SESSION_ID}.jsonl`);
  const lines = [
    JSON.stringify({
      type: "session",
      id: TEST_SESSION_ID,
      timestamp: "2026-01-01T00:00:00.000Z",
    }),
    JSON.stringify({
      type: "message",
      id: "msg-1",
      parentId: TEST_SESSION_ID,
      timestamp: "2026-01-01T00:01:00.000Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "Hello server" }],
        timestamp: Date.now(),
      },
    }),
  ];
  await writeFile(sessionFile, lines.join("\n") + "\n", "utf8");

  const sessionsJsonPath = join(sessionsDir, "sessions.json");
  await writeFile(
    sessionsJsonPath,
    JSON.stringify({
      "agent:srv-agent:main": {
        sessionId: TEST_SESSION_ID,
        updatedAt: Date.now(),
        chatType: "direct",
        origin: { label: "heartbeat", from: "heartbeat", to: "heartbeat" },
        sessionFile,
      },
    }),
    "utf8"
  );
}

beforeAll(async () => {
  await setupTestData();

  // Dynamically import server router — we need to set env first
  process.env.OPENCLAW_DATA_DIR = TEST_DATA_DIR;
  process.env.PORT = "0"; // will be overridden by Bun.serve

  // Import the router function directly from server.ts
  const { default: routerFn } = await import("../server.ts?test=" + Date.now());

  // We actually start a fresh server here — pick random port
  const PORT = 17200 + Math.floor(Math.random() * 500);
  server = Bun.serve({ port: PORT, fetch: routerFn });
  BASE = `http://localhost:${PORT}`;
});

afterAll(async () => {
  server?.stop();
  await rm(TEST_DATA_DIR, { recursive: true, force: true });
});

async function get(path: string) {
  return fetch(BASE + path);
}

async function post(path: string, body: unknown) {
  return fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/sessions", () => {
  it("returns 200 and an array", async () => {
    const res = await get("/api/sessions");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe("GET /api/sessions/:id", () => {
  it("returns 200 and ParsedMessage[] for known session", async () => {
    const res = await get(`/api/sessions/${TEST_SESSION_ID}`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
  });

  it("returns 404 for unknown session ID", async () => {
    const res = await get("/api/sessions/does-not-exist-xyz");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/sessions/:id/delete", () => {
  it("returns 400 for empty lineIndices", async () => {
    const res = await post(`/api/sessions/${TEST_SESSION_ID}/delete`, { lineIndices: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when lineIndices includes index 0", async () => {
    const res = await post(`/api/sessions/${TEST_SESSION_ID}/delete`, { lineIndices: [0, 1] });
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown session ID", async () => {
    const res = await post("/api/sessions/no-such-session/delete", { lineIndices: [1] });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/memory", () => {
  it("returns 200 and { path } for valid messages", async () => {
    const res = await post("/api/memory", {
      messages: [
        {
          sessionId: TEST_SESSION_ID,
          id: "msg-1",
          timestamp: "2026-01-01T00:01:00.000Z",
          kind: "user",
          textContent: "Hello server",
        },
      ],
      date: "2026-01-01",
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.path).toBe("string");
  });

  it("returns 400 when messages is empty", async () => {
    const res = await post("/api/memory", { messages: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages is missing", async () => {
    const res = await post("/api/memory", {});
    expect(res.status).toBe(400);
  });
});

describe("Static file serving", () => {
  it("GET / returns 200 with index.html content", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("ClawSessionScrubber");
  });

  it("GET /style.css returns 200 with text/css", async () => {
    const res = await get("/style.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("GET /js/app.js returns 200 with javascript content-type", async () => {
    const res = await get("/js/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("GET /nonexistent.txt returns 404", async () => {
    const res = await get("/nonexistent.txt");
    expect(res.status).toBe(404);
  });
});
