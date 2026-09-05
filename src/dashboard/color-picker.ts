/* ══════════════════════════════════════════════════════════
   COLOR PICKER — popover de couleur personnalisée, PORT du
   ColorPicker.tsx de neo-calendar (demande Ahmed 2026-07-18 :
   « recopier son code », SANS la grille de presets du bas).
   Vanilla DOM (pas de React ici) : mêmes maths hex↔rgb↔hsv,
   même zone saturation/valeur + barre de teinte + champ hex,
   même positionnement clampé et dismiss clic-dehors/Escape.
   Portalé à document.body (au-dessus du modal et des menus).
══════════════════════════════════════════════════════════ */

import { ajouter } from "../dom";

// ── Maths couleur (hex ↔ rgb ↔ hsv) — copie neo-calendar ──

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	let h = hex.replace("#", "").trim();
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	const n = parseInt(h, 16);
	if (h.length !== 6 || Number.isNaN(n)) return { r: 124, g: 92, b: 255 };
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
	const c = (v: number) =>
		Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
	return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
	r /= 255; g /= 255; b /= 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d !== 0) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	const s = max === 0 ? 0 : d / max;
	return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
	const c = v * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = v - c;
	let r = 0, g = 0, b = 0;
	if (h < 60) [r, g, b] = [c, x, 0];
	else if (h < 120) [r, g, b] = [x, c, 0];
	else if (h < 180) [r, g, b] = [0, c, x];
	else if (h < 240) [r, g, b] = [0, x, c];
	else if (h < 300) [r, g, b] = [x, 0, c];
	else [r, g, b] = [c, 0, x];
	return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

const PICKER_W = 232;
/* Hauteur SANS la grille de presets : padding 12 + SV 140 + gap 10 +
   hue 12 + gap 10 + rangée hex 26 + padding 12. */
const PICKER_H = 222;

export interface ColorPickerHandle {
	close(): void;
}

/*
 * openColorPicker(anchorEl, color, onChange, container) — popover portalé.
 * onChange est émis EN CONTINU pendant le drag (aperçu live, comme
 * neo-calendar) ; la fermeture se fait au clic dehors / Escape / Enter.
 *
 * `container` (défaut : document.body) — parent du popover. Ouvert DEPUIS UN
 * MODAL, il DOIT être le modalEl : le focus trap d'Obsidian ramène tout focus
 * hors de `modalEl` vers le 1er champ du modal, donc un picker portalé au body
 * voit son input hex défocalisé instantanément (le focus saute au champ « nom »).
 * Le rester enfant du modalEl garde `modalEl.contains(input)` vrai → pas de vol.
 * Sûr côté position : le popover est `position: fixed`, et aucun ancêtre du
 * modal n'a de transform/contain (vérifié), donc il reste calé au viewport et
 * n'est pas clippé par un overflow.
 */
export function openColorPicker(
	anchorEl: HTMLElement,
	color: string,
	onChange: (hex: string) => void,
	container: HTMLElement = document.body
): ColorPickerHandle {
	const anchorRect = anchorEl.getBoundingClientRect();

	const init = hexToRgb(color);
	let { h, s, v } = rgbToHsv(init.r, init.g, init.b);
	let hexText = color;

	const root = ajouter(container, "div", "qbd-color-picker");
	root.style.width = PICKER_W + "px";
	// Ne pas laisser bouillonner : un mousedown intérieur fermerait le
	// menu/modal parent (leurs listeners document sont en bubble).
	root.addEventListener("mousedown", (e) => e.stopPropagation());

	// ── Position (clampée au viewport, flip au-dessus si trop bas) ──
	let top = anchorRect.bottom + 6;
	if (top + PICKER_H > window.innerHeight - 8)
		top = Math.max(8, anchorRect.top - PICKER_H - 6);
	const left = Math.max(8, Math.min(anchorRect.left, window.innerWidth - 8 - PICKER_W));
	root.style.top = top + "px";
	root.style.left = left + "px";

	// ── Zone saturation / valeur ──
	const sv = ajouter(root, "div", "qbd-cp-sv");
	const svThumb = ajouter(sv, "span", "qbd-cp-sv-thumb");

	// ── Barre de teinte ──
	const hue = ajouter(root, "div", "qbd-cp-hue");
	const hueThumb = ajouter(hue, "span", "qbd-cp-hue-thumb");

	// ── Swatch courant + champ hex ──
	const rowEl = ajouter(root, "div", "qbd-cp-row");
	const current = ajouter(rowEl, "span", "qbd-cp-current");
	const hexInput = ajouter(rowEl, "input", "qbd-cp-hex");
	hexInput.spellcheck = false;
	// Un hex vaut au plus « #RRGGBB » (7 car.) : borne la saisie pour éviter
	// un champ qui déborde (#ffffffffff… tapé à la main).
	hexInput.maxLength = 7;
	hexInput.value = hexText;

	function paint(): void {
		const hueColor = `hsl(${h}, 100%, 50%)`;
		sv.style.background =
			`linear-gradient(to bottom, rgba(0,0,0,0), #000), ` +
			`linear-gradient(to right, #fff, rgba(255,255,255,0)), ${hueColor}`;
		svThumb.style.left = `${s * 100}%`;
		svThumb.style.top = `${(1 - v) * 100}%`;
		hueThumb.style.left = `${(h / 360) * 100}%`;
		current.style.background = hexText;
	}

	function emit(): void {
		const { r, g, b } = hsvToRgb(h, s, v);
		hexText = rgbToHex(r, g, b);
		hexInput.value = hexText;
		paint();
		onChange(hexText);
	}

	// ── Drags (SV puis teinte) — copie du pattern neo-calendar ──
	sv.addEventListener("mousedown", (e) => {
		const move = (clientX: number, clientY: number) => {
			const r = sv.getBoundingClientRect();
			s = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
			v = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
			emit();
		};
		move(e.clientX, e.clientY);
		const onMove = (ev: MouseEvent) => move(ev.clientX, ev.clientY);
		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	});

	hue.addEventListener("mousedown", (e) => {
		const move = (clientX: number) => {
			const r = hue.getBoundingClientRect();
			h = Math.max(0, Math.min(360, ((clientX - r.left) / r.width) * 360));
			emit();
		};
		move(e.clientX);
		const onMove = (ev: MouseEvent) => move(ev.clientX);
		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
		};
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	});

	// ── Saisie hex directe ──
	function applyHex(hex: string): void {
		const clean = hex.startsWith("#") ? hex : `#${hex}`;
		if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(clean)) return;
		const { r, g, b } = hexToRgb(clean);
		({ h, s, v } = rgbToHsv(r, g, b));
		hexText = rgbToHex(r, g, b);
		paint();
		onChange(hexText);
	}
	hexInput.addEventListener("input", () => {
		hexText = hexInput.value;
		applyHex(hexInput.value);
	});
	hexInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") close();
	});

	// ── Dismiss clic-dehors / Escape ──
	const onDocDown = (e: MouseEvent) => {
		if (!root.contains(e.target as Node)) close();
	};
	const onKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") close();
	};
	document.addEventListener("mousedown", onDocDown);
	document.addEventListener("keydown", onKey);

	function close(): void {
		document.removeEventListener("mousedown", onDocDown);
		document.removeEventListener("keydown", onKey);
		root.remove();
	}

	paint();
	return { close };
}
