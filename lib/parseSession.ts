import type { ParsedMessage, ContentBlock } from "./types.ts";
import { logger } from "./logger.ts";

function roleToKind(role: string): ParsedMessage["kind"] {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "toolResult":
      return "toolResult";
    default:
      return "system";
  }
}

function parseContentBlocks(raw: unknown[]): ContentBlock[] {
  return raw
    .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
    .map((b) => {
      const type = b.type as string;
      if (type === "text") {
        return { type: "text" as const, text: String(b.text ?? "") };
      }
      if (type === "thinking") {
        return {
          type: "thinking" as const,
          thinking: String(b.thinking ?? ""),
          thinkingSignature: String(b.thinkingSignature ?? ""),
        };
      }
      if (type === "toolCall") {
        return {
          type: "toolCall" as const,
          id: String(b.id ?? ""),
          name: String(b.name ?? ""),
          arguments: (b.arguments ?? {}) as Record<string, unknown>,
        };
      }
      return { type: "text" as const, text: JSON.stringify(b) };
    });
}

export function parseSession(fileContent: string): ParsedMessage[] {
  const lines = fileContent.split("\n");
  const results: ParsedMessage[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex].trim();
    if (!line) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      logger.warn("Skipping unparseable JSONL line", { lineIndex, error: (e as Error).message, preview: line.slice(0, 80) });
      continue;
    }

    const type = obj.type as string;
    const id = String(obj.id ?? "");
    const parentId = obj.parentId != null ? String(obj.parentId) : null;
    const timestamp = String(obj.timestamp ?? "");

    // Non-message lines → system events
    if (type !== "message") {
      results.push({
        lineIndex,
        id,
        parentId,
        timestamp,
        kind: "system",
        content: [{ type: "text", text: `[${type}]` }],
        hasThinking: false,
        hasToolCall: false,
        rawSize: line.length,
        raw: obj,
      });
      continue;
    }

    const message = (obj.message ?? {}) as Record<string, unknown>;
    const role = String(message.role ?? "");
    const kind = roleToKind(role);

    const rawContent = Array.isArray(message.content) ? message.content : [];
    const content = parseContentBlocks(rawContent);
    const hasThinking = content.some((b) => b.type === "thinking");
    const hasToolCall = content.some((b) => b.type === "toolCall");

    const parsed: ParsedMessage = {
      lineIndex,
      id,
      parentId,
      timestamp,
      kind,
      content,
      hasThinking,
      hasToolCall,
      rawSize: line.length,
      raw: obj,
    };

    if (kind === "assistant") {
      parsed.meta = {
        model: message.model != null ? String(message.model) : undefined,
        provider: message.provider != null ? String(message.provider) : undefined,
        api: message.api != null ? String(message.api) : undefined,
        stopReason: message.stopReason != null ? String(message.stopReason) : undefined,
        usage: message.usage != null
          ? {
              input: (message.usage as Record<string, unknown>).input as number | undefined,
              output: (message.usage as Record<string, unknown>).output as number | undefined,
              cacheRead: (message.usage as Record<string, unknown>).cacheRead as number | undefined,
              cacheWrite: (message.usage as Record<string, unknown>).cacheWrite as number | undefined,
              totalTokens: (message.usage as Record<string, unknown>).totalTokens as number | undefined,
            }
          : undefined,
      };
    }

    if (kind === "toolResult") {
      parsed.toolName = message.toolName != null ? String(message.toolName) : undefined;
      parsed.toolCallId = message.toolCallId != null ? String(message.toolCallId) : undefined;
      parsed.isError = typeof message.isError === "boolean" ? message.isError : undefined;
      if (message.details != null) {
        const d = message.details as Record<string, unknown>;
        parsed.details = {
          status: d.status != null ? String(d.status) : undefined,
          exitCode: typeof d.exitCode === "number" ? d.exitCode : undefined,
          durationMs: typeof d.durationMs === "number" ? d.durationMs : undefined,
          cwd: d.cwd != null ? String(d.cwd) : undefined,
        };
      }
    }

    results.push(parsed);
  }

  return results;
}
