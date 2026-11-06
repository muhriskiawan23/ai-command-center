(function (root) {
  "use strict";

  function convertToChecklist(markdown) {
    const source = String(markdown ?? "").replace(/\r\n?/g, "\n");
    const lines = source.split("\n");
    let inFence = false;
    let fence = "";
    let count = 0;
    const converted = lines.map((line) => {
      const fenceMatch = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (!inFence) { inFence = true; fence = marker[0]; }
        else if (marker[0] === fence) { inFence = false; fence = ""; }
        return line;
      }
      if (inFence) return line;
      const match = /^(\s*)(?:[-*+]\s+|\d+[.)]\s+)(.*)$/.exec(line);
      if (!match) return line;
      count += 1;
      return match[1] + "- [ ] " + match[2];
    });
    return { ok: count > 0, count, markdown: converted.join("\n") };
  }

  root.BORChecklist = Object.freeze({ convertToChecklist });
})(typeof window !== "undefined" ? window : globalThis);
