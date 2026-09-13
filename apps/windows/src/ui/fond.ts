/* ══════════════════════════════════════════════════════════
   LE FOND D'ÉCRAN — VU DU RENDU

   Le réglage `{ dossier: string; image: string }` (`CLE_REGLAGES_FOND`,
   `electron/pont.ts`) est écrit par CE module seul, jamais gardé côté
   principal : un chemin qui n'a jamais transité par le sélecteur natif
   n'est simplement pas SERVABLE par `app:` (403), il ne donne aucun accès
   disque supplémentaire — voir l'en-tête de la clé. `perimetreInitial`
   (`electron/perimetre.ts`) admet le `dossier` persisté au démarrage
   suivant, exactement comme les dossiers de quiz.

   Le voile sombre de `shell.css` ne bouge jamais : ce module ne pose QUE
   l'image, dans la variable `--nq-fond-image`, que la règle `body` compose
   avec le dégradé. `pont()` est lu À L'APPEL, jamais capturé au chargement
   du module — même règle que `reprise.ts` et `mise-a-jour.ts`.
══════════════════════════════════════════════════════════ */

import { pont } from "../host/pont";
import { CLE_REGLAGES_FOND } from "../../electron/pont";
import { urlDeRessource } from "../../electron/ressources";
import { currentHost } from "../../../../src/host/current";
import { t } from "../../../../src/i18n";
import { ajouter } from "../../../../src/dom";
import { estImageDeFond, suivante } from "./fond-pur";

interface ReglageFond {
	dossier: string;
	image: string;
}

/** Relit le réglage BRUT (JSON de `neo.reglages`) sans jamais lui faire
    confiance : deux chaînes non vides, sinon `null` — même garde que
    `reprise.ts` sur une valeur qui peut avoir été écrite par une version
    antérieure ou trafiquée à la main. */
function validerReglage(brut: unknown): ReglageFond | null {
	if (!brut || typeof brut !== "object") return null;
	const dossier = (brut as { dossier?: unknown }).dossier;
	const image = (brut as { image?: unknown }).image;
	if (typeof dossier !== "string" || dossier.trim() === "") return null;
	if (typeof image !== "string" || image.trim() === "") return null;
	return { dossier, image };
}

/** Les images de fond du dossier, triées par nom — la même liste que
    `suivante` attend. Un dossier disparu (clé USB retirée) rend `[]` : le
    pont rejette pour un dossier hors périmètre, jamais une exception qui
    remonterait jusqu'à l'appelant. */
async function listerImages(dossier: string): Promise<string[]> {
	let entrees: Array<{ name: string; isFolder: boolean }>;
	try {
		entrees = await pont().fichiers.listerDossier(dossier);
	} catch {
		return [];
	}
	return entrees.filter(e => !e.isFolder && estImageDeFond(e.name)).map(e => e.name).sort((a, b) => a.localeCompare(b));
}

/** Pose l'image dans la variable CSS, ou l'efface (le CSS reprend alors
    `wallpaper.jpg`, son repli). */
function poserVariable(dossier: string | null, image: string | null): void {
	if (dossier && image) {
		const url = urlDeRessource(`${dossier}/${image}`);
		document.documentElement.style.setProperty("--nq-fond-image", `url("${url}")`);
	} else {
		document.documentElement.style.removeProperty("--nq-fond-image");
	}
}

/**
 * Lit le réglage, pose l'image — appelée au démarrage et après chaque
 * changement. Sans réglage : le CSS reprend son défaut. Avec : la liste du
 * dossier fait AUTORITÉ sur l'image écrite, jamais l'inverse — une image
 * disparue du disque entre deux lancements ne doit pas faire échouer le
 * démarrage, elle retombe sur la première image du dossier (`suivante`,
 * courante absente).
 */
export async function appliquerFond(): Promise<void> {
	const reglage = validerReglage(await pont().reglages.lire(CLE_REGLAGES_FOND));
	if (!reglage) {
		poserVariable(null, null);
		return;
	}
	const noms = await listerImages(reglage.dossier);
	if (!noms.length) {
		await pont().reglages.supprimer(CLE_REGLAGES_FOND);
		poserVariable(null, null);
		currentHost().ui.notice(t("app.fond.dossierVide"));
		return;
	}
	if (!noms.includes(reglage.image)) {
		const image = suivante(noms, undefined) as string; // `noms` n'est pas vide ici.
		await pont().reglages.ecrire(CLE_REGLAGES_FOND, { dossier: reglage.dossier, image });
		poserVariable(reglage.dossier, image);
		currentHost().ui.notice(t("app.fond.disparue"));
		return;
	}
	poserVariable(reglage.dossier, reglage.image);
}

