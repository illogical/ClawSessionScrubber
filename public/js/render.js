import { highlightJson } from "./highlight.js";
import { isImportant, store } from "./store.js";

// ─── Lucide icon helper ───────────────────────────────────────────
function icon(name, cls = "") {
  const i = document.createElement("i");
  i.setAttribute("data-lucide", name);
  i.className = `icon${cls ? " " + cls : ""}`;
  return i;
}

const ROLE_ICONS = {
  user:       "user",
  assistant:  "bot",
  toolResult: "wrench",
  system:     "settings",
};

const ROLE_LABELS = {
  user:       "User",
  assistant:  "Assistant",
  toolResult: "Tool Result",
  system:     "System",
};

function formatTimestamp(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return ts;
  }
}

function el(tag, cls, attrs = {}) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "textContent") e.textContent = v;
    else if (k === "innerHTML") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  return e;
}

function extractPreviewText(msg) {
  if (msg.kind === "toolResult") {
    const text = msg.content.map((b) => b.text ?? "").join(" ").trim();
    return text || `[Tool: ${msg.toolName ?? "unknown"}]`;
  }
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join(" ")
    .trim();
  if (!text && msg.hasThinking) return "[Thinking…]";
  if (!text && msg.hasToolCall) {
    const tc = msg.content.find((b) => b.type === "toolCall");
    return tc ? `[Tool call: ${tc.name}]` : "[Tool call]";
  }
  return text;
}

// ─── Content truncation ───────────────────────────────────────────

const PREVIEW_LINES = 400;

/**
 * Truncate text to at most maxLines newline-separated lines.
 * @returns {{ preview: string, clipped: boolean, totalLines: number }}
 */
function truncateLines(text, maxLines = PREVIEW_LINES) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return { preview: text, clipped: false, totalLines: lines.length };
  return { preview: lines.slice(0, maxLines).join("\n"), clipped: true, totalLines: lines.length };
}

// ─── Thinking block ───────────────────────────────────────────────

export function renderThinkingBlock(block, maxLines = Infinity) {
  const details = el("details", "block-details block-details--thinking");
  const summary = el("summary", "block-summary");
  summary.appendChild(icon("brain"));
  const thinkingLabel = document.createTextNode(` Thinking `);
  summary.appendChild(thinkingLabel);
  const charCount = document.createElement("span");
  charCount.style.cssText = "opacity:.5;font-weight:400;font-size:10px";
  charCount.textContent = `(${block.thinking?.length ?? 0} chars)`;
  summary.appendChild(charCount);
  const content = el("div", "block-content");
  const { preview, clipped, totalLines } = truncateLines(block.thinking ?? "", maxLines);
  content.textContent = preview;
  if (clipped) {
    const note = el("div", "content-clip-notice");
    note.textContent = `… truncated at ${maxLines} of ${totalLines} lines`;
    content.appendChild(note);
  }
  details.appendChild(summary);
  details.appendChild(content);
  details.dataset.clipped = clipped ? "1" : "0";
  return details;
}

// ─── Tool call block ──────────────────────────────────────────────

export function renderToolCallBlock(block, maxLines = Infinity) {
  const details = el("details", "block-details block-details--toolcall");
  const summary = el("summary", "block-summary");
  summary.appendChild(icon("zap"));
  summary.appendChild(document.createTextNode(` Tool: ${block.name ?? "unknown"}`));
  const content = el("div", "block-content");
  let clipped = false;
  try {
    const pretty = JSON.stringify(block.arguments, null, 2);
    const truncated = truncateLines(pretty, maxLines);
    clipped = truncated.clipped;
    content.innerHTML = highlightJson(truncated.preview);
    if (clipped) {
      const note = el("div", "content-clip-notice");
      note.textContent = `… truncated at ${maxLines} of ${truncated.totalLines} lines`;
      content.appendChild(note);
    }
  } catch {
    content.textContent = String(block.arguments);
  }
  details.appendChild(summary);
  details.appendChild(content);
  details.dataset.clipped = clipped ? "1" : "0";
  return details;
}

// ─── Tool result block ────────────────────────────────────────────

export function renderToolResultBlock(msg, maxLines = Infinity) {
  const details = el("details", "block-details block-details--toolresult");
  const summary = el("summary", "block-summary");
  summary.appendChild(icon("wrench"));
  summary.appendChild(document.createTextNode(` ${msg.toolName ?? "tool"}`));
  if (msg.isError) { summary.appendChild(document.createTextNode(" ")); summary.appendChild(icon("triangle-alert")); }
  const content = el("div", "block-content");
  const fullText = msg.content.map((b) => b.text ?? "").join("\n").trim();
  const { preview, clipped, totalLines } = truncateLines(fullText || "(no output)", maxLines);
  content.textContent = preview;
  if (clipped) {
    const note = el("div", "content-clip-notice");
    note.textContent = `… truncated at ${maxLines} of ${totalLines} lines`;
    content.appendChild(note);
  }
  details.dataset.clipped = clipped ? "1" : "0";
  details.appendChild(summary);
  details.appendChild(content);
  return details;
}

