import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";

// We test selectionHelpers as pure functions — no mocking needed.
import {
  selectThinkingAndToolCalls,
  selectAll,
  partitionByImportance,
  extractPlainText,
} from "../lib/selectionHelpers.ts";
import type { ParsedMessage } from "../lib/types.ts";

function makeMsg(
  overrides: Partial<ParsedMessage> & { kind: ParsedMessage["kind"] }
): ParsedMessage {
  return {
    lineIndex: 0,
    id: "test-id",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    content: [],
    hasThinking: false,
    hasToolCall: false,
    raw: {},
    ...overrides,
  };
}

const USER_TEXT = makeMsg({
  lineIndex: 1,
  id: "u1",
  kind: "user",
  content: [{ type: "text", text: "Hello" }],
});

const ASSISTANT_THINKING = makeMsg({
  lineIndex: 2,
  id: "a1",
  kind: "assistant",
  hasThinking: true,
  content: [{ type: "thinking", thinking: "Let me think", thinkingSignature: "abc" }],
});

const ASSISTANT_TOOLCALL = makeMsg({
  lineIndex: 3,
  id: "a2",
  kind: "assistant",
  hasToolCall: true,
  content: [{ type: "toolCall", id: "call_1", name: "exec", arguments: { command: "ls" } }],
});

const TOOL_RESULT = makeMsg({
  lineIndex: 4,
  id: "tr1",
  kind: "toolResult",
  toolName: "exec",
  content: [{ type: "text", text: "output" }],
});

const SYSTEM_EVENT = makeMsg({
  lineIndex: 0,
  id: "sys1",
  kind: "system",
  content: [{ type: "text", text: "[session]" }],
});

const ASSISTANT_TEXT = makeMsg({
  lineIndex: 5,
  id: "a3",
  kind: "assistant",
  content: [{ type: "text", text: "I found the card." }],
});

const ALL_MESSAGES = [
  SYSTEM_EVENT,
  USER_TEXT,
  ASSISTANT_THINKING,
  ASSISTANT_TOOLCALL,
  TOOL_RESULT,
  ASSISTANT_TEXT,
];

describe("selectThinkingAndToolCalls", () => {
  it("includes messages with hasThinking=true", () => {
    const result = selectThinkingAndToolCalls(ALL_MESSAGES);
    expect(result).toContain(ASSISTANT_THINKING.lineIndex);
  });

  it("includes messages with hasToolCall=true", () => {
    const result = selectThinkingAndToolCalls(ALL_MESSAGES);
    expect(result).toContain(ASSISTANT_TOOLCALL.lineIndex);
  });

  it("includes toolResult messages", () => {
    const result = selectThinkingAndToolCalls(ALL_MESSAGES);
    expect(result).toContain(TOOL_RESULT.lineIndex);
  });

  it("excludes plain text user / assistant messages", () => {
    const result = selectThinkingAndToolCalls(ALL_MESSAGES);
    expect(result).not.toContain(USER_TEXT.lineIndex);
    expect(result).not.toContain(ASSISTANT_TEXT.lineIndex);
  });

  it("excludes system events", () => {
    const result = selectThinkingAndToolCalls(ALL_MESSAGES);
    expect(result).not.toContain(SYSTEM_EVENT.lineIndex);
  });

  it("returns empty array for empty input", () => {
    expect(selectThinkingAndToolCalls([])).toEqual([]);
  });
});

describe("selectAll", () => {
  it("returns lineIndices of all non-system messages", () => {
    const result = selectAll(ALL_MESSAGES);
    expect(result).toContain(USER_TEXT.lineIndex);
    expect(result).toContain(ASSISTANT_THINKING.lineIndex);
    expect(result).toContain(ASSISTANT_TOOLCALL.lineIndex);
    expect(result).toContain(TOOL_RESULT.lineIndex);
    expect(result).toContain(ASSISTANT_TEXT.lineIndex);
    expect(result).not.toContain(SYSTEM_EVENT.lineIndex);
  });

  it("returns empty array when only system events exist", () => {
    expect(selectAll([SYSTEM_EVENT])).toEqual([]);
  });
});

describe("partitionByImportance", () => {
  const importantIds = new Set(["a1"]);

  it("important ids go to blocked", () => {
    const { blocked } = partitionByImportance(
      [ASSISTANT_THINKING.lineIndex, USER_TEXT.lineIndex],
      importantIds,
      ALL_MESSAGES
    );
    expect(blocked).toContain(ASSISTANT_THINKING.lineIndex);
  });

  it("non-important ids go to safe", () => {
    const { safe } = partitionByImportance(
      [ASSISTANT_THINKING.lineIndex, USER_TEXT.lineIndex],
      importantIds,
      ALL_MESSAGES
    );
    expect(safe).toContain(USER_TEXT.lineIndex);
  });

  it("empty importantIds → everything in safe", () => {
    const { safe, blocked } = partitionByImportance(
      [USER_TEXT.lineIndex, ASSISTANT_TEXT.lineIndex],
      new Set(),
      ALL_MESSAGES
    );
    expect(safe.length).toBe(2);
    expect(blocked.length).toBe(0);
  });
});

describe("extractPlainText", () => {
  it("concatenates all text blocks", () => {
    const msg = makeMsg({
      lineIndex: 1,
      id: "m1",
      kind: "assistant",
      content: [
        { type: "text", text: "Hello" },
        { type: "text", text: "World" },
      ],
    });
    const result = extractPlainText(msg);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  it("omits thinking block content", () => {
    const msg = makeMsg({
      lineIndex: 1,
      id: "m2",
      kind: "assistant",
      hasThinking: true,
      content: [
        { type: "thinking", thinking: "private thoughts", thinkingSignature: "abc" },
        { type: "text", text: "Public answer" },
      ],
    });
    const result = extractPlainText(msg);
    expect(result).not.toContain("private thoughts");
    expect(result).toContain("Public answer");
  });

  it("toolCall block includes tool name + arguments", () => {
    const msg = makeMsg({
      lineIndex: 1,
      id: "m3",
      kind: "assistant",
      hasToolCall: true,
      content: [
        { type: "toolCall", id: "c1", name: "exec", arguments: { command: "ls" } },
      ],
    });
    const result = extractPlainText(msg);
    expect(result).toContain("exec");
    expect(result).toContain("ls");
  });

  it("returns empty string for system event", () => {
    expect(extractPlainText(SYSTEM_EVENT)).toBe("");
  });
});
