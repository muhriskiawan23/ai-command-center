/* BOR AI's small, dependency-free Markdown renderer.
 * HTML is escaped before formatting; list nesting is intentionally flattened
 * for predictable, readable mobile summaries and copied document excerpts.
 */
(() => {
  "use strict";
  const esc = value => String(value).replace(/[&<>"']/g, ch => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[ch]));
  function inline(value) {
    const slots = [];
    const save = html => "\uE000" + (slots.push(html) - 1) + "\uE001";
    let text = String(value || "");
    text = text.replace(/\x60([^\x60\n]+)\x60/g, (_, code) => save("<code>" + esc(code) + "</code>"));
    text = text.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi, (full, label, url) => {
      try {
        const parsed = new URL(url);
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return full;
        return save('<a href="' + esc(parsed.href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>");
      } catch { return full; }
    });
    text = esc(text);
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
      .replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    return text.replace(/\uE000(\d+)\uE001/g, (_, index) => slots[Number(index)] || "");
  }
  function render(value) {
    const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [], paragraph = [], list = [];
    let listTag = "", i = 0;
    const flushParagraph = () => {
      if (paragraph.length) out.push("<p>" + inline(paragraph.join(" ").trim()) + "</p>");
      paragraph.length = 0;
    };
    const flushList = () => {
      if (list.length) out.push("<" + listTag + ">" + list.map(item => "<li>" + inline(item) + "</li>").join("") + "</" + listTag + ">");
      list.length = 0; listTag = "";
    };
    while (i < lines.length) {
      const line = lines[i], trimmed = line.trim();
      if (!trimmed) { flushParagraph(); flushList(); i++; continue; }
      const fence = /^ {0,3}\x60{3,}([\w+-]*)\s*$/.exec(line);
      if (fence) {
        flushParagraph(); flushList(); i++;
        const code = [];
        while (i < lines.length && !/^ {0,3}\x60{3,}\s*$/.test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i++;
        out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
        continue;
      }
      const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        flushParagraph(); flushList();
        const level = heading[1].length;
        out.push("<h" + level + ">" + inline(heading[2]) + "</h" + level + ">");
        i++; continue;
      }
      if (/^ {0,3}(?:---|\*\*\*|___)\s*$/.test(line)) {
        flushParagraph(); flushList(); out.push("<hr>"); i++; continue;
      }
      const bullet = /^ {0,12}([-*+]|\d+[.)])\s+(.+)$/.exec(line);
      if (bullet) {
        flushParagraph();
        const type = /^\d/.test(bullet[1]) ? "ol" : "ul";
        if (listTag && type !== listTag) flushList();
        listTag = type; list.push(bullet[2].trim()); i++; continue;
      }
      const quote = /^ {0,3}>\s?(.*)$/.exec(line);
      if (quote) {
        flushParagraph(); flushList(); const chunks = [];
        while (i < lines.length) {
          const current = /^ {0,3}>\s?(.*)$/.exec(lines[i]);
          if (!current) break;
          chunks.push(inline(current[1])); i++;
        }
        out.push("<blockquote><p>" + chunks.join("<br>") + "</p></blockquote>");
        continue;
      }
      // Wrapped list entries stay within the current item, not in a new nested list.
      if (list.length && /^\s{2,}\S/.test(line)) {
        list[list.length - 1] += " " + trimmed; i++; continue;
      }
      if (list.length) flushList();
      paragraph.push(trimmed); i++;
    }
    flushParagraph(); flushList();
    return out.join("\n");
  }
  globalThis.BORMarkdown = Object.freeze({ render });
})();
