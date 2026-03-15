import {
  listSessions,
  getSession,
  deleteMessages,
  exportToMemory,
} from "./api.js";
import {
  store,
  toggleImportant,
  isImportant,
  loadImportantFromStorage,
  saveImportantToStorage,
  setSelected,
  toggleSelected,
  selectThinking,
  selectToolCalls,
  selectAll,
  clearSelection,
} from "./store.js";
import {
  renderSessionItem,
  renderMessage,
  renderMessageDetail,
  updateToolbarStats,
} from "./render.js";

// ─── Toasts ──────────────────────────────────────────────────────

function showToast(message, type = "info", duration = 3000) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ─── Status banner ────────────────────────────────────────────────

function setStatus(msg) {
  const el = document.getElementById("status-banner");
  if (el) el.textContent = msg;
}

// ─── Session list rendering ───────────────────────────────────────

function renderSessionList(sessions) {
  const list = document.getElementById("session-list");
  if (!list) return;
  list.innerHTML = "";

  if (!sessions.length) {
    const empty = document.createElement("li");
    empty.className = "session-list__empty";
    empty.textContent = "No sessions found.";
    list.appendChild(empty);
    return;
  }

  for (const item of sessions) {
    const isActive = item.sessionId === store.activeSessionId;
    const li = renderSessionItem(item, isActive, loadSession);
    list.appendChild(li);
  }
  window.lucide?.createIcons();
}

// ─── Message feed rendering ───────────────────────────────────────

function renderMessageFeed(messages) {
  const feed = document.getElementById("message-feed");
  if (!feed) return;
  feed.innerHTML = "";

  if (!messages.length) {
    const empty = document.createElement("li");
    empty.style.cssText = "padding:20px;color:var(--text2);text-align:center;font-size:13px;";
    empty.textContent = "No messages in this session.";
    feed.appendChild(empty);
    return;
  }

  for (const msg of messages) {
    const card = renderMessage(msg, store.activeSessionId, {
      onToggleImportant: handleToggleImportant,
      onDelete: handleDeleteMessages,
      onToggleSelect: handleToggleSelect,
      onOpenDetail: openMessageModal,
    });
    feed.appendChild(card);
  }

  updateMultiSelectVisuals();
  updateToolbarStats();
  window.lucide?.createIcons();
}

// ─── Toolbar visibility ───────────────────────────────────────────

function showToolbar(visible) {
  document.getElementById("toolbar-empty").hidden = visible;
  document.getElementById("toolbar-controls").hidden = !visible;
}

// ─── Load sessions ────────────────────────────────────────────────

async function loadSessionList() {
  setStatus("Loading sessions…");
  try {
    const sessions = await listSessions();
    store.sessions = sessions;
    applyFilter();
    setStatus("");
  } catch (e) {
    showToast(`Failed to load sessions: ${e.message}`, "error");
    setStatus("Error loading sessions");
  }
}

// ─── Filter sessions ──────────────────────────────────────────────

function applyFilter() {
  const q = store.searchQuery.toLowerCase();
  const filtered = q
    ? store.sessions.filter(
        (s) =>
          s.sessionId.toLowerCase().includes(q) ||
          s.agentName.toLowerCase().includes(q) ||
          s.originLabel.toLowerCase().includes(q)
      )
    : [...store.sessions];

  if (store.sessionSort === "size") {
    filtered.sort((a, b) => b.fileSizeBytes - a.fileSizeBytes);
  }
  // "date" order is already the default from the server (descending updatedAt)

  renderSessionList(filtered);
}

// ─── Load session ─────────────────────────────────────────────────

async function loadSession(id) {
  store.activeSessionId = id;
  clearSelection();
  loadImportantFromStorage(id);
  applyFilter();
  showToolbar(true);

  const feed = document.getElementById("message-feed");
  if (feed) {
    feed.innerHTML =
      '<li style="padding:20px;color:var(--text2);text-align:center;" class="loading-dots">Loading</li>';
  }
  setStatus("Loading messages…");

  try {
    const messages = await getSession(id);
    store.messages = messages;
    renderMessageFeed(messages);
    setStatus("");
  } catch (e) {
    showToast(`Failed to load session: ${e.message}`, "error");
    setStatus("Error loading session");
  }
}

// ─── Toggle important ─────────────────────────────────────────────

function handleToggleImportant(messageId) {
  toggleImportant(store.activeSessionId, messageId);
  refreshCard(messageId);
  updateToolbarStats();
}

function refreshCard(messageId) {
  const card = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (!card) return;
  const msg = store.messages.find((m) => m.id === messageId);
  if (!msg) return;

  const newCard = renderMessage(msg, store.activeSessionId, {
    onToggleImportant: handleToggleImportant,
    onDelete: handleDeleteMessages,
    onToggleSelect: handleToggleSelect,
    onOpenDetail: openMessageModal,
  });
  card.replaceWith(newCard);
  window.lucide?.createIcons();
}

// ─── Toggle select ────────────────────────────────────────────────

function handleToggleSelect(lineIndex) {
  toggleSelected(lineIndex);
  updateCardSelected(lineIndex);
  updateToolbarStats();
}

