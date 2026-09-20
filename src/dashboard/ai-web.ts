/* ══════════════════════════════════════════════════════════
   LE CANAL WEB — ce qui part à un site et comment il s'ouvre.
   Fonctions PURES : pas d'hôte, pas de DOM. Le câblage (ouvrir, copier,
   attendre) est dans ai.ts et dans le contrat d'hôte.
   Spec : docs/superpowers/specs/2026-09-18-generation-web-design.md
══════════════════════════════════════════════════════════ */

import { PHRASE_FINALE_CLI } from "./ai-client";

/** Comment un site s'ouvre avec la question déjà écrite. */
export interface OuvertureWeb {
	/** L'adresse d'une conversation neuve, sans paramètre. */
	nouvelle: string;
	/** Le paramètre qui porte la question (`q` sur claude.ai, mesuré le
	    2026-09-18 ; `prompt` sur chatgpt.com, mesuré le 2026-09-19). */
	parametre: string;
	/** La plus longue adresse qu'on ose passer au navigateur POUR CE SITE —
	    au-delà, le texte part par le presse-papier (`preparerOuverture`). Elle
	    est PAR SITE et non globale : les deux serveurs mesurés refusent à des
	    tailles différentes, et une borne unique aurait soit gaspillé l'écart,
	    soit envoyé claude.ai dans le mur de chatgpt.com.

	    claude.ai, MESURÉ le 2026-09-18 : HTTP 200 jusqu'à 65 555 octets de
	    requête, 414 à partir de 66 155 → 63 000 posés, marge pour l'en-tête.

	    chatgpt.com, MESURÉ le 2026-09-19 (dichotomie entre 60 000 et 100 000)
	    puis le 2026-09-20 au byte près : 200 jusqu'à 63 584 octets d'adresse,
	    431 (« Request Header Fields Too Large ») au-delà, et 414 bien plus
	    haut. Le refus porte sur le TOTAL de la requête, vérifié en ajoutant un
	    en-tête de bourrage : retirer de l'adresse exactement ce qu'on ajoute
	    d'en-tête garde le refus. Or ces mesures ont des en-têtes MINIMAUX
	    (~190 octets), là où un navigateur connecté à chatgpt.com porte en plus
	    ses cookies de session — plusieurs kilo-octets. D'où 59 000, une marge
	    plus large que celle de claude.ai : au-dessus de la borne le site rend
	    une page d'erreur, en dessous le presse-papier prend le relais.

	    La ligne de commande de Windows (32 644 caractères, `report:url-max`)
	    N'EST PLUS la borne : l'hôte de l'application ouvre une adresse plus
	    longue par un fichier HTML de redirection (`ouvrirUrlLongue`,
	    `apps/windows/electron/main.ts`) — mesuré sur les cours d'Ahmed le
	    2026-09-19, un seul PDF (36 à 49 K encodés) faisait basculer vers le
	    presse-papier à cause de cette borne-là, pas de celle du serveur. */
	urlMax: number;
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

/** L'adresse si elle tient dans la borne DU SITE (`web.urlMax`), sinon
    l'adresse nue et le texte à copier. Le seuil est inclusif : à la borne
    exacte, l'adresse passe. La borne est lue sur le site et non reçue en
    paramètre : deux appelants ne peuvent pas en choisir deux différentes. */
export function preparerOuverture(texte: string, web: OuvertureWeb): ResultatOuverture {
	const url = web.nouvelle + "?" + web.parametre + "=" + encodeURIComponent(texte);
	if (url.length <= web.urlMax) return { mode: "url", url };
	return { mode: "presse-papier", url: web.nouvelle, texte };
}
