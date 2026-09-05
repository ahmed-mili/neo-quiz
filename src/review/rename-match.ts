/* ══════════════════════════════════════════════════════════
   APPARIER UN RENOMMAGE QUE L'HÔTE N'A PAS SU NOMMER

   `@tauri-apps/plugin-fs` remonte un renommage en deux évènements que rien
   ne relie (`modify: { kind: "rename", mode: "from" | "to" }`). L'hôte
   Windows émet alors `delete` puis `create` — il refuse d'inventer un
   appariement, et il a raison.

   Mais le journal de révision SUIT SES CLÉS PAR RENOMMAGE : sans réponse,
   une note renommée pendant que l'application tourne repart à zéro, et son
   historique reste accroché à un chemin qui n'existe plus.

   La réponse ne vient pas du surveillant, elle vient du CATALOGUE. Le
   scanner connaît les identifiants des questions de chaque note
   (`src/quiz-ids.ts`, la même règle qu'à l'écriture). Quand une note
   disparaît et qu'une autre apparaît avec EXACTEMENT la même suite
   d'identifiants, ce n'est pas une ressemblance : c'est la même note.

   Trois gardes, et sans elles ce serait une devinette :
   1. la signature doit être FORTE — au moins un identifiant qui ne soit pas
      un repli `qN` (attribué par position, donc partagé par tous les quiz
      de même taille sans `id:` explicite) ;
   2. l'appariement doit être UNIQUE des deux côtés ;
   3. les deux moitiés doivent être proches dans le temps.

   Un appariement manqué coûte l'historique d'une note. Un appariement FAUX
   transporte l'historique d'une note vers une autre, et c'est invisible :
   c'est pourquoi les gardes penchent toutes du même côté.
══════════════════════════════════════════════════════════ */

export interface SignatureNote {
	path: string;
	/** Les identifiants des questions, DANS L'ORDRE. */
	ids: string[];
}

/** Un identifiant de repli, attribué par position faute de `id:` et de
    titre exploitable (`src/quiz-ids.ts`). */
const REPLI = /^q\d+$/;

/**
 * Une signature distingue-t-elle vraiment cette note ?
 *
 * Mesuré le 2026-09-02 sur les vaults réels : 771 des 774 questions portent
 * un `id` explicite. Le refus ne concerne donc qu'une poignée de notes.
 */
export function signatureForte(ids: ReadonlyArray<string>): boolean {
	return ids.length > 0 && ids.some(id => !REPLI.test(id));
}

/* `JSON.stringify` et non `ids.join(" ")` : un `id:` explicite vient du JSON5
   écrit à la main par l'utilisateur (`explicitId`, src/quiz-ids.ts), et rien
   n'y interdit un espace. `join(" ")` rendrait alors ["ip", "masque"] (deux
   questions) et ["ip masque"] (une seule question dont l'identifiant CONTIENT
   un espace) IDENTIQUES — deux notes structurellement différentes partageant
   la même signature. La garde d'unicité ne peut rien contre cette collision :
   les deux notes lui apparaissent chacune comme une signature vue une seule
   fois, donc « unique » à ses yeux. Le résultat serait un appariement FAUX —
   le pire des deux défauts, invisible. `JSON.stringify` échappe les guillemets
   et les séparateurs : deux tableaux de chaînes distincts y produisent
   toujours des sérialisations distinctes. */
const cle = (ids: ReadonlyArray<string>): string => JSON.stringify(ids);

export function apparierRenommages(
	disparus: ReadonlyArray<SignatureNote>,
	apparus: ReadonlyArray<SignatureNote>,
): Array<{ from: string; to: string }> {
	const index = new Map<string, SignatureNote[]>();
	for (const d of disparus) {
		if (!signatureForte(d.ids)) continue;
		const k = cle(d.ids);
		const l = index.get(k);
		if (l) l.push(d); else index.set(k, [d]);
	}
	const parApparu = new Map<string, SignatureNote[]>();
	for (const a of apparus) {
		if (!signatureForte(a.ids)) continue;
		const k = cle(a.ids);
		const l = parApparu.get(k);
		if (l) l.push(a); else parApparu.set(k, [a]);
	}

	const out: Array<{ from: string; to: string }> = [];
	for (const [k, listeApparus] of parApparu) {
		const listeDisparus = index.get(k);
		// UNIQUE des deux côtés, sinon on ne sait pas qui va avec qui.
		if (!listeDisparus || listeDisparus.length !== 1 || listeApparus.length !== 1) continue;
		out.push({ from: listeDisparus[0].path, to: listeApparus[0].path });
	}
	// Ordre total : deux exécutions sur les mêmes entrées donnent le même
	// résultat, sans quoi rien de ceci ne serait vérifiable.
	out.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
	return out;
}

interface QuizObserve {
	path: string;
	items: ReadonlyArray<{ id: string }>;
}

export interface RenameDetector {
	/** À brancher sur `scanner.onChange`. */
	observer(quizzes: ReadonlyArray<QuizObserve>): void;
}

/**
 * Le registre temporel. Il garde les notes DISPARUES pendant une courte
 * fenêtre, le temps que leur moitié « create » arrive.
 *
 * `now` est injectée — pas par purisme, mais parce qu'un détecteur qui lit
 * l'horloge n'est pas éprouvable : la fenêtre ne se teste qu'en la faisant
 * avancer.
 */
export function createRenameDetector(deps: {
	onRename(from: string, to: string): void;
	now(): number;
	fenetreMs?: number;
}): RenameDetector {
	const fenetre = deps.fenetreMs ?? 5000;
	let precedent = new Map<string, string[]>();
	let enAttente: Array<{ note: SignatureNote; at: number }> = [];

	return {
		observer(quizzes) {
			const courant = new Map<string, string[]>();
			for (const q of quizzes) courant.set(q.path, q.items.map(i => i.id));
			const maintenant = deps.now();

			const apparus: SignatureNote[] = [];
			for (const [path, ids] of courant) {
				if (!precedent.has(path)) apparus.push({ path, ids });
			}
			for (const [path, ids] of precedent) {
				if (!courant.has(path)) enAttente.push({ note: { path, ids }, at: maintenant });
			}

			// Purge AVANT l'appariement : une disparition d'il y a une heure
			// n'a plus rien à voir avec une création d'aujourd'hui.
			enAttente = enAttente.filter(e => maintenant - e.at <= fenetre);

			if (apparus.length) {
				const paires = apparierRenommages(enAttente.map(e => e.note), apparus);
				for (const p of paires) {
					deps.onRename(p.from, p.to);
					enAttente = enAttente.filter(e => e.note.path !== p.from);
				}
			}
			precedent = courant;
		},
	};
}
