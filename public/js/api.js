const BASE = "";

async function apiFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}

export async function listSessions() {
  return apiFetch("/api/sessions");
}

export async function getSession(id) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}`);
}

export async function deleteMessages(id, lineIndices) {
  return apiFetch(`/api/sessions/${encodeURIComponent(id)}/delete`, {
    method: "POST",
    body: JSON.stringify({ lineIndices }),
  });
}

export async function exportToMemory(messages, date) {
  return apiFetch("/api/memory", {
    method: "POST",
    body: JSON.stringify({ messages, date }),
  });
}
