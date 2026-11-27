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
  // Pipe tables: escaped pipes and pipes in inline code are cell text.
  // Bound the number of columns and rows and escape every cell through inline().
  function tableCells(line) {
    const text = line.trim();
    if (!text.includes("|")) return null;
    let cells = [], cell = "", code = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\\" && text[i + 1] === "|" && !code) { cell += "|"; i++; continue; }
      if (ch === "\x60") code = !code;
      if (ch === "|" && !code) { cells.push(cell.trim()); cell = ""; }
      else cell += ch;
    }
    cells.push(cell.trim());
    if (text.startsWith("|")) cells.shift();
    if (text.endsWith("|") && cells.at(-1) === "") cells.pop();
    return cells.length >= 2 && cells.length <= 12 ? cells : null;
  }
  function tableAlignment(line, width) {
    const cells = tableCells(line);
    if (!cells || cells.length !== width || !cells.every(cell => /^:?-{3,}:?$/.test(cell))) return null;
    return cells.map(cell => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
  }
  function tableCell(tag, value, alignment) {
    return "<" + tag + (tag === "th" ? ' scope="col"' : "") +
      ' class="md-align-' + alignment + '">' + inline(value) + "</" + tag + ">";
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
      const header = tableCells(line);
      const align = header && i + 1 < lines.length ? tableAlignment(lines[i + 1], header.length) : null;
      if (align) {
        flushParagraph(); flushList();
        const rows = [];
        i += 2;
        while (i < lines.length && rows.length < 100) {
          const cells = tableCells(lines[i]);
          if (!cells || cells.length !== header.length) break;
          rows.push("<tr>" + cells.map((cell, index) => tableCell("td", cell, align[index])).join("") + "</tr>");
          i++;
        }
        out.push('<div class="md-table-scroll" tabindex="0" role="region" aria-label="Table"><table class="md-table"><thead><tr>' +
          header.map((cell, index) => tableCell("th", cell, align[index])).join("") +
          "</tr></thead><tbody>" + rows.join("") + "</tbody></table></div>");
        continue;
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
