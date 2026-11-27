"use strict";

// This file only runs in the opaque, network-restricted Google citation frame.
const tags = new Set(["style", "div", "span", "a", "svg", "path", "g", "title", "rect", "circle", "defs", "clipPath"]);
const attributes = new Set(["class", "id", "style", "role", "dir", "title", "href", "target", "rel", "xmlns", "width", "height", "viewBox", "fill", "d", "transform", "clip-path", "fill-rule", "clip-rule", "cx", "cy", "r", "x", "y", "rx"]);

function googleLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ((url.hostname === "www.google.com" && url.pathname === "/search") ||
       (url.hostname === "vertexaisearch.cloud.google.com" && url.pathname.startsWith("/grounding-api-redirect/")));
  } catch {
    return false;
  }
}

function widget(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll("*")) {
    if (!tags.has(element.localName) || [...element.attributes].some(attribute =>
      !attributes.has(attribute.name) && !attribute.name.startsWith("aria-"))) return null;
    if (element.hasAttribute("href") && element.localName !== "a") return null;
    if (element.localName === "a" &&
        (!googleLink(element.getAttribute("href")) || element.getAttribute("target") !== "_blank")) return null;
  }
  return template.content.querySelector("a") ? template.content : null;
}

window.addEventListener("message", event => {
  if (event.source !== parent || event.origin !== new URL(location.href).origin || event.data?.type !== "bor-google-grounding") return;
  const suggestions = event.data.suggestions;
  if (!Array.isArray(suggestions) || !suggestions.length || suggestions.length > 5 ||
      suggestions.some(html => typeof html !== "string" || html.length > 32000)) return;
  const fragments = suggestions.map(widget);
  const ok = fragments.every(Boolean);
  if (ok) document.querySelector("main").replaceChildren(...fragments);
  parent.postMessage({ type: "bor-google-grounding-ready", ok }, event.origin);
});
