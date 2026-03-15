export interface ContentBlock {
  type: "text" | "thinking" | "toolCall";
  // text block
  text?: string;
  // thinking block
  thinking?: string;
  thinkingSignature?: string;
  // toolCall block
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

export interface ParsedMessage {
  lineIndex: number;
  id: string;
  parentId: string | null;
  timestamp: string;
  kind: "user" | "assistant" | "toolResult" | "system";
  content: ContentBlock[];
  hasThinking: boolean;
  hasToolCall: boolean;
  rawSize: number;
  meta?: {
    model?: string;
    provider?: string;
    api?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      totalTokens?: number;
    };
    stopReason?: string;
  };
  // toolResult-specific
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  details?: {
    status?: string;
    exitCode?: number;
    durationMs?: number;
    cwd?: string;
  };
  raw: Record<string, unknown>;
}

export interface SessionMeta {
  sessionId: string;
  updatedAt: number;
  chatType: string;
  origin: {
    label: string;
    from: string;
    to: string;
    provider?: string;
  };
  sessionFile: string;
}

export interface SessionListItem {
  sessionId: string;
  agentName: string;
  updatedAt: number;
  updatedAtLabel: string;
  filePath: string;
  chatType: string;
  originLabel: string;
  messageCount: number;
  fileSizeBytes: number;
  fileSizeLabel: string;
}

export type SessionListResponse = SessionListItem[];
export type SessionDetailResponse = ParsedMessage[];

export interface DeleteResponse {
  deleted: number;
}

export interface MemoryExportMessage {
  sessionId: string;
  id: string;
  timestamp: string;
  kind: string;
  textContent: string;
}

export interface MemoryResponse {
  path: string;
}
