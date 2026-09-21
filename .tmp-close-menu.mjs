// Referme le menu fournisseur (Escape) après une vérification CDP.
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
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
console.log("Escape envoyé");
ws.close();