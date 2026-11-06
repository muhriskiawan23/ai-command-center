(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  function id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function toast(message) {
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      el.hidden = true;
    }, 2200);
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  }

  function markdown(input) {
    let src = String(input || "").replace(/\r\n?/g, "\n");
    const blocks = [];
    src = src.replace(/```([\w+-]*)[ \t]*\n([\s\S]*?)```/g, (_, lang, code) => {
      const key = "@@CB" + blocks.length + "@@";
      blocks.push({ lang, code });
      return key;
    });
    src = src
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n\n+/g, "\n")
      .replace(/^(#+)\s+(.*)$/gm, (_, hash, text) => `<h${hash.length}>${text}</h${hash.length}>`)
      .replace(/^>\s*(.*)$/gm, "<blockquote>$1</blockquote>")
      .replace(/^(?:- |\* |\+ )(.*)$/gm, "<li>$1</li>")
      .replace(/\n<li>/g, "\n<ul>\n<li>")
      .replace(/<\/li>\n(?!<li>|<h|<p|<blockquote|<ul|<ol)/g, "</li>\n</ul>\n")
      .replace(/\n(?!<)/g, "<br>\n");

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const tag = block.lang ? ` class="language-${escapeHTML(block.lang)}"` : "";
      src = src.replace("@@CB" + i + "@@", `<pre><code${tag}>${escapeHTML(block.code)}</code></pre>`);
    }

    return src;
  }

  function copyText(value) {
    const text = String(value ?? "");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    toast("Teks disalin");
  }

  function downloadText(value, role) {
    const blob = new Blob([String(value ?? "")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (role === "assistant" ? "assistant" : "user") + "-message.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadMarkdown(value, role) {
    const blob = new Blob([String(value ?? "")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (role === "assistant" ? "assistant" : "user") + "-message.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  function toChecklistMarkdown(text) {
    const src = String(text ?? "");
    if (!src.trim()) return "";

    const lines = src.replace(/\r\n?/g, "\n").split("\n");
    let inFence = false;
    let fenceChar = null;
    let found = false;
    const out = [];

    for (const line of lines) {
      const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!inFence) {
          inFence = true;
          fenceChar = marker;
          out.push(line);
          continue;
        }
        if (marker === fenceChar) {
          inFence = false;
          fenceChar = null;
          out.push(line);
          continue;
        }
      }

      if (inFence) {
        out.push(line);
        continue;
      }

      const item = /^([ \t]*)(?:[-*+]\s+|\d+\.\s+)(.*)$/.exec(line);
      if (!item) {
        out.push(line);
        continue;
      }

      found = true;
      out.push(`${item[1]}- [ ] ${item[2]}`);
    }

    return found ? out.join("\n") : "";
  }

  function downloadChecklist(content,role) {
    const markdownText = toChecklistMarkdown(content);
    const value = markdownText || "";
    const blob = new Blob([value], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (role === "assistant" ? "assistant" : "user") + "-checklist.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  function appendMessage(role, content, scroll = true) {
    const row = document.createElement("article");
    row.className = "message " + role;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = role === "assistant" ? "✳" : "";

    const body = document.createElement("div");
    body.className = "message-body";

    const rendered = document.createElement("div");
    rendered.className = "message-text";
    rendered.innerHTML = markdown(content);

    const actions = document.createElement("div");
    actions.className = "message-actions";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.textContent = "Salin";
    copyBtn.className = "message-action";
    copyBtn.addEventListener("click", () => copyText(content));

    const markdownBtn = document.createElement("button");
    markdownBtn.type = "button";
    markdownBtn.textContent = "Markdown";
    markdownBtn.className = "message-action";
    markdownBtn.addEventListener("click", () => downloadMarkdown(content, role));

    const plainBtn = document.createElement("button");
    plainBtn.type = "button";
    plainBtn.textContent = "Teks";
    plainBtn.className = "message-action";
    plainBtn.addEventListener("click", () => downloadText(content, role));

    const checklistBtn = document.createElement("button");
    checklistBtn.type = "button";
    checklistBtn.textContent = "Checklist";
    checklistBtn.className = "message-action";
    checklistBtn.addEventListener("click", () => downloadChecklist(content,role));

    actions.append(copyBtn, markdownBtn, plainBtn, checklistBtn);
    body.append(rendered, actions);
    row.append(avatar, body);

    const messages = $("messages");
    if (messages) {
      messages.appendChild(row);
      if (scroll) {
        const conversation = $("conversation");
        if (conversation) {
          conversation.scrollTop = conversation.scrollHeight;
        }
      }
    }
  }

  function showTyping() {
    const row = document.createElement("article");
    row.className = "message assistant";
    row.id = "typing";
    row.innerHTML = '<div class="avatar">✳</div><div class="message-body"><span class="typing"><span></span><span></span><span></span></span></div>';
    const messages = $("messages");
    if (messages) messages.appendChild(row);
  }

  function renderWorkflow() {
    const workflow = $("workflow");
    if (workflow) workflow.hidden = true;
  }

  function boot() {
    const messages = $("messages");
    if (messages) {
      messages.hidden = false;
      appendMessage("assistant", "Halo! Saya siap membantu.\n\n- Siapkan rencana\n- Tindaklanjuti detail\n- Berikan hasil yang bisa dipakai.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
