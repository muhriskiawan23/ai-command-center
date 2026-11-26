// Opt-in quality profile for an explicitly approved isolated evaluation.
// Never select a provider, grant credits, change admission limits, or add calls.
export function answerDepth(message, preference) {
  const text = String(message || "");
  if (/\b(?:jawab\s+(?:singkat|ringkas|(?:dengan\s+)?hanya\s+(?:angka|satu\s+kata)|(?:dengan\s+)?angka\s+saja|satu\s+kata)|answer\s+(?:with\s+)?only\s+(?:the\s+)?(?:number|a\s+single\s+word)|secara\s+singkat|keep it short|briefly|one sentence|satu kalimat|jawab\s+ya\s+atau\s+tidak)\b/i.test(text)) return "compact";
  if (/\b(?:mendalam|detail|lengkap|komprehensif|thorough|in.depth|step.by.step|detailed|comprehensive)\b/i.test(text)) return "detailed";
  if (preference === "short") return "compact";
  if (preference === "detailed" || text.length > 420 || (text.match(/\?/g) || []).length >= 2 ||
      (text.match(/^\s*(?:\d+[.)]|[-*])\s+\S/gm) || []).length >= 3) return "detailed";
  return "standard";
}

export function qualityOutputLimit(base, agentId, message, env = {}) {
  if (env.BOR_ANSWER_QUALITY_PROFILE !== "enhanced" || !["coordinator", "writer"].includes(agentId)) return base;
  const depth = answerDepth(message, env.BOR_CUSTOMIZATION?.length);
  if (depth !== "detailed") return base;
  // Preserve the adapter's existing ceiling. All metering uses the chosen limit.
  return Math.min(2200, Math.max(base, agentId === "writer" ? 2200 : 1800));
}
