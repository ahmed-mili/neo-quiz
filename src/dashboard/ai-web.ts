/* ══════════════════════════════════════════════════════════
   LE CANAL WEB — ce qui part à un site et comment il s'ouvre.
   Fonctions PURES : pas d'hôte, pas de DOM. Le câblage (ouvrir, copier,
   attendre) est dans ai.ts et dans le contrat d'hôte.
   Spec : docs/superpowers/specs/2026-09-18-generation-web-design.md
══════════════════════════════════════════════════════════ */

import { PHRASE_FINALE_CLI } from "./ai-client";

/** La plus longue URL qu'on ose passer au navigateur.
    MESURÉE le 2026-09-18 par `npm run report:url-max` : ShellExecute admet
    32644 caractères sur cette machine (le serveur de claude.ai en accepte
    65 555, la ligne de commande Windows est la borne qui compte). Posée
    avec une marge : le navigateur ajoute ses propres arguments devant
    l'URL. Au-delà, le texte part par le presse-papier (`preparerOuverture`). */
export const URL_MAX = 31600;

/** Comment un site s'ouvre avec la question déjà écrite. */
export interface OuvertureWeb {
	/** L'adresse d'une conversation neuve, sans paramètre. */
	nouvelle: string;
	/** Le paramètre qui porte la question (`q` sur claude.ai, mesuré le 2026-09-18). */
	parametre: string;
}

/** Dix caractères de [a-z0-9], tirés au hasard. Le jeton n'a qu'un rôle :
    reconnaître LA réponse attendue dans le presse-papier (le principal ne
    livre que le texte qui le porte). Un jeton neuf par ouverture. */
export function nouveauJeton(): string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const octets = new Uint8Array(10);
	crypto.getRandomValues(octets);
	let s = "";
	for (const o of octets) s += alphabet[o % alphabet.length];
	return s;
}

/* La consigne de FORME, adressée au modèle (anglais). Elle remplace la phrase
   finale du CLI : un site a un bouton Copier sur un bloc de code, pas sur du
   texte brut, et le jeton en première ligne est ce que le principal cherche. */
function consigneDeForme(jeton: string): string {
	return "Reply with ONE code block only, fenced with ```json5, whose FIRST line is exactly the comment `// neo-quiz "
		+ jeton + "` followed by the JSON5 array. No text before or after the block.";
}

/** La phrase du paragraphe « NO TOOLS » qui contredit la consigne de forme du
    canal web : le CLI n'a qu'une sortie possible (le tableau JSON5 nu), un
    site en a une autre (un bloc de code avec le jeton en première ligne). La
    laisser telle quelle donnerait au modèle deux instructions de sortie
    contradictoires dans le même prompt. */
const PHRASE_SORTIE_CLI = "Your ONLY output is the JSON5 array.";
const PHRASE_SORTIE_WEB = "Your ONLY output is the code block described below.";

/** Le texte complet qui part à un site : les deux prompts, la consigne de
    forme à la place de la phrase finale du CLI. */
export function texteWeb(prompts: { systemPrompt: string; userPrompt: string }, jeton: string): string {
	const systeme = prompts.systemPrompt
		.replace(PHRASE_FINALE_CLI, consigneDeForme(jeton))
		.replace(PHRASE_SORTIE_CLI, PHRASE_SORTIE_WEB);
	return systeme + "\n\n" + prompts.userPrompt;
}

export type ResultatOuverture =
	| { mode: "url"; url: string }
	| { mode: "presse-papier"; url: string; texte: string };

/** L'adresse si elle tient dans `urlMax`, sinon l'adresse nue et le texte à
    copier. Le seuil est inclusif : à la borne exacte, l'adresse passe. */
export function preparerOuverture(texte: string, web: OuvertureWeb, urlMax: number): ResultatOuverture {
	const url = web.nouvelle + "?" + web.parametre + "=" + encodeURIComponent(texte);
	if (url.length <= urlMax) return { mode: "url", url };
	return { mode: "presse-papier", url: web.nouvelle, texte };
}
