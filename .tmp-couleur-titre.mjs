const fs = await import("node:fs");
const LISTE = await fetch("http://127.0.0.1:9222/json").then(r => r.json());
const page = LISTE.find(p => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0; const enAttente = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && enAttente.has(m.id)) { enAttente.get(m.id)(m); enAttente.delete(m.id); } };
const envoyer = (method, params = {}) => new Promise(res => { const id = ++seq; enAttente.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await new Promise(r => ws.onopen = r);
const evaluer = async expr => {
	const r = await envoyer("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
	if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
	return r.result.result.value;
};
const r = await evaluer(`(() => {
	const t = document.querySelector('.qbd-web-wait-title');
	if (!t) return { present: false };
	const em = t.querySelector('strong.qbd-ai-web-em');
	return {
		present: true,
		texte: t.textContent,
		em: em ? { texte: em.textContent, couleur: getComputedStyle(em).color } : null,
		couleurTitre: getComputedStyle(t).color
	};
})()`);
console.log(JSON.stringify(r));
ws.close();