function updateCardSelected(lineIndex) {
  const card = document.querySelector(`[data-line-index="${lineIndex}"]`);
  if (!card) return;
  const selected = store.selectedIndices.has(lineIndex);
  card.classList.toggle("is-selected", selected);
  const cb = card.querySelector(".msg-card__checkbox");
  if (cb) {
    cb.innerHTML = selected ? "✓" : "";
    cb.setAttribute("aria-checked", selected ? "true" : "false");
  }
  updateToolbarStats();
}

function updateMultiSelectVisuals() {
  const feed = document.getElementById("message-feed");
  if (!feed) return;
  feed.classList.toggle("multi-select-mode", store.multiSelectMode);
}

// ─── Delete messages ──────────────────────────────────────────────

async function handleDeleteMessages(lineIndices) {
  if (!store.activeSessionId || lineIndices.length === 0) return;

  // Filter out important messages
  const safe = lineIndices.filter((idx) => {
    const msg = store.messages.find((m) => m.lineIndex === idx);
    return msg && !isImportant(msg.id);
  });

  if (safe.length === 0) {
    showToast("All selected messages are marked important — unmark first.", "info");
    return;
  }

  try {
    const result = await deleteMessages(store.activeSessionId, safe);
    showToast(`Deleted ${result.deleted} message(s).`, "success");
    await loadSession(store.activeSessionId);
  } catch (e) {
    showToast(`Delete failed: ${e.message}`, "error");
  }
}

// ─── Delete unimportant ───────────────────────────────────────────

async function handleDeleteUnimportant() {
  if (!store.activeSessionId) return;
  const unimportant = store.messages
    .filter((m) => m.kind !== "system" && !isImportant(m.id))
    .map((m) => m.lineIndex);
  if (unimportant.length === 0) {
    showToast("No unimportant messages to delete.", "info");
    return;
  }
  await handleDeleteMessages(unimportant);
}

// ─── Export memory ────────────────────────────────────────────────

async function handleExportMemory() {
  if (!store.activeSessionId) return;
  const important = store.messages.filter(
    (m) => m.kind !== "system" && isImportant(m.id)
  );
  if (important.length === 0) {
    showToast("No important messages to export.", "info");
    return;
  }

  const exportPayload = important.map((m) => ({
    sessionId: store.activeSessionId,
    id: m.id,
    timestamp: m.timestamp,
    kind: m.kind,
    textContent: m.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n"),
  }));

  try {
    const result = await exportToMemory(exportPayload);
    showToast(`Exported to ${result.path}`, "success", 5000);
  } catch (e) {
    showToast(`Export failed: ${e.message}`, "error");
  }
}

// ─── Message modal ────────────────────────────────────────────────

function openMessageModal(msg) {
  const modal = document.getElementById("message-modal");
  if (!modal) return;
  renderMessageDetail(msg);
  modal.hidden = false;
  window.lucide?.createIcons();
  document.getElementById("modal-close")?.focus();
}

function closeMessageModal() {
  const modal = document.getElementById("message-modal");
  if (modal) modal.hidden = true;
}

// ─── Init ─────────────────────────────────────────────────────────

async function init() {
  // Toolbar buttons
  document.getElementById("btn-refresh")?.addEventListener("click", loadSessionList);

  function setSortMode(mode) {
    store.sessionSort = mode;
    document.getElementById("btn-sort-date")?.classList.toggle("is-active", mode === "date");
    document.getElementById("btn-sort-size")?.classList.toggle("is-active", mode === "size");
    applyFilter();
  }
  document.getElementById("btn-sort-date")?.addEventListener("click", () => setSortMode("date"));
  document.getElementById("btn-sort-size")?.addEventListener("click", () => setSortMode("size"));

  document.getElementById("btn-select-thinking")?.addEventListener("click", () => {
    selectThinking();
    updateAllCardSelections();
    updateToolbarStats();
  });

  document.getElementById("btn-select-toolcalls")?.addEventListener("click", () => {
    selectToolCalls();
    updateAllCardSelections();
    updateToolbarStats();
  });

  document.getElementById("btn-select-all")?.addEventListener("click", () => {
    selectAll();
    updateAllCardSelections();
    updateToolbarStats();
  });

  document.getElementById("btn-deselect-all")?.addEventListener("click", () => {
    clearSelection();
    updateAllCardSelections();
    updateToolbarStats();
  });

  document.getElementById("btn-delete-selected")?.addEventListener("click", () => {
    handleDeleteMessages([...store.selectedIndices]);
  });

  document.getElementById("btn-delete-unimportant")?.addEventListener("click", handleDeleteUnimportant);
  document.getElementById("btn-export-memory")?.addEventListener("click", handleExportMemory);

  // Search
  document.getElementById("session-search")?.addEventListener("input", (e) => {
    store.searchQuery = e.target.value.trim().toLowerCase();
    applyFilter();
  });

  // Modal
  document.getElementById("modal-close")?.addEventListener("click", closeMessageModal);
  document.getElementById("modal-backdrop")?.addEventListener("click", closeMessageModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMessageModal();
  });

  // Render static HTML icons (refresh, modal close, sort buttons)
  window.lucide?.createIcons();

  // Initial load
  await loadSessionList();
}

function updateAllCardSelections() {
  for (const msg of store.messages) {
    updateCardSelected(msg.lineIndex);
  }
}

document.addEventListener("DOMContentLoaded", init);
