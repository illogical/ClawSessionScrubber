const STORAGE_PREFIX = "claw-important:";
const SEARCH_KEY = "claw-session-search";

export const store = {
  /** @type {import('../../../lib/types.ts').SessionListItem[]} */
  sessions: [],
  /** @type {string | null} */
  activeSessionId: null,
  /** @type {import('../../../lib/types.ts').ParsedMessage[]} */
  messages: [],
  /** @type {Set<string>} — message IDs marked important for active session */
  importantIds: new Set(),
  /** @type {Set<number>} — lineIndices selected for bulk ops */
  selectedIndices: new Set(),
  multiSelectMode: false,
  searchQuery: "",
  /** @type {"date" | "size"} */
  sessionSort: "date",
};

// ─── Importance ──────────────────────────────────────────────────

export function toggleImportant(sessionId, messageId) {
  if (store.importantIds.has(messageId)) {
    store.importantIds.delete(messageId);
  } else {
    store.importantIds.add(messageId);
  }
  saveImportantToStorage(sessionId);
}

export function isImportant(messageId) {
  return store.importantIds.has(messageId);
}

export function loadImportantFromStorage(sessionId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + sessionId);
    store.importantIds = new Set(raw ? JSON.parse(raw) : []);
  } catch {
    store.importantIds = new Set();
  }
}

export function saveImportantToStorage(sessionId) {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + sessionId,
      JSON.stringify([...store.importantIds])
    );
  } catch {
    // storage full or unavailable — silently ignore
  }
}

// ─── Selection ───────────────────────────────────────────────────

export function setSelected(indices) {
  store.selectedIndices = new Set(indices);
}

export function toggleSelected(lineIndex) {
  if (store.selectedIndices.has(lineIndex)) {
    store.selectedIndices.delete(lineIndex);
  } else {
    store.selectedIndices.add(lineIndex);
  }
}

export function selectThinking() {
  const indices = store.messages
    .filter((m) => m.kind !== "system" && m.hasThinking)
    .map((m) => m.lineIndex);
  store.selectedIndices = new Set([...store.selectedIndices, ...indices]);
  store.multiSelectMode = store.selectedIndices.size > 0;
}

export function selectToolCalls() {
  const indices = store.messages
    .filter((m) => m.kind !== "system" && (m.hasToolCall || m.kind === "toolResult"))
    .map((m) => m.lineIndex);
  store.selectedIndices = new Set([...store.selectedIndices, ...indices]);
  store.multiSelectMode = store.selectedIndices.size > 0;
}

export function selectAll() {
  const indices = store.messages
    .filter((m) => m.kind !== "system")
    .map((m) => m.lineIndex);
  store.selectedIndices = new Set(indices);
}

export function clearSelection() {
  store.selectedIndices = new Set();
}
