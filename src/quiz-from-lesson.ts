/**
 * Génération de la note Quiz depuis une note Lesson ouverte (task 9 du lot
 * mode leçon, 2026-08-31). Fonctions PURES, vérifiables sans Obsidian
 * (`scripts/check-lesson.mjs`) : le nom de la note à créer, le contenu du
 * bloc de référence qu'elle porte, et la détection « cette note est une
 * Lesson ». La partie BRANCHÉE (lecture de l'éditeur actif, écriture ou
 * ouverture du fichier) reste dans `plugin.ts`, réduite au strict enregistrement
 * de la commande (règle du brief).
 */
import { QUIZ_BLOCK_RE, parseQuizSource, findQuizModeConfigIndex, normalizeQuizMode } from "./quiz-utils";

/* Tiret cadratin ET tiret simple acceptés (FIX round 1 de revue, finding 5) :
   une Lesson écrite à la main porte volontiers un tiret ordinaire (`- Lesson`)
   plutôt que le cadratin `—` du design doc. Sans ça, `Chapitre 1 - Lesson`
   devenait `Chapitre 1 - Lesson — Quiz` au lieu de `Chapitre 1 - Quiz`. */
const LESSON_SUFFIXES = [" — Lesson", " - Lesson"];
const QUIZ_SUFFIX = " — Quiz";

/**
 * Nom (sans extension) de la note Quiz à créer à partir du nom de la note
 * Lesson (sans extension). `Chapitre 1 — Lesson` (ou `- Lesson`) devient
 * `Chapitre 1 — Quiz` ; un nom qui ne porte pas ce suffixe (la Lesson peut
 * s'appeler n'importe quoi, brief point 6) reçoit simplement le suffixe en
 * plus — le résultat reste prévisible et lisible dans les deux cas. Aucun
 * caractère interdit par le système de fichiers n'est introduit : seul le
 * suffixe change, et il n'en contient pas.
 */
export function deriveQuizNoteName(lessonBaseName: string): string {
	for (const suffix of LESSON_SUFFIXES) {
		if (lessonBaseName.endsWith(suffix)) {
			return lessonBaseName.slice(0, -suffix.length) + QUIZ_SUFFIX;
		}
	}
	return lessonBaseName + QUIZ_SUFFIX;
}

/**
 * Contenu complet de la note Quiz : un unique bloc `quiz-blocks` référençant
 * la Lesson par un lien wikilink, résolu par `resolveQuizSourceRef` comme
 * n'importe quel lien Obsidian. `mode` et `source` sont des clés de DONNÉES
 * persistées dans le bloc — jamais traduites (règle du projet), relisibles
 * telles quelles par `parseQuizSource`/`extractExamOptions`.
 *
 * FIX round 1 de revue (finding 1, Critical) : le nom de la Lesson est
 * interpolé BRUT. `JSON.stringify` échappe guillemets, contre-obliques et
 * caractères de contrôle — un nom légal sur macOS/Linux/Android (guillemet,
 * contre-oblique) écrivait un JSON5 INVALIDE, une note quiz créée sans erreur
 * mais illisible à l'ouverture. `JSON.stringify` produit du JSON strict, un
 * sous-ensemble valide de JSON5, donc toujours accepté par `parseQuizSource`.
 * Les crochets `[` `]` d'un nom comme `Chapitre [1]` restent, eux, des
 * caractères ORDINAIRES à l'intérieur d'une chaîne JSON — ils ne cassent ni
 * le JSON5 ni la résolution : `toLinkpath` (quiz-source-ref.ts) ne retire que
 * les DEUX premiers et DEUX derniers caractères de la chaîne complète (regex
 * ancrées `^\[\[` / `\]\]$`), jamais par une recherche non ancrée dans un
 * texte plus large — un `[` ou `]` interne traverse donc intact jusqu'au nom
 * de fichier réel. Aucun mécanisme d'échappement n'existe côté wikilink
 * Obsidian pour ces caractères (limite connue du format, pas de ce plugin) ;
 * la seule garantie qu'on puisse et doive tenir est JSON5 valide + résolution
 * correcte, couvertes toutes deux par les cas de `check-lesson.mjs`.
 */
export function buildQuizRefBlockContent(lessonBaseName: string): string {
	const wikilink = `[[${lessonBaseName}]]`;
	return "```quiz-blocks\n" + `[{ mode: "quiz", source: ${JSON.stringify(wikilink)} }]` + "\n```\n";
}

/**
 * Le premier bloc quiz-blocks de `content` est-il en `mode: "lesson"` ?
 * Sert à n'afficher la commande que si elle a un sens (brief point 4).
 * Lecture du contenu de l'ÉDITEUR actif, pas du disque : `checkCallback`
 * d'Obsidian est synchrone, alors que `vault.cachedRead` ne l'est pas — on
 * évite ainsi de rendre la commande indisponible pendant une lecture, ou de
 * juger un contenu déjà périmé par une frappe non sauvegardée.
 *
 * FIX round 1 de revue (finding 4, Important) : Obsidian évalue les
 * `checkCallback` de TOUTE la palette à chaque frappe dans la palette de
 * commandes, potentiellement des dizaines de fois par seconde. Reparser tout
 * le JSON5 d'une leçon longue à chaque évaluation est un coût qui grandit
 * avec la note et se répète sans nécessité : le résultat ne peut changer que
 * si le CONTENU a changé. Mémoïsation triviale sur le contenu exact (une
 * leçon ouverte ne change pas à chaque frappe dans la palette, seulement à
 * chaque frappe dans l'ÉDITEUR) : un cache d'un seul slot suffit, il n'y a
 * qu'une note active à la fois.
 */
const PREFIXE_MEMO_LONGUEUR = 200;
let dernierLongueur = -1;
let dernierPrefixe = "";
let dernierResultat = false;

export function isLessonNoteContent(content: string): boolean {
	const longueur = content.length;
	const prefixe = content.slice(0, PREFIXE_MEMO_LONGUEUR);
	// Comparaison BORNEE (longueur + prefixe court), jamais la note entiere :
	// une lecon longue ne doit pas payer un === sur des dizaines de milliers
	// de caracteres a chaque frappe dans la palette de commandes. Un faux
	// positif (deux contenus distincts partageant longueur + 200 premiers
	// caracteres, le bloc quiz-blocks etant plus loin dans la note) ne coute
	// qu un etat de visibilite obsolete d une frappe, jamais une creation
	// erronee : la commande relit la note active au moment de s executer,
	// pas ce cache.
	if (longueur === dernierLongueur && prefixe === dernierPrefixe) return dernierResultat;

	dernierLongueur = longueur;
	dernierPrefixe = prefixe;
	dernierResultat = calculerIsLessonNoteContent(content);
	return dernierResultat;
}

function calculerIsLessonNoteContent(content: string): boolean {
	const match = QUIZ_BLOCK_RE.exec(content);
	if (!match) return false;
	let parsed: unknown[];
	try {
		parsed = parseQuizSource(match[1]);
	} catch {
		return false;
	}
	const idx = findQuizModeConfigIndex(parsed);
	if (idx < 0) return false;
	const config = parsed[idx] as { mode?: unknown };
	return normalizeQuizMode(config.mode) === "lesson";
}
