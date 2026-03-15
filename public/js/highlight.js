/**
 * Tiny hand-rolled JSON syntax highlighter.
 * Returns an HTML string with <span> tags for keys, strings, numbers,
 * booleans, and null. No dependencies.
 */
export function highlightJson(jsonString) {
  const escaped = jsonString
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return escaped.replace(
    /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(true|false)|(null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match, key, str, bool, nul, num) => {
      if (key !== undefined) return `<span class="json-key">${key}</span>:`;
      if (str !== undefined) return `<span class="json-str">${str}</span>`;
      if (bool !== undefined) return `<span class="json-bool">${bool}</span>`;
      if (nul !== undefined) return `<span class="json-null">${nul}</span>`;
      if (num !== undefined) return `<span class="json-num">${num}</span>`;
      return match;
    }
  );
}
