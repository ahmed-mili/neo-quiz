// Sonde la modale d'attente web : chaque `strong` et sa couleur calculée,
// plus tout résidu de `**` littéral (un double astérisque qui aurait fui).
import http from "node:http";
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

const sonde = await ev(`(() => {
  const modal = document.querySelector('.qbd-web-wait-modal');
  if (!modal) return { ouverte: false };
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--interactive-accent') || '';
  const forts = [...modal.querySelectorAll('strong')].map(s => {
    const cs = getComputedStyle(s);
    return { texte: s.textContent, classe: s.className, couleur: cs.color, gras: cs.fontWeight };
  });
  // Tout texte ** littéral restant dans la modale ?
  const fuites = [...modal.querySelectorAll('*')].filter(el => el.children.length === 0 && /\\*\\*/.test(el.textContent)).map(el => el.tagName + ': ' + el.textContent.trim().slice(0, 80));
  return { ouverte: true, accent: accent.trim(), forts, fuites, titre: modal.querySelector('.qbd-web-wait-title')?.textContent };
})()`);
console.log(JSON.stringify(sonde, null, 2));
ws.close();