// ─── System event chip ────────────────────────────────────────────

export function renderSystemEvent(msg) {
  const li = el("li", `msg-card msg-card--system`);
  li.dataset.lineIndex = msg.lineIndex;
  li.dataset.msgId = msg.id;

  const header = el("div", "msg-card__header");
  const roleIcon = el("span", "msg-card__role-icon");
  roleIcon.appendChild(icon("settings"));
  const role = el("span", "msg-card__role");
  role.textContent = "System";
  const rawText = msg.content?.[0]?.text ?? JSON.stringify(msg.raw?.type ?? "");
  const label = el("span", "msg-card__timestamp");
  label.textContent = rawText + " — " + formatTimestamp(msg.timestamp);

  header.appendChild(roleIcon);
  header.appendChild(role);
  header.appendChild(label);
  li.appendChild(header);
  return li;
}

// ─── Main message card ────────────────────────────────────────────

/**
 * @param {object} msg - ParsedMessage
 * @param {string} sessionId
 * @param {object} callbacks - { onToggleImportant, onDelete, onToggleSelect, onOpenDetail }
 */
export function renderMessage(msg, sessionId, callbacks) {
  if (msg.kind === "system") return renderSystemEvent(msg);

  const important = isImportant(msg.id);
  const selected = store.selectedIndices.has(msg.lineIndex);

  const isThinkingOnly = msg.kind === "assistant" && msg.hasThinking &&
    !msg.content.some(b => b.type === "text" && b.text?.trim().length > 0);

  const li = el(
    "li",
    `msg-card msg-card--${msg.kind}${isThinkingOnly ? " msg-card--thinking-only" : ""}${important ? " is-important" : ""}${selected ? " is-selected" : ""}`
  );
  li.dataset.lineIndex = msg.lineIndex;
  li.dataset.msgId = msg.id;

  // ── Header ──
  const header = el("div", "msg-card__header");

  // Checkbox (visible in multi-select mode)
  const checkbox = el("span", "msg-card__checkbox");
  checkbox.setAttribute("role", "checkbox");
  checkbox.setAttribute("aria-checked", selected ? "true" : "false");
  checkbox.setAttribute("aria-label", "Select message");
  checkbox.innerHTML = selected ? "✓" : "";
  checkbox.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onToggleSelect(msg.lineIndex);
  });

  const roleIcon = el("span", "msg-card__role-icon");
  roleIcon.appendChild(icon(ROLE_ICONS[msg.kind] ?? "help-circle"));

  const roleLabel = el("span", "msg-card__role");
  roleLabel.textContent = ROLE_LABELS[msg.kind] ?? msg.kind;
  roleLabel.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onOpenDetail(msg); });

  const ts = el("span", "msg-card__timestamp");
  ts.textContent = formatTimestamp(msg.timestamp);

  // Flags chips
  const flags = el("span", "msg-card__flags");
  if (msg.hasThinking) {
    const chip = el("span", "flag-chip flag-chip--thinking");
    chip.textContent = "Thinking";
    flags.appendChild(chip);
  }
  if (msg.hasToolCall) {
    const chip = el("span", "flag-chip flag-chip--toolcall");
    chip.textContent = "Tool call";
    flags.appendChild(chip);
  }
  if (msg.isError) {
    const chip = el("span", "flag-chip flag-chip--error");
    chip.textContent = "Error";
    flags.appendChild(chip);
  }
  if (msg.rawSize >= 2048) {
    const kb = (msg.rawSize / 1024).toFixed(msg.rawSize < 10240 ? 1 : 0);
    const sizeTier = msg.rawSize >= 51200 ? "lg" : "md";
    const sizeChip = el("span", `flag-chip flag-chip--size-${sizeTier}`);
    sizeChip.textContent = `${kb}kb`;
    sizeChip.title = `Raw message size: ${kb}kb`;
    flags.appendChild(sizeChip);
  }

  // Action buttons
  const actions = el("div", "msg-card__actions");

  const starBtn = el("button", `action-btn${important ? " is-important" : ""}`);
  starBtn.appendChild(icon("star"));
  starBtn.title = important ? "Unmark important" : "Mark as important";
  starBtn.setAttribute("aria-label", important ? "Unmark important" : "Mark as important");
  starBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onToggleImportant(msg.id);
  });

  const copyBtn = el("button", "action-btn");
  copyBtn.appendChild(icon("clipboard"));
  copyBtn.title = "Copy text";
  copyBtn.setAttribute("aria-label", "Copy message text");
  copyBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
    navigator.clipboard?.writeText(text).catch(() => {});
    copyBtn.innerHTML = "";
    copyBtn.appendChild(icon("check"));
    window.lucide?.createIcons();
    setTimeout(() => {
      copyBtn.innerHTML = "";
      copyBtn.appendChild(icon("clipboard"));
      window.lucide?.createIcons();
    }, 1200);
  });

  const delBtn = el("button", "action-btn");
  delBtn.appendChild(icon("trash-2"));
  delBtn.title = "Delete message";
  delBtn.setAttribute("aria-label", "Delete message");
  if (important) delBtn.setAttribute("disabled", "true");
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!important) callbacks.onDelete([msg.lineIndex]);
  });

  const viewBtn = el("button", "action-btn");
  viewBtn.appendChild(icon("eye"));
  viewBtn.title = "View details";
  viewBtn.setAttribute("aria-label", "View message details");
  viewBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    callbacks.onOpenDetail(msg);
  });

  actions.appendChild(viewBtn);
  actions.appendChild(starBtn);
  actions.appendChild(copyBtn);
  actions.appendChild(delBtn);

  header.appendChild(checkbox);
  header.appendChild(roleIcon);
  header.appendChild(roleLabel);
  header.appendChild(ts);
  header.appendChild(flags);
  header.appendChild(actions);

  // ── Preview body ──
  const preview = el("div", "msg-card__preview");
  const previewText = extractPreviewText(msg);
  const previewP = el("p");
  previewP.textContent = previewText.slice(0, 300);
  preview.appendChild(previewP);
  preview.addEventListener("click", (e) => { e.stopPropagation(); callbacks.onOpenDetail(msg); });

  // Click on card → toggle selection
  li.addEventListener("click", () => callbacks.onToggleSelect(msg.lineIndex));

  li.appendChild(header);
  li.appendChild(preview);

  return li;
}

