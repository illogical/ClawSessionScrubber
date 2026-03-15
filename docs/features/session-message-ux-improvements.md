# Session Message UX Improvements

## Problem
- Clicking a message card opens the detail modal, making it impossible to manually toggle individual message selection without using the bulk-select buttons.
- The single "Select thinking & tool calls" button mixes two distinct filtering passes that are better handled separately.
- User and Assistant messages look visually similar — hard to skim.
- Pure [Thinking...] blocks are indistinguishable from actual assistant chat responses containing valuable content.

## Solution

### 1. Click-to-toggle Selection + 👁 View Icon

**Behavior change:**
- Clicking anywhere on a message card (body) toggles its selected/unselected state.
- A new 👁 icon button in the card's action bar opens the detail modal.

**Files changed:**
- `public/js/render.js` — Remove `header` and `preview` click-to-modal listeners. Add `li` click → `onToggleSelect`. Add `viewBtn` action button → `onOpenDetail`.

### 2. Split Selection Buttons

**Toolbar changes:**
- Remove: `Select thinking & tool calls`
- Add: `Select all Thinking` (selects messages where `hasThinking === true`)
- Add: `Select all Tool calls` (selects messages where `hasToolCall || kind === "toolResult"`)

**Files changed:**
- `public/index.html` — Replace single button with two buttons (`btn-select-thinking`, `btn-select-toolcalls`)
- `public/js/store.js` — Add `selectThinking()` and `selectToolCalls()` functions
- `public/js/app.js` — Update imports and event bindings

### 3. Thinking-Only Visual Differentiation

Assistant messages that contain **only thinking blocks** (no plain text content) get a `.msg-card--thinking-only` CSS class, giving them an orange tint and orange left border. This visually separates background reasoning from actual chat responses.

**Detection logic:**
```js
const isThinkingOnly = msg.kind === "assistant" && msg.hasThinking &&
  !msg.content.some(b => b.type === "text" && b.text?.trim().length > 0);
```

**Files changed:**
- `public/js/render.js` — Add class to `li` when condition is met
- `public/style.css` — Add `.msg-card--thinking-only` rule

### 4. User Message Right-Side Layout

User messages are styled like the right side of a chat conversation:
- Left indent (`margin-left: 12%`)
- Border moved to right side (`border-right` instead of `border-left`)
- No left border

**Files changed:**
- `public/style.css` — Update `.msg-card--user` rule

## Verification

1. Load a session with mixed message types (user, assistant with thinking, assistant chat, tool calls, tool results)
2. Click a message card body → selection toggles (cyan glow), modal does NOT open
3. Click the 👁 icon → detail modal opens
4. Click 👁 again or press Escape → modal closes
5. User messages appear right-indented with a right-side blue border
6. Pure thinking assistant messages have an orange tint
7. "Select all Thinking" button selects only `hasThinking` messages
8. "Select all Tool calls" button selects tool call and tool result messages
9. Existing ⭐, 📋, 🗑 actions still work without triggering selection toggle
10. Checkbox click still works for selection