/** Passe à l'image suivante du dossier courant — barre, menu, `Ctrl+Shift+B`.
    Sans dossier choisi, ne fait rien : il n'y a rien à faire tourner. */
export async function fondSuivant(): Promise<void> {
	const reglage = validerReglage(await pont().reglages.lire(CLE_REGLAGES_FOND));
	if (!reglage) return;
	const noms = await listerImages(reglage.dossier);
	const image = suivante(noms, reglage.image);
	if (image === undefined) return; // le dossier s'est vidé entre-temps.
	await pont().reglages.ecrire(CLE_REGLAGES_FOND, { dossier: reglage.dossier, image });
	await appliquerFond();
}

/** Choisit un nouveau dossier par le sélecteur natif — déjà admis au
    périmètre pour la session (`canaux.ts`). Un dossier sans aucune image
    n'écrit rien : le réglage précédent (s'il y en avait un) reste actif. */
export async function choisirDossierFond(): Promise<void> {
	const dossier = await pont().dialogue.choisirDossier();
	if (dossier === null) return;
	const noms = await listerImages(dossier);
	const image = suivante(noms, undefined);
	if (image === undefined) {
		currentHost().ui.notice(t("app.fond.dossierVide"));
		return;
	}
	await pont().reglages.ecrire(CLE_REGLAGES_FOND, { dossier, image });
	await appliquerFond();
}

/** Efface le réglage : retour au fond embarqué. */
export async function retirerFond(): Promise<void> {
	await pont().reglages.supprimer(CLE_REGLAGES_FOND);
	poserVariable(null, null);
}

/**
 * La section « Fond d'écran » des Réglages : le chemin courant (ou
 * « Aucun dossier »), les trois actions, et la grille de vignettes.
 *
 * Aucun abonnement au pont (contrairement à `mise-a-jour.ts`) : rien ne
 * pousse de changement depuis le principal, chaque action redessine
 * elle-même après avoir écrit. Le démontage n'a donc qu'à empêcher un
 * `redessiner()` en vol d'écrire dans une section retirée du DOM.
 */
export function monterReglagesFond(section: HTMLElement): () => void {
	let detruit = false;

	const chemin = ajouter(section, "p", "nq-reglages-aide");
	const actions = ajouter(section, "div", "nq-reglages-actions");
	const grille = ajouter(section, "div", "nq-fond-grille");

	const boutonChoisir = ajouter(actions, "button", "qbd-btn--create");
	boutonChoisir.type = "button";
	currentHost().ui.setIcon(ajouter(boutonChoisir, "span", "qbd-btn-icon"), "folder-plus");
	ajouter(boutonChoisir, "span", undefined, t("app.fond.choose"));

	const boutonSuivant = ajouter(actions, "button", "qbd-btn--create");
	boutonSuivant.type = "button";
	currentHost().ui.setIcon(ajouter(boutonSuivant, "span", "qbd-btn-icon"), "image");
	ajouter(boutonSuivant, "span", undefined, t("app.fond.next"));

	const boutonRetirer = ajouter(actions, "button", "nq-reglages-retirer");
	boutonRetirer.type = "button";
	boutonRetirer.title = t("app.fond.remove");
	boutonRetirer.setAttribute("aria-label", t("app.fond.remove"));
	currentHost().ui.setIcon(boutonRetirer, "x");

	async function redessiner(): Promise<void> {
		const reglage = validerReglage(await pont().reglages.lire(CLE_REGLAGES_FOND));
		if (detruit) return;
		// Chemin venu du disque : jamais traduit (`textContent` via `ajouter`).
		chemin.textContent = reglage ? reglage.dossier : t("app.fond.none");
		grille.replaceChildren();
		if (!reglage) return;
		const noms = await listerImages(reglage.dossier);
		if (detruit) return;
		for (const nom of noms) {
			const vignette = ajouter(grille, "button", "nq-fond-vignette");
			vignette.type = "button";
			vignette.style.backgroundImage = `url("${urlDeRessource(`${reglage.dossier}/${nom}`)}")`;
			vignette.title = nom;
			if (nom === reglage.image) vignette.dataset.active = "";
			vignette.addEventListener("click", () => {
				void (async () => {
					await pont().reglages.ecrire(CLE_REGLAGES_FOND, { dossier: reglage.dossier, image: nom });
					await appliquerFond();
					await redessiner();
				})();
			});
		}
	}

	boutonChoisir.addEventListener("click", () => { void choisirDossierFond().then(redessiner); });
	boutonSuivant.addEventListener("click", () => { void fondSuivant().then(redessiner); });
	boutonRetirer.addEventListener("click", () => { void retirerFond().then(redessiner); });

	void redessiner();

	return () => { detruit = true; };
}
