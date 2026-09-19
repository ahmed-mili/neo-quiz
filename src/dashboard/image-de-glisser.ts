/* ══════════════════════════════════════════════════════════
   L'IMAGE QUI SUIT LE CURSEUR quand on glisse les fichiers d'une demande
   vers un site (modale d'attente du canal web, `renderWeb` dans ai.ts).

   Ce que fait l'Explorateur de Windows 11, capturé le 2026-09-19 : une pile
   des vraies miniatures sous le curseur, et le NOMBRE de fichiers dans un
   badge bleu carré au centre — « ultra important » (Ahmed) : sans lui, un
   glisser de cinq fichiers se lit comme celui d'un seul. La pile reprend
   l'ÉVENTAIL des piles de l'application (`.qbd-ai-preview-pdf:hover`) : la
   page de devant tourne d'un degré à gauche, les deux de derrière de deux et
   trois degrés à droite en glissant de 5 et 10 px. Devant, le fichier SAISI
   — celui sous le curseur au moment du geste.

   Dessinée d'avance (à l'affichage des piles), une par fichier saisissable :
   le `dragstart` n'attend pas, et `startDrag` prend l'image telle quelle.
══════════════════════════════════════════════════════════ */

export interface CarteDeGlisser {
	/** La miniature (première page d'un PDF, l'image elle-même) ; absente
	    pour une note, dessinée alors en feuille blanche portant son badge. */
	thumb?: string;
	/** Le badge d'extension (`badgeDeFichier`), pour la feuille d'une note. */
	badge: string;
}

/** La boîte de l'Explorateur, MESURÉE : 100 px à 100 %. */
const COTE = 100;
/** Le plus grand côté d'une page dans la pile. */
const CARTE = 64;
/** Le badge du nombre : 17 px liseré blanc compris, fond bleu de la
    sélection Windows — relevés au pixel sur la capture. */
const BADGE = 17;
const BLEU_WINDOWS = "#0074cc";
/** L'éventail de l'application, de la page du fond à celle de devant. */
const EVENTAIL = [
	{ dx: 10, deg: 3 },
	{ dx: 5, deg: 2 },
	{ dx: 0, deg: -1 },
];

function charger(src: string): Promise<HTMLImageElement | null> {
	return new Promise(resolve => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => resolve(null);
		img.src = src;
	});
}

/** Le liseré des pages : l'accent ASSOMBRI de moitié, comme les piles au
    survol. Lu sur le thème, calculé en sRGB (le canvas ne connaît pas
    `color-mix`). */
function lisere(): string {
	const sonde = document.body.appendChild(document.createElement("span"));
	sonde.style.color = "var(--interactive-accent)";
	const rgb = getComputedStyle(sonde).color.match(/\d+(\.\d+)?/g);
	sonde.remove();
	if (!rgb || rgb.length < 3) return "rgba(0, 0, 0, 0.35)";
	const [r, g, b] = rgb.map(Number);
	return `rgb(${Math.round(r / 2)}, ${Math.round(g / 2)}, ${Math.round(b / 2)})`;
}

function arrondi(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
	ctx.beginPath();
	ctx.roundRect(x, y, w, h, r);
}

function poserPage(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, badge: string, cx: number, cy: number, dx: number, deg: number, trait: string): void {
	/* Une image garde sa forme, bornée par CARTE ; une note est une feuille
	   A4 en portrait, comme ses piles dans la modale. */
	const ratio = img ? img.naturalWidth / Math.max(1, img.naturalHeight) : 57 / 80;
	const w = ratio >= 1 ? CARTE : CARTE * ratio;
	const h = ratio >= 1 ? CARTE / ratio : CARTE;
	ctx.save();
	ctx.translate(cx + dx, cy);
	ctx.rotate(deg * Math.PI / 180);
	ctx.shadowColor = "rgba(0, 0, 0, 0.24)";
	ctx.shadowBlur = 8;
	ctx.shadowOffsetY = 2;
	arrondi(ctx, -w / 2, -h / 2, w, h, 5);
	ctx.fillStyle = "#fff";
	ctx.fill();
	ctx.shadowColor = "transparent";
	ctx.save();
	ctx.clip();
	if (img) {
		ctx.drawImage(img, -w / 2, -h / 2, w, h);
	} else {
		/* Le badge d'extension dans le TIERS HAUT de la feuille, pas au
		   centre : le centre est au badge du nombre, qui le cacherait — et le
		   type d'un fichier reste toujours visible. */
		const by = -h / 2 + 16;
		ctx.font = "700 9px ui-monospace, Consolas, monospace";
		const tw = ctx.measureText(badge).width;
		arrondi(ctx, -tw / 2 - 5, by - 8, tw + 10, 16, 4);
		ctx.fillStyle = "#eef0f8";
		ctx.fill();
		ctx.fillStyle = "#7c80a0";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(badge, 0, by + 0.5);
	}
	ctx.restore();
	arrondi(ctx, -w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1, 5);
	ctx.strokeStyle = trait;
	ctx.lineWidth = 1;
	ctx.stroke();
	ctx.restore();
}

/**
 * L'image PNG (`data:` URL) du glisser quand le fichier `saisi` est sous le
 * curseur, à l'échelle de l'écran (`echelle` = `devicePixelRatio`). `null`
 * si le canvas manque : l'hôte retombe alors sur l'icône de type.
 */
export async function composerImageDeGlisser(cartes: CarteDeGlisser[], saisi: number, echelle: number): Promise<string | null> {
	const n = cartes.length;
	if (n === 0) return null;
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(COTE * echelle);
	canvas.height = Math.round(COTE * echelle);
	const ctx = canvas.getContext("2d");
	if (!ctx) return null;
	ctx.scale(echelle, echelle);

	/* Du fond vers l'avant : les deux fichiers qui SUIVENT le saisi, puis
	   lui. Un fichier seul n'a pas d'éventail — une pile dirait « plusieurs ». */
	const ordre = [(saisi + 2) % n, (saisi + 1) % n, saisi].slice(3 - Math.min(n, 3));
	const images = await Promise.all(ordre.map(i => cartes[i].thumb ? charger(cartes[i].thumb as string) : Promise.resolve(null)));
	const trait = lisere();
	/* Le centre est décalé à gauche de la moitié de l'éventail : la pile
	   entière reste centrée dans la boîte. */
	const cx = COTE / 2 - (n > 1 ? 5 : 0);
	const cy = COTE / 2;
	const pas = EVENTAIL.slice(3 - ordre.length);
	ordre.forEach((i, k) => poserPage(ctx, images[k], cartes[i].badge, cx, cy, pas[k].dx, pas[k].deg, trait));

	if (n > 1) {
		const texte = String(n);
		ctx.font = "600 11px 'Segoe UI', system-ui, sans-serif";
		const cote = Math.max(BADGE, Math.ceil(ctx.measureText(texte).width) + 8);
		const x = Math.round(cx - cote / 2);
		const y = Math.round(cy - BADGE / 2);
		ctx.fillStyle = "#fff";
		ctx.fillRect(x, y, cote, BADGE);
		ctx.fillStyle = BLEU_WINDOWS;
		ctx.fillRect(x + 1, y + 1, cote - 2, BADGE - 2);
		ctx.fillStyle = "#fff";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(texte, x + cote / 2, y + BADGE / 2 + 0.5);
	}
	return canvas.toDataURL("image/png");
}
