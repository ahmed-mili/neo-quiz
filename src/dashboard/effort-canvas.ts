/* ══════════════════════════════════════════════════════════
   EFFORT CANVAS — piste Ultracode du slider d'effort Claude.
   Port fidèle du handoff « design_handoff_effort_slider »
   (2026-07-10), validé au pixel contre l'animation d'origine —
   ne pas « améliorer » : chaque constante a été validée une à une.
   Mosaïque de points flous sur grille 4px (5 rangées dans une
   piste de 22px) : chargement droite→gauche à l'ouverture, puis
   4 mini-vagues continues droite→gauche (jamais de pause) pendant
   que 20 % des points actifs pulsent sur place (« afk »).
   Aucun pixel noir : éteint = violet foncé grisé rgb(96,88,128).
   Vitesse validée : speed = 0.3.
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";

/* Bruit déterministe par pixel — NE PAS remplacer par Math.random()
   (identités stables des points : toute l'animation en dépend). */
function hash(x: number, y: number): number {
	let h = x * 374761393 + y * 668265263;
	h = (h ^ (h >> 13)) * 1274126177;
	h = h ^ (h >> 16);
	return ((h >>> 0) % 1000) / 1000;
}

function hexRGB(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Options de createEffortTrackFx (accent hex, vitesse, valeur initiale 0..1). */
export interface EffortTrackFxOptions {
	accent?: string;
	speed?: number;
	value?: number;
}

/** API retournée par createEffortTrackFx. */
export interface EffortTrackFx {
	setValue(v: number, animate?: boolean): void;
	setUltra(on: boolean): void;
	/** Rejoue l'animation de chargement (piste vide → remplissage). */
	replay(): void;
	destroy(): void;
}

/*
 * createEffortTrackFx(trackEl, thumbEl, { accent, speed, value }) →
 *   { setValue(v, animate?), setUltra(on), replay(), destroy() }
 * Pilote le pouce en transform (formule du handoff : 1 + v·(W−thumbW−2)),
 * avec un tween de 150 ms entre niveaux (le handoff suit le pointeur
 * en continu ; ici les niveaux sont discrets — la durée vient de la
 * source Claude Code : transition .15s). Dessine la mosaïque quand le
 * niveau accent (ultracode) est actif ; l'y (ré)entrer rejoue le
 * chargement droite→gauche. reduced-motion : une frame statique par
 * changement, aucune boucle rAF.
 */
export function createEffortTrackFx(trackEl: HTMLElement, thumbEl: HTMLElement, opts: EffortTrackFxOptions): EffortTrackFx {
	const accent = hexRGB(opts.accent || "#a78bfa");
	const speed = opts.speed || 0.3;
	const reduceMotion = !!(window.matchMedia
		&& window.matchMedia("(prefers-reduced-motion: reduce)").matches);

	const canvas = ajouter(trackEl, "canvas", "qbd-effort-canvas");
	trackEl.insertBefore(canvas, thumbEl); // la mosaïque vit SOUS le pouce

	let value = Math.min(1, Math.max(0, opts.value || 0)); // cible (0..1)
	let shown = value;            // position affichée (tween → value)
	let tweenFrom = value;
	let tweenT0 = 0;
	let tweening = false;
	let ultra = false;
	let t0 = performance.now();   // origine du chargement droite→gauche
	let raf = 0;
	let dead = false;

	function schedule(): void {
		if (!raf && !dead) raf = requestAnimationFrame(frame);
	}

	function frame(now: number): void {
		raf = 0;
		if (tweening) {
			let p = (now - tweenT0) / 150;
			if (p >= 1) { p = 1; tweening = false; }
			const e = p * p * (3 - 2 * p);
			shown = tweenFrom + (value - tweenFrom) * e;
		}
		draw(now);
		if ((ultra && !reduceMotion) || tweening) schedule();
	}

	function draw(now: number): void {
		const dpr = window.devicePixelRatio || 1;
		const W = trackEl.clientWidth, H = trackEl.clientHeight;
		if (!W) return;
		const thumbW = 17.1; // 15px du handoff +25 %, −5 %, −4 % (amendements Ahmed)
		const thumbX = 1 + shown * (W - thumbW - 2);
		thumbEl.style.transform = "translateX(" + thumbX + "px)";
		if (!ultra) return;

		if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, W, H);

		// reduced-motion : frame figée, chargement déjà terminé.
		const t = reduceMotion ? 8 : (now - t0) / 1000;

		// Grille : 5 rangées dans une piste de 22px (pas 4px, point 2.6px)
		const pitch = 4, size = 2.6;
		const cols = Math.floor(W / pitch);
		const rows = Math.floor(H / pitch);
		const ox = (W - (cols * pitch - (pitch - size))) / 2;
		const oy = (H - (rows * pitch - (pitch - size))) / 2;

		const ts = t * speed;          // temps "animation" (échelle speed)
		const loadSpread = 0.30;       // balayage de chargement droite→gauche
		const fadeDur = 0.12;          // fondu d'apparition par point
		const drift = ts * 22;         // texture scintillante qui glisse vers la gauche
		const shiftI = Math.floor(drift), shiftF = drift - shiftI;

		// 4 mini-vagues décalées, en continu (jamais de pause)
		const waveTravel = 0.55, waveCycle = 0.55, NW = 4;
		const waves: Array<{ wc: number; wi: number }> = [];
		for (let k = 0; k < NW; k++) {
			const tk = ts + (k * waveCycle) / NW;
			const wp = tk % waveCycle;
			waves.push({
				wc: 1.08 - (wp / waveTravel) * 1.25,             // centre de vague (espace fx 0..1)
				wi: Math.floor(tk / waveCycle) * 31 + k * 997,   // graine fraîche à chaque vague
			});
		}
		const rad = size / 2;
		const TAU = 6.2832;

		// Palette : éteint = violet foncé grisé (toujours visible),
		// allumé = violet-blanc (accent adouci).
		const UN = [96, 88, 128];
		const accMuted = [
			accent[0] * 0.58 + 255 * 0.42,
			accent[1] * 0.58 + 255 * 0.42,
			accent[2] * 0.58 + 255 * 0.42,
		];

		for (let c = 0; c < cols; c++) {
			const x = ox + c * pitch;
			const fx = (x + size / 2) / W;                 // position 0..1 sur la piste
			const filled = x + size / 2 < thumbX + thumbW / 2;
			for (let r = 0; r < rows; r++) {
				const y = oy + r * pitch;
				const nid = hash(c, r);                      // identité stable du point
				const nid2 = hash(c + 917, r + 31);

				// Chargement : apparition depuis la droite, décalage aléatoire
				const appearAt = (1 - fx) * loadSpread + nid * 0.15;
				let p = (ts - appearAt) / fadeDur;
				if (p <= 0) continue;
				if (p > 1) p = 1;
				const ease = p * p * (3 - 2 * p);

				// ~40% des points ne s'allument jamais (restent violet éteint)
				const nid3 = hash(c + 1733, r + 57);
				let lit: number;
				if (nid3 < 0.4) {
					lit = 0;
				} else if (nid2 < 0.2) {
					// 20% des actifs : clignotant "afk" — pulse lente sur place
					// (1.6–6.1 s, temps réel, PAS multiplié par speed)
					const period = 1.6 + nid * 4.5;
					lit = 0.5 + 0.5 * Math.sin(t * TAU / period + nid2 * 40);
				} else {
					// 80% des actifs : voyageurs allumés par les mini-vagues
					const a0 = hash(c + shiftI, r);
					const a1 = hash(c + shiftI + 1, r);
					const tex = a0 + (a1 - a0) * shiftF;       // texture scintillante
					let front = 0;
					for (let k = 0; k < NW; k++) {
						const w = waves[k];
						const j = (hash(c * 7 + w.wi, r * 3 + w.wi) - 0.5) * 0.18;  // front irrégulier
						const tr = 0.07 + hash(c + w.wi * 13, r + 5) * 0.09;        // traînée 0.07–0.16
						const d = fx - (w.wc + j);
						const f = (d >= 0 ? Math.exp(-d / tr) : Math.exp(d / 0.02))
							* (0.5 + 0.7 * hash(c + w.wi * 29, r * 11 + w.wi));
						if (f > front) front = f;
					}
					lit = Math.min(1, front * (0.45 + 0.75 * tex) * 1.35);
				}

				// Enveloppe de visibilité : 100% sur la moitié droite,
				// fondu de 50%→2%, invisible sur les 2% gauche (amendé par
				// Ahmed 2026-07-10 : le 1/10 du handoff était trop agressif,
				// affiné 6 % → 4 % → 2 %)
				let env: number;
				if (fx >= 0.5) env = 1;
				else if (fx <= 0.02) env = 0;
				else { const q = (fx - 0.02) / 0.48; env = q * q * (3 - 2 * q); }
				if (env <= 0.01) continue;
				if (!filled) lit *= 0.1;                     // à droite du curseur : quasi éteint

				// Couleur allumée : gris-lavande à gauche → accent adouci à droite
				const m = Math.min(1, fx * (0.6 + 0.8 * nid));
				const lr = 152 + (accMuted[0] - 152) * m + 14 * nid;
				const lg = 144 + (accMuted[1] - 144) * m + 10 * nid;
				const lb = 176 + (accMuted[2] - 176) * m + 18 * nid;

				// Couleur finale : interpolation éteint → allumé
				const cr = (UN[0] + (lr - UN[0]) * lit) | 0;
				const cg = (UN[1] + (lg - UN[1]) * lit) | 0;
				const cb = (UN[2] + (lb - UN[2]) * lit) | 0;

				// Point flou : dégradé radial doux (pas de cercle net)
				const A = ease * env;
				const cx = x + rad, cy = y + rad, R = rad * 1.6;
				const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
				const base = "rgba(" + cr + "," + cg + "," + cb + ",";
				g.addColorStop(0, base + A.toFixed(3) + ")");
				g.addColorStop(0.55, base + (A * 0.75).toFixed(3) + ")");
				g.addColorStop(1, base + "0)");
				ctx.fillStyle = g;
				ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
			}
		}
	}

	return {
		setValue(v: number, animate?: boolean): void {
			value = Math.min(1, Math.max(0, v));
			if (animate && !reduceMotion) {
				tweenFrom = shown;
				tweenT0 = performance.now();
				tweening = true;
			} else {
				shown = value;
				tweening = false;
			}
			schedule();
		},
		setUltra(on: boolean): void {
			on = !!on;
			if (on === ultra) return;
			ultra = on;
			if (on) {
				t0 = performance.now(); // rejoue le chargement droite→gauche
			} else {
				const c = canvas.getContext("2d");
				if (c) {
					c.setTransform(1, 0, 0, 1, 0, 0);
					c.clearRect(0, 0, canvas.width, canvas.height);
				}
			}
			schedule();
		},
		/** Rejoue l'animation de chargement (piste vide → remplissage). */
		replay(): void {
			t0 = performance.now();
			schedule();
		},
		destroy(): void {
			dead = true;
			if (raf) cancelAnimationFrame(raf);
			raf = 0;
			canvas.remove();
		},
	};
}
