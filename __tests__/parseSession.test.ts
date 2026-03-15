import { describe, it, expect } from "bun:test";
import { parseSession } from "../lib/parseSession.ts";

const SESSION_LINE = `{"type":"session","version":3,"id":"5aa69cdb","timestamp":"2026-02-25T05:18:55.852Z","cwd":"/workspace"}`;
const MODEL_CHANGE_LINE = `{"type":"model_change","id":"ebdf0119","parentId":null,"timestamp":"2026-02-25T05:18:55.853Z","provider":"opencode","modelId":"minimax"}`;
const THINKING_LEVEL_LINE = `{"type":"thinking_level_change","id":"ef0ca283","parentId":"ebdf0119","timestamp":"2026-02-25T05:18:55.853Z","thinkingLevel":"low"}`;

const USER_LINE = `{"type":"message","id":"813a837d","parentId":"431dc59d","timestamp":"2026-02-25T05:18:55.858Z","message":{"role":"user","content":[{"type":"text","text":"Move DE-16 to top priority?"}],"timestamp":1771996735857}}`;

const ASSISTANT_WITH_THINKING = `{"type":"message","id":"dd433acd","parentId":"813a837d","timestamp":"2026-02-25T05:19:12.471Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"The user wants...","thinkingSignature":"c2a2f355"},{"type":"toolCall","id":"call_1","name":"exec","arguments":{"command":"ls"}}],"api":"anthropic-messages","provider":"opencode","model":"minimax-m2.5-free","usage":{"input":28,"output":167,"cacheRead":5869,"cacheWrite":10583,"totalTokens":16647},"stopReason":"toolUse","timestamp":1771996735858}}`;

const TOOL_RESULT_LINE = `{"type":"message","id":"e0f1c758","parentId":"dd433acd","timestamp":"2026-02-25T05:19:12.544Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"exec","content":[{"type":"text","text":"error output"}],"details":{"status":"completed","exitCode":5,"durationMs":47,"cwd":"/workspace"},"isError":false,"timestamp":1771996752542}}`;

describe("parseSession", () => {
  it("parses a session line as kind=system", () => {
    const msgs = parseSession(SESSION_LINE);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe("system");
    expect(msgs[0].lineIndex).toBe(0);
  });

  it("parses a model_change line as kind=system", () => {
    const msgs = parseSession(MODEL_CHANGE_LINE);
    expect(msgs[0].kind).toBe("system");
  });

  it("parses a thinking_level_change line as kind=system", () => {
    const msgs = parseSession(THINKING_LEVEL_LINE);
    expect(msgs[0].kind).toBe("system");
  });

  it("parses a user message with correct kind and content", () => {
    const msgs = parseSession(USER_LINE);
    expect(msgs[0].kind).toBe("user");
    expect(msgs[0].content[0].type).toBe("text");
    expect(msgs[0].content[0].text).toContain("DE-16");
    expect(msgs[0].hasThinking).toBe(false);
    expect(msgs[0].hasToolCall).toBe(false);
  });

  it("sets hasThinking=true for assistant with thinking block", () => {
    const msgs = parseSession(ASSISTANT_WITH_THINKING);
    expect(msgs[0].kind).toBe("assistant");
    expect(msgs[0].hasThinking).toBe(true);
  });

  it("sets hasToolCall=true for assistant with toolCall block", () => {
    const msgs = parseSession(ASSISTANT_WITH_THINKING);
    expect(msgs[0].hasToolCall).toBe(true);
  });

  it("populates meta fields on assistant message", () => {
    const msgs = parseSession(ASSISTANT_WITH_THINKING);
    expect(msgs[0].meta?.model).toBe("minimax-m2.5-free");
    expect(msgs[0].meta?.provider).toBe("opencode");
    expect(msgs[0].meta?.api).toBe("anthropic-messages");
    expect(msgs[0].meta?.stopReason).toBe("toolUse");
    expect(msgs[0].meta?.usage?.input).toBe(28);
    expect(msgs[0].meta?.usage?.totalTokens).toBe(16647);
  });

  it("parses a toolResult with toolName, toolCallId, isError", () => {
    const msgs = parseSession(TOOL_RESULT_LINE);
    expect(msgs[0].kind).toBe("toolResult");
    expect(msgs[0].toolName).toBe("exec");
    expect(msgs[0].toolCallId).toBe("call_1");
    expect(msgs[0].isError).toBe(false);
  });

  it("populates details on toolResult", () => {
    const msgs = parseSession(TOOL_RESULT_LINE);
    expect(msgs[0].details?.exitCode).toBe(5);
    expect(msgs[0].details?.durationMs).toBe(47);
    expect(msgs[0].details?.status).toBe("completed");
    expect(msgs[0].details?.cwd).toBe("/workspace");
  });

  it("assigns correct lineIndex for each parsed message", () => {
    const content = `${SESSION_LINE}\n${USER_LINE}\n${TOOL_RESULT_LINE}`;
    const msgs = parseSession(content);
    expect(msgs[0].lineIndex).toBe(0);
    expect(msgs[1].lineIndex).toBe(1);
    expect(msgs[2].lineIndex).toBe(2);
  });

  it("skips malformed / non-JSON lines without throwing", () => {
    const content = `${USER_LINE}\nnot-json\n{broken\n${MODEL_CHANGE_LINE}`;
    const msgs = parseSession(content);
    expect(msgs.length).toBe(2);
  });

  it("returns empty array for empty file", () => {
    expect(parseSession("")).toHaveLength(0);
    expect(parseSession("   \n  \n")).toHaveLength(0);
  });

  it("raw field equals the original parsed object", () => {
    const msgs = parseSession(USER_LINE);
    const raw = msgs[0].raw;
    expect(raw.id).toBe("813a837d");
    expect(raw.type).toBe("message");
  });
});
