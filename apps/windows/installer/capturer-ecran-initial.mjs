/*
 * L'IMAGE QUE LE CONTENEUR PORTABLE MONTRE AVANT ELECTRON.
 *
 * Le conteneur NSIS peint sa fenêtre en ~70 ms ; Electron, extrait puis
 * démarré, ne se montre qu'après ~0,9 s. Pour que le double-clic ouvre tout de
 * suite LA fenêtre de l'installeur, le conteneur affiche `ecran-initial.bmp` :
 * le premier écran du bootstrapper (barre de titre et décor), rendu par ce
 * même Electron, au pixel près, à la taille que `main-ui.ts` donne à la
 * fenêtre. Electron s'ouvre ensuite exactement par-dessus, et seul le rond
 * qui tourne apparaît : c'est lui que cette capture MASQUE, sans quoi il
 * s'afficherait figé puis disparaîtrait le temps de son entrée en fondu.
 *
 * À relancer quand le premier écran change (décor, barre de titre, taille) :
 *   npm run build:installer
 *   npx electron installer/capturer-ecran-initial.mjs
 *
 * Échelle 1 forcée : le conteneur n'est pas « DPI aware », Windows agrandit
 * sa fenêtre comme il le ferait de n'importe quelle image 96 ppp, et c'est ce
 * qui la pose aux mêmes coordonnées que la fenêtre Electron.
 */
import { app, BrowserWindow } from "electron";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ici = fileURLToPath(new URL(".", import.meta.url));
const page = join(ici, "..", "dist-bootstrapper", "index.html");
const sortie = join(ici, "ecran-initial.bmp");
/* Le haut du dégradé de `#app` (`style-window.css`) : la couleur sur
   laquelle les coins transparents de la capture sont aplatis. */
const FOND = { r: 0x07, g: 0x11, b: 0x1f };

app.commandLine.appendSwitch("force-device-scale-factor", "1");

/** Un pont `neoInstaller` qui ne répond jamais : le rendu reste sur son
    premier écran, celui du chargement. */
const PONT_FIGE = `
window.neoInstaller = new Proxy({}, {
	get: (_cible, nom) => nom === "initialiser" || nom === "espaceDisque"
		? () => new Promise(() => {})
		: () => undefined,
});
`;

/** BMP 24 bits, lignes de bas en haut ; les pixels BGRA prémultipliés de
    Chromium sont composés sur `FOND`. */
function bmp24(bgra, largeur, hauteur) {
	const ligne = Math.ceil((largeur * 3) / 4) * 4;
	const taille = 54 + ligne * hauteur;
	const sortieBmp = Buffer.alloc(taille);
	sortieBmp.write("BM", 0, "ascii");
	sortieBmp.writeUInt32LE(taille, 2);
	sortieBmp.writeUInt32LE(54, 10);
	sortieBmp.writeUInt32LE(40, 14);
	sortieBmp.writeInt32LE(largeur, 18);
	sortieBmp.writeInt32LE(hauteur, 22);
	sortieBmp.writeUInt16LE(1, 26);
	sortieBmp.writeUInt16LE(24, 28);
	sortieBmp.writeUInt32LE(ligne * hauteur, 34);
	for (let y = 0; y < hauteur; y++) {
		const destination = 54 + (hauteur - 1 - y) * ligne;
		for (let x = 0; x < largeur; x++) {
			const i = (y * largeur + x) * 4;
			const reste = 255 - bgra[i + 3];
			sortieBmp[destination + x * 3] = Math.min(255, bgra[i] + Math.round((FOND.b * reste) / 255));
			sortieBmp[destination + x * 3 + 1] = Math.min(255, bgra[i + 1] + Math.round((FOND.g * reste) / 255));
			sortieBmp[destination + x * 3 + 2] = Math.min(255, bgra[i + 2] + Math.round((FOND.r * reste) / 255));
		}
	}
	return sortieBmp;
}

async function capturer() {
	const temporaire = await mkdtemp(join(tmpdir(), "neo-quiz-capture-"));
	try {
		const preload = join(temporaire, "pont.cjs");
		await writeFile(preload, PONT_FIGE);
		const fenetre = new BrowserWindow({
			width: 720,
			height: 640,
			useContentSize: true,
			frame: false,
			transparent: true,
			show: false,
			webPreferences: { preload, contextIsolation: false, sandbox: false },
		});
		await fenetre.loadFile(page, { query: { lang: "en" } });
		await fenetre.webContents.insertCSS(
			".nqi-loading-spinner { visibility: hidden !important; } .nqi-entre { animation: none !important; }",
		);
		await fenetre.webContents.executeJavaScript(`(async () => {
			await document.fonts.ready;
			await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
			const fond = new Image();
			fond.src = "./fond.png";
			await fond.decode();
			await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
		})()`);
		const image = await fenetre.capturePage();
		const { width, height } = image.getSize();
		if (width !== 720 || height !== 640) throw new Error(`capture de ${width}×${height}, 720×640 attendu`);
		await writeFile(sortie, bmp24(image.toBitmap(), width, height));
		console.log(`${sortie} (${width}×${height})`);
	} finally {
		await rm(temporaire, { recursive: true, force: true });
		app.quit();
	}
}

/* Pas de `await` au niveau du module : Electron ne déclenche `ready` qu'une
   fois l'évaluation du point d'entrée ESM terminée. */
void app.whenReady().then(capturer);
