import type { ParsedMessage, ContentBlock } from "./types.ts";

export function selectThinkingAndToolCalls(messages: ParsedMessage[]): number[] {
  return messages
    .filter(
      (m) =>
        m.kind !== "system" &&
        (m.hasThinking || m.hasToolCall || m.kind === "toolResult")
    )
    .map((m) => m.lineIndex);
}

export function selectAll(messages: ParsedMessage[]): number[] {
  return messages.filter((m) => m.kind !== "system").map((m) => m.lineIndex);
}

export function partitionByImportance(
  selected: number[],
  importantIds: Set<string>,
  messages: ParsedMessage[]
): { safe: number[]; blocked: number[] } {
  const indexToId = new Map(messages.map((m) => [m.lineIndex, m.id]));
  const safe: number[] = [];
  const blocked: number[] = [];
  for (const idx of selected) {
    const id = indexToId.get(idx);
    if (id && importantIds.has(id)) {
      blocked.push(idx);
    } else {
      safe.push(idx);
    }
  }
  return { safe, blocked };
}

export function extractPlainText(message: ParsedMessage): string {
  if (message.kind === "system") return "";

  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    } else if (block.type === "toolCall") {
      const argsStr =
        block.arguments && Object.keys(block.arguments).length > 0
          ? JSON.stringify(block.arguments, null, 2)
          : "(no arguments)";
      parts.push(`[Tool call: ${block.name ?? "unknown"}]\n${argsStr}`);
    }
    // thinking blocks are intentionally omitted
  }
  return parts.join("\n\n");
}