// ─── Session sidebar item ─────────────────────────────────────────

/**
 * @param {object} item - SessionListItem
 * @param {boolean} isActive
 * @param {Function} onSelect
 */
export function renderSessionItem(item, isActive, onSelect) {
  const li = el("li", `session-item${isActive ? " is-active" : ""}`);
  li.setAttribute("role", "option");
  li.setAttribute("aria-selected", isActive ? "true" : "false");
  li.dataset.sessionId = item.sessionId;

  const agent = el("div", "session-item__agent");
  agent.textContent = item.agentName;

  const id = el("div", "session-item__id");
  id.textContent = item.sessionId;
  id.title = item.sessionId;

  const meta = el("div", "session-item__meta");

  const badge = el("span", "session-item__badge");
  badge.textContent = `${item.messageCount} msgs`;

  const origin = el("span");
  origin.textContent = item.originLabel || item.chatType;

  const time = el("span", "session-item__time");
  const timeRelative = el("span");
  timeRelative.textContent = item.updatedAtLabel;
  const timeDate = el("span", "session-item__date");
  timeDate.textContent = new Date(item.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  time.appendChild(timeRelative);
  time.appendChild(timeDate);

  const size = el("span", "session-item__size");
  size.textContent = item.fileSizeLabel ?? "";

  meta.appendChild(badge);
  meta.appendChild(origin);
  meta.appendChild(time);
  meta.appendChild(size);

  li.appendChild(agent);
  li.appendChild(id);
  li.appendChild(meta);

  li.addEventListener("click", () => onSelect(item.sessionId));

  return li;
}

// ─── Toolbar ─────────────────────────────────────────────────────

export function updateToolbarStats() {
  const importantCount = store.importantIds.size;
  const total = store.messages.filter((m) => m.kind !== "system").length;
  const statImportant = document.getElementById("stat-important");
  const statTotal = document.getElementById("stat-total");
  if (statImportant) statImportant.textContent = `${importantCount} important`;
  if (statTotal) statTotal.textContent = `${total} total`;

  const selectedCount = store.selectedIndices.size;
  const deleteBtn = document.getElementById("btn-delete-selected");
  const countEl = document.getElementById("selected-count");
  if (deleteBtn) deleteBtn.disabled = selectedCount === 0;
  if (countEl) countEl.textContent = String(selectedCount);
}

// ─── Message detail modal ─────────────────────────────────────────

export function renderMessageDetail(msg) {
  const body = document.getElementById("modal-body");
  const title = document.getElementById("modal-title");
  if (!body || !title) return;

  title.innerHTML = "";
  const titleIcon = icon(ROLE_ICONS[msg.kind] ?? "help-circle");
  title.appendChild(titleIcon);
  title.appendChild(document.createTextNode(` ${ROLE_LABELS[msg.kind] ?? msg.kind} — ${formatTimestamp(msg.timestamp)}`));
  body.innerHTML = "";

  // ── Metadata section ──
  const metaItems = [];
  if (msg.meta?.model) metaItems.push(["Model", msg.meta.model]);
  if (msg.meta?.provider) metaItems.push(["Provider", msg.meta.provider]);
  if (msg.meta?.api) metaItems.push(["API", msg.meta.api]);
  if (msg.meta?.stopReason) metaItems.push(["Stop reason", msg.meta.stopReason]);
  if (msg.meta?.usage) {
    const u = msg.meta.usage;
    const parts = [];
    if (u.input != null) parts.push(`in:${u.input}`);
    if (u.output != null) parts.push(`out:${u.output}`);
    if (u.cacheRead != null) parts.push(`cacheRead:${u.cacheRead}`);
    if (u.cacheWrite != null) parts.push(`cacheWrite:${u.cacheWrite}`);
    if (u.totalTokens != null) parts.push(`total:${u.totalTokens}`);
    if (parts.length) metaItems.push(["Tokens", parts.join("  ")]);
  }
  if (msg.toolName) metaItems.push(["Tool", msg.toolName]);
  if (msg.toolCallId) metaItems.push(["Tool call ID", msg.toolCallId]);
  if (msg.isError != null) metaItems.push(["Is error", String(msg.isError)]);
  if (msg.details?.exitCode != null) metaItems.push(["Exit code", String(msg.details.exitCode)]);
  if (msg.details?.durationMs != null) metaItems.push(["Duration", `${msg.details.durationMs}ms`]);
  if (msg.details?.cwd) metaItems.push(["CWD", msg.details.cwd]);
  metaItems.push(["ID", msg.id]);
  if (msg.parentId) metaItems.push(["Parent ID", msg.parentId]);
  metaItems.push(["Timestamp", msg.timestamp]);

  if (metaItems.length) {
    const metaSection = el("div", "modal__section");
    const metaTitle = el("div", "modal__section-title");
    metaTitle.textContent = "Metadata";
    const grid = el("div", "meta-grid");
    for (const [k, v] of metaItems) {
      const key = el("span", "meta-key");
      key.textContent = k;
      const val = el("span", "meta-value");
      val.textContent = v;
      grid.appendChild(key);
      grid.appendChild(val);
    }
    metaSection.appendChild(metaTitle);
    metaSection.appendChild(grid);
    body.appendChild(metaSection);
  }

  // ── Content blocks ──
  const contentSection = el("div", "modal__section");
  const contentTitle = el("div", "modal__section-title");
  contentTitle.textContent = "Content";
  contentSection.appendChild(contentTitle);

  let anyClipped = false;

  if (msg.kind === "toolResult") {
    const resultBlock = renderToolResultBlock(msg, PREVIEW_LINES);
    resultBlock.setAttribute("open", "");
    if (resultBlock.dataset.clipped === "1") anyClipped = true;
    contentSection.appendChild(resultBlock);
  } else {
    for (const block of msg.content) {
      if (block.type === "thinking") {
        const tb = renderThinkingBlock(block, PREVIEW_LINES);
        if (tb.dataset.clipped === "1") anyClipped = true;
        contentSection.appendChild(tb);
      } else if (block.type === "toolCall") {
        const tcBlock = renderToolCallBlock(block, PREVIEW_LINES);
        if (tcBlock.dataset.clipped === "1") anyClipped = true;
        tcBlock.setAttribute("open", "");
        contentSection.appendChild(tcBlock);
      } else if (block.type === "text" && block.text) {
        const { preview, clipped, totalLines } = truncateLines(block.text, PREVIEW_LINES);
        if (clipped) anyClipped = true;
        const textDiv = el("div", "modal__full-text");
        textDiv.textContent = preview;
        if (clipped) {
          const note = el("div", "content-clip-notice");
          note.textContent = `… truncated at ${PREVIEW_LINES} of ${totalLines} lines`;
          textDiv.appendChild(note);
        }
        contentSection.appendChild(textDiv);
      }
    }
  }

  body.appendChild(contentSection);

  // ── Download footer (shown when content was clipped) ──
  if (anyClipped) {
    const footer = el("div", "modal__download-footer");
    const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const filename = `msg-${msg.id.slice(0, 8)}-${ts}.json`;
    const downloadBtn = el("button", "btn btn--secondary modal__download-btn");
    downloadBtn.appendChild(icon("download"));
    downloadBtn.appendChild(document.createTextNode(` Download full message — ${filename}`));
    downloadBtn.addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(msg.raw, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    });
    footer.appendChild(downloadBtn);
    body.appendChild(footer);
    window.lucide?.createIcons();
  }
}
