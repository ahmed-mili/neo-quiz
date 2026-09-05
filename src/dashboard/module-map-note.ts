import { currentHost } from "../host/current";
import { parseModuleMap, type ModuleMap } from "./quiz-modules";

/**
 * La table des modules, lue dans la note de correspondance.
 *
 * Écrite deux fois à l'identique (accueil et « Mes quiz ») avant ce
 * fichier, et le commentaire d'origine dit pourquoi les deux pages doivent
 * lire la MÊME chose : un quiz rangé dans un sous-dossier de son module
 * recevait sinon l'accent du sous-dossier sur une page et celui du module
 * sur l'autre — deux couleurs pour un même quiz.
 *
 * Passe par l'HÔTE, plus par `app.metadataCache` : `links.resolve` comprend
 * « Dashboard » écrit sans chemin, exactement comme le faisait
 * `getFirstLinkpathDest`, et `fs.readCached` sert le cache du coffre sous
 * Obsidian comme `cachedRead` le faisait.
 *
 * Une table VIDE est un état normal — la note n'existe pas, ou le réglage
 * est vide. Les modules retombent alors sur leur dossier parent
 * (`moduleForQuiz`), ce qui est le comportement historique.
 */
export const MODULE_MAP_VIDE: ModuleMap = { byFolder: new Map(), ueOrder: [] };

export async function lireModuleMap(nomNote: string): Promise<ModuleMap> {
	const nom = String(nomNote ?? "").trim();
	if (!nom) return MODULE_MAP_VIDE;
	try {
		const fichier = currentHost().links.resolve(nom, "");
		if (!fichier) return MODULE_MAP_VIDE;
		return parseModuleMap(await currentHost().fs.readCached(fichier.path));
	} catch (e) {
		/* Note illisible : on rend une table vide plutôt que d'empêcher le
		   rendu de la page. Les modules retombent sur leur dossier parent. */
		return MODULE_MAP_VIDE;
	}
}
