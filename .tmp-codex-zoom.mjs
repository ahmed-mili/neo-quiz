// Zoom, variante : sonde d'état avant capture.
import http from "node:http";
import fs from "node:fs";
const getJson = (path) => new Promise((res, rej) => {
  http.get({ host: "127.0.0.1", port: 9222, path }, (r) => { let d = ""; r.on("data", c => d += c); r.on("end", () => res(JSON.parse(d))); }).on("error", rej);
});
const targets = await getJson("/json");
const page = targets.find(t => t.webSocketDebuggerUrl && t.type === "page");
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

for (let i = 0; i < 30; i++) { if (await ev(`!!document.querySelector('.qbd-ai-composer-tools .qbd-select')`)) break; await sleep(500); }
const menuAvant = await ev(`!!document.querySelector('.qbd-provider-menu')`);
console.log("menu déjà ouvert:", menuAvant);
if (!menuAvant) { await ev(`document.querySelector('.qbd-ai-composer-tools .qbd-select').click()`); await sleep(700); }

await ev(`(() => {
  const items = [...document.querySelectorAll('.qbd-provider-menu .qbd-select-option')];
  const item = items.find(el => /ChatGPT/i.test(el.textContent));
  if (!item) return "PAS DE LIGNE";
  for (const type of ['mousemove', 'mouseenter', 'mouseover']) {
    item.dispatchEvent(new MouseEvent(type, { bubbles: true }));
  }
  return "hover envoyé";
})()`);
await sleep(700);

const etat = await ev(`(() => {
  const flys = [...document.querySelectorAll('.qbd-channel-flyout, .qbd-more-providers-flyout')];
  return {
    flyouts: flys.map(f => f.className),
    rows: flys.flatMap(f => [...f.querySelectorAll('.qbd-select-option')].map(r => r.textContent.slice(0, 30))),
  };
})()`);
console.log(JSON.stringify(etat, null, 2));

const rect = await ev(`(() => {
  const fly = document.querySelector('.qbd-channel-flyout');
  if (!fly) return null;
  const row = [...fly.querySelectorAll('.qbd-select-option')].find(el => /Codex CLI/i.test(el.textContent));
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
})()`);
console.log("rect:", JSON.stringify(rect));
if (rect) {
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: rect.x - 4, y: rect.y - 4, width: rect.width + 8, height: rect.height + 8, scale: 4 } });
  fs.writeFileSync("C:/dev/neo-quiz/.tmp-codex-zoom.png", Buffer.from(shot.result.data, "base64"));
  console.log("capture: .tmp-codex-zoom.png");
}
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
ws.close();
