// Deterministic Markdown checklist conversion. This browser-served module is the implementation
// used by the UI and is also re-exported from src/checklist.js for the test suite.
export function toChecklistMarkdown(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let foundItem = false;
  let fence = null;

  for (const line of lines) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        fence = { char: marker[0], length: marker.length };
      } else if (marker[0] === fence.char && marker.length >= fence.length) {
        fence = null;
      }
      output.push(line);
      continue;
    }

    if (fence !== null) {
      output.push(line);
      continue;
    }

    const item = /^([ \t]*)(?:[-*+]\s+|\d+[.)]\s+)(.*)$/.exec(line);
    if (!item) {
      output.push(line);
      continue;
    }

    foundItem = true;
    output.push(`${item[1]}- [ ] ${item[2]}`);
  }

  return foundItem ? output.join("\n") : "";
}
