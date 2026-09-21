// Test visuel du logo Codex coloré : ouvrir le menu, survoler ChatGPT, capturer le flyout.
import http from "node:http";
import fs from "node:fs";

const getJson = (path) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: 9222, path }, (r) => {
    let d = ""; r.on("data", c => d += c); r.on("end", () => res(JSON.parse(d)));
  }).on("error", rej);
});
const targets = await getJson("/json");
const page = targets.find(t => t.webSocketDebuggerUrl && t.type === "page");
if (!page) { console.error("AUCUNE PAGE"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(res => ws.onopen = res);
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Attendre que le composer soit rendu (rendu asynchrone après reload)
let ok = false;
for (let i = 0; i < 30; i++) {
  if (await ev(`!!document.querySelector('.qbd-ai-composer-tools .qbd-select')`)) { ok = true; break; }
  await sleep(500);
}
if (!ok) { console.error("composer absent"); process.exit(1); }

// Ouvrir le menu fournisseur
await ev(`document.querySelector('.qbd-ai-composer-tools .qbd-select').click()`);
await sleep(600);

// Trouver la ligne ChatGPT et survoler pour ouvrir le flyout
const hoverCodex = await ev(`(() => {
  const items = [...document.querySelectorAll('.qbd-provider-menu .qbd-select-option')];
  const item = items.find(el => /ChatGPT/i.test(el.textContent));
  if (!item) return null;
  item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  item.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  return item.textContent.slice(0, 80);
})()`);
console.log("ligne:", hoverCodex);
await sleep(700);

// Sonde : le flyout Codex est-il ouvert, le gradient est-il là ?
const probe = await ev(`(() => {
  const fly = document.querySelector('.qbd-channel-flyout');
  if (!fly) return { flyout: false };
  const svg = fly.querySelector('svg');
  const grads = [...document.querySelectorAll('linearGradient[id*="codex"]')];
  return {
    flyout: true,
    svgCount: fly.querySelectorAll('svg').length,
    ids: grads.map(g => g.id),
    logoHtml: svg ? svg.outerHTML.slice(0, 120) : null,
  };
})()`);
console.log(JSON.stringify(probe, null, 2));

// Capture du menu + flyout
const shot = await send("Page.captureScreenshot", { format: "png" });
fs.writeFileSync("C:/dev/neo-quiz/.tmp-flyout-chatgpt.png", Buffer.from(shot.result.data, "base64"));
console.log("capture: .tmp-flyout-chatgpt.png");

// Refermer le menu (Esc)
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
ws.close();
