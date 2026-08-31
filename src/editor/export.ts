import { escHtml, esc5, md2html, isRichHtml } from "./utils";
import type { DraftQuestion } from "./utils";
import type { EditorExamOptions } from "../types/editor-ctx";

/**
 * Une valeur quelconque, écrite en JSON5.
 *
 * `JSON.stringify` ne convient pas : il rend `NaN` et `Infinity` — deux
 * littéraux que JSON5 accepte, et qu'un bloc écrit à la main peut contenir —
 * sous la forme `null`. La valeur serait alors silencieusement changée à la
 * première sauvegarde.
 *
 * Les CYCLES sont coupés par un ensemble de visités, pas par une profondeur
 * maximale : un plafond arbitraire tronquait aussi les objets légitimement
 * profonds, ce qui est exactement la perte de données qu'on cherche à éviter.
 */
function json5Value(v: unknown, vus: Set<object> = new Set()): string {
	if (v === null || v === undefined) return "null";
	if (typeof v === "string") return `'${esc5(v)}'`;
	// `-0` AVANT le cas général : `String(-0)` rend « 0 » et perdrait le signe,
	// alors que JSON5 sait l'écrire. Le zéro négatif est rare, mais c'est une
	// valeur que l'auteur a écrite — on ne la change pas dans son dos.
	if (Object.is(v, -0)) return "-0";
	// NaN / Infinity / -Infinity sont des littéraux JSON5 valides.
	if (typeof v === "number" || typeof v === "boolean") return String(v);
	if (typeof v !== "object") return "null";   // fonction, symbole

	// Cycle : la valeur se contient elle-même. Impossible depuis un bloc lu par
	// `parseQuizSource`, mais la pile exploserait si ça arrivait.
	if (vus.has(v)) return "null";
	vus.add(v);
	try {
		// `toJSON` d'abord : c'est ainsi qu'une Date rend sa chaîne ISO, comme
		// le faisait `JSON.stringify`.
		const brut = v as { toJSON?: () => unknown };
		if (typeof brut.toJSON === "function") return json5Value(brut.toJSON(), vus);

		if (Array.isArray(v)) {
			// `map` SAUTE les trous d'un tableau creux et produirait `[1, , 3]`,
			// que JSON5 refuse. Chaque position est écrite, vide ou non.
			const items: string[] = [];
			for (let i = 0; i < v.length; i++) items.push(json5Value(v[i], vus));
			return "[" + items.join(", ") + "]";
		}

		const paires = Object.entries(v as Record<string, unknown>)
			.map(([k, x]) => `${json5Key(k)}: ${json5Value(x, vus)}`);
		return "{" + paires.join(", ") + "}";
	} finally {
		vus.delete(v);
	}
}

/**
 * Nom de propriété en JSON5. Un identifiant reste NU — c'est la forme du
 * reste du bloc, et tout citer rendrait les notes illisibles. Tout le reste
 * est cité : un champ personnalisé nommé `'a-b'` sortait en `a-b:`, que JSON5
 * refuse — et le bloc entier devenait alors non relisible, donc non
 * sauvegardable, en silence (revue codex 2026-07-31).
 */
function json5Key(k: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : `'${esc5(k)}'`;
}

/**
 * Ce texte contient-il du markdown de BLOC — celui que le rendu inline du
 * moteur ne sait pas exprimer ?
 *
 * Titre, liste, citation, bloc de code, ou simplement plusieurs lignes. Le
 * gras, l'italique et le code inline n'en font PAS partie : le moteur les rend
 * depuis le texte brut, et les convertir en HTML à l'écriture ne faisait que
 * figer — et parfois corrompre — la source.
 */
function hasBlockMarkdown(texte: string): boolean {
	return /\n/.test(texte) || /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)/m.test(texte);
}

/**
 * Le texte porte-t-il une balise inline ATTRIBUÉE dont la fermante est présente
 * — `Use <strong data-x="1">bold</strong>` ?
 *
 * Le rendu du texte ne restaure que les balises inline NUES
 * (engine/sanitizer.ts restoreAllowedInlineTags) : l'ouvrante resterait donc
 * échappée et la fermante deviendrait réelle, soit un fragment coupé en deux à
 * l'écran. `md2html` échappe les deux et affiche le littéral tel qu'il est
 * écrit ; c'est donc lui qu'il faut, pour ce cas-là seulement.
 *
 * La FERMANTE est exigée : sans elle, « 3 <x et y> 4 » — de la prose — partait
 * inutilement vers `md2html`, avec le risque de corruption que tout le reste
 * de cette fonction cherche justement à éviter. Mesuré : zéro champ des deux
 * vaults contient une balise attribuée, ce garde-fou ne protège donc que
 * l'avenir — raison de plus pour qu'il ne se déclenche pas à tort.
 */
function contientBaliseAttribuee(texte: string): boolean {
	for (const m of texte.matchAll(/<([a-z][a-z0-9]*)\s[^>]*>/gi)) {
		if (new RegExp("</" + m[1] + "\\s*>", "i").test(texte)) return true;
	}
	return false;
}

function exportQuestion(q: DraftQuestion, idx: number, ids?: IdContext): string {
	const id = questionId(q, idx, ids);
	const e = esc5;
	const L: string[] = [];
	L.push("\t{");
	L.push(`\t\tid: '${e(id)}',`);
	L.push(`\t\ttitle: '${e(q.title || `Question ${idx + 1}`)}',`);
	/* `json5Value` et non deux champs en dur : le bouton de ressource est un
	   objet libre dans la note, et le reconstruire à partir de `label` et
	   `fileName` seuls effaçait tout le reste — les autres champs personnalisés
	   d'une question sont préservés, celui-ci ne faisait pas exception par
	   choix (revue codex 2026-07-31). */
	if (q.resourceButton) L.push(`\t\tresourceButton: ${json5Value(q.resourceButton)},`);
	// Priorité au prompt modifié par l'utilisateur, _promptHtml est fallback
	if (q._useHtmlPrompt && q._promptHtml) {
		// Si l'utilisateur édite en mode HTML, utiliser directement _promptHtml
		L.push(`\t\tpromptHtml: '${e(q._promptHtml)}',`);
		/* …et GARDER le `prompt` texte s'il existait aussi. Le moteur affiche
		   `promptHtml` en priorité (engine/cards.ts renderQuizPromptHtml), mais
		   le texte reste la version lisible de la note, et le taire l'effaçait
		   (revue codex 2026-07-31 — même défaut que pour l'explication).
		   `_promptSource` distingue un `prompt` ÉCRIT dans la note du texte que
		   la lecture a dérivé du HTML : réémettre ce dernier ajouterait un champ
		   que personne n'a écrit. */
		if (q.prompt && q._promptSource) L.push(`\t\tprompt: '${e(q.prompt)}',`);
	} else if (q.prompt) {
		/* Passage en HTML seulement pour le markdown de BLOC — titre, liste,
		   citation, bloc de code, ou plusieurs lignes. L'ancien test suffisait à
		   la présence d'une étoile ou d'un accent grave n'importe où, et
		   `md2html` ne connaît pas la règle de flanc du rendu : sauvegarder une
		   question contenant « 3*4*5 » l'écrivait `3<em>4</em>5` DANS LA NOTE.
		   La donnée était corrompue par une simple correction de faute de frappe
		   (revue codex 2026-07-31).
		   Le markdown INLINE n'a plus besoin d'être converti : depuis que le
		   moteur rend `prompt` lui-même (engine/sanitizer.ts), le laisser en
		   texte est à la fois fidèle et plus lisible dans la note. */
		if (hasBlockMarkdown(q.prompt) || contientBaliseAttribuee(q.prompt)) {
			L.push(`\t\tpromptHtml: '${e(md2html(q.prompt))}',`);
		} else {
			L.push(`\t\tprompt: '${e(q.prompt)}',`);
		}
	} else if (q._promptHtml) {
		L.push(`\t\tpromptHtml: '${e(q._promptHtml)}',`);
	}
	const t = q._type;
	if (t === "single") {
		L.push(`\t\toptions: [\n${(q.options || []).map(o => `\t\t\t'${e(o)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tcorrectIndex: ${q.correctIndex ?? 0},`);
	}
	if (t === "multi") {
		L.push(`\t\toptions: [\n${(q.options || []).map(o => `\t\t\t'${e(o)}',`).join("\n")}\n\t\t],`);
		L.push("\t\tmultiSelect: true,");
		L.push(`\t\tcorrectIndices: [${(q.correctIndices || []).join(", ")}],`);
	}
	if (t === "ordering") {
		L.push("\t\tordering: true,");
		L.push(`\t\tslots: [${(q.slots || []).map(s => `'${e(s)}'`).join(", ")}],`);
		L.push(`\t\tpossibilities: [\n${(q.possibilities || []).map(p => `\t\t\t'${e(p)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tcorrectOrder: [${(q.correctOrder || []).join(", ")}],`);
	}
	if (t === "matching") {
		L.push("\t\tmatching: true,");
		L.push(`\t\trows: [\n${(q.rows || []).map(r => `\t\t\t'${e(r)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tchoices: [\n${(q.choices || []).map(c => `\t\t\t'${e(c)}',`).join("\n")}\n\t\t],`);
		L.push(`\t\tcorrectMap: [${(q.correctMap || []).join(", ")}],`);
	}
	if (t === "cloze") {
		// Le gabarit porte à lui seul l'énoncé ET les réponses : rien d'autre
		// à écrire, et `type` reste absent (le moteur discrimine sur `cloze`).
		L.push(`\t\tcloze: '${e(q.cloze || "")}',`);
		if (q.caseSensitive) L.push("\t\tcaseSensitive: true,");
	}
	if (["numeric", "text", "cmd", "powershell", "bash"].includes(t)) {
		L.push("\t\ttype: 'text',");
		/* La variante telle qu'elle était écrite, si on l'a lue quelque part :
		   le moteur accepte une douzaine d'alias (`command`, `shell`, `zsh`…)
		   que l'éditeur ramène à trois types. Réémettre la forme canonique
		   réécrirait la note sans qu'on l'ait demandé — et les trois formes
		   exactes d'avant en effaçaient purement 22 (revue 2026-07-31). */
		if (q._variantNested) {
			/* Rien : la forme imbriquée (`text.variant`) est réémise telle quelle
			   par `_extraFields`, et une seconde déclaration ferait cohabiter
			   deux variantes pour la même question. */
		} else if (q._variantKey && q._variantValue) {
			L.push(`\t\t${json5Key(q._variantKey)}: '${e(q._variantValue)}',`);
		} else if (t === "cmd") L.push("\t\tterminalVariant: 'cmd',");
		else if (t === "powershell") L.push("\t\ttextVariant: 'powershell',");
		else if (t === "bash") L.push("\t\ttextVariant: 'bash',");
		// L'invite vaut pour TOUTES les variantes de terminal, bash compris
		// (engine/terminal.ts getTerminalPromptPrefix).
		if (q.commandPrefix && (t === "cmd" || t === "powershell" || t === "bash")) {
			L.push(`\t\tcommandPrefix: '${e(q.commandPrefix)}',`);
		}
		if (q.placeholder) L.push(`\t\tplaceholder: '${e(q.placeholder)}',`);
		if (q.caseSensitive) L.push("\t\tcaseSensitive: true,");
		if (t === "numeric") {
			L.push("\t\tnumeric: true,");
			if (q.unit && q.unit.trim()) L.push(`\t\tunit: '${e(q.unit)}',`);
			// Marges mutuellement exclusives (cf. formulaire) : au plus une des
			// deux est définie, jamais les deux.
			if (typeof q.tolerance === "number") L.push(`\t\ttolerance: ${q.tolerance},`);
			if (typeof q.tolerancePercent === "number") L.push(`\t\ttolerancePercent: ${q.tolerancePercent},`);
		}
		/* `filter(Boolean)` jetait la réponse « 0 » — celle d'une question
		   numérique dont le résultat est zéro, et le moteur l'accepte
		   (getTextAcceptedAnswers convertit tout en chaîne). Seules les lignes
		   VIDES du formulaire sont écartées. */
		const reponses = (q.acceptedAnswers || [])
			.filter(a => a != null && String(a) !== "")
			.map(a => `\t\t\t'${e(String(a))}',`);
		L.push(`\t\tacceptedAnswers: [\n${reponses.join("\n")}\n\t\t],`);
	}
	/* Virgule SYSTÉMATIQUE, y compris sur le dernier champ écrit : JSON5
	   autorise la virgule traînante, et la conditionner à « y a-t-il un champ
	   après ? » n'a jamais tenu. `hint` et `explainHtml` se croyaient derniers
	   et s'écrivaient sans virgule — mais `_extraFields` en écrit d'autres
	   ensuite (passage, mathInput, numeric…). Une question portant une
	   explication ET un de ces champs produisait un bloc JSON5 INVALIDE, que le
	   moteur refusait de parser (« invalid character 'p' »). */
	if (q.hint) {
		L.push(`\t\thint: '${e(q.hint)}',`);
	}
	// Priorité à explain modifié par l'utilisateur
	/* Quand les DEUX existent, le moteur affiche `explainHtml` (cards.ts
	   explanationHtml) : l'export doit donc l'écrire, et `explain` en plus. Le
	   taire faisait perdre le HTML riche d'une note qui portait les deux
	   champs — l'export avait la priorité INVERSE du rendu (revue codex
	   2026-07-31). */
	if (q.explain && q._explainHtml && isRichHtml(q._explainHtml)) {
		L.push(`\t\texplainHtml: '${e(q._explainHtml)}',`);
		L.push(`\t\texplain: '${e(q.explain)}',`);
	} else if (q.explain) {
		// Même règle que l'énoncé : le markdown inline reste du TEXTE, que le
		// moteur rend (engine/cards.ts explanationHtml).
		if (hasBlockMarkdown(q.explain)) L.push(`\t\texplainHtml: '${e(md2html(q.explain))}',`);
		else L.push(`\t\texplain: '${e(q.explain)}',`);
	} else if (q._explainHtml) {
		L.push(`\t\texplainHtml: '${e(q._explainHtml)}',`);
	}

	/* Leçon (mode "lesson", renommé depuis "learn" — task 0 du lot mode leçon,
	   2026-08-31) : `convertParsedToInternal` a déjà ramené la question aux
	   deux noms canoniques (`lesson`/`_lessonHtml`) ; les noms hérités ne sont
	   relus ici QUE pour un appelant qui construirait une question sans passer
	   par lui (jeux de cas). Dans tous les cas, seul le nom canonique est
	   RÉÉCRIT — jamais `learn`/`learnHtml`/`_learnHtml`. Les deux champs sont
	   indépendants (pas de isRichHtml comme pour l'explication) : l'ancien
	   passage par `_extraFields` écrivait déjà les deux à la fois quand les
	   deux étaient présents, et cette écriture les préserve pareil. */
	const lessonText = q.lesson || q.learn;
	const lessonHtml = q._lessonHtml || q.learnHtml || q._learnHtml;
	if (lessonText) L.push(`\t\tlesson: '${e(String(lessonText))}',`);
	if (lessonHtml) L.push(`\t\tlessonHtml: '${e(String(lessonHtml))}',`);

	if (q._extraFields && Object.keys(q._extraFields).length > 0) {
		// Track keys already exported to avoid duplicates
		const exportedKeys = new Set([
			'id', 'title', 'prompt', 'promptHtml', 'options', 'correctIndex',
			'multiSelect', 'correctIndices', 'ordering', 'slots', 'possibilities',
			'correctOrder', 'matching', 'rows', 'choices', 'correctMap', 'type',
			'terminalVariant', 'textVariant', 'commandPrefix', 'placeholder',
			'caseSensitive', 'acceptedAnswers', 'hint', 'explainHtml',
			'resourceButton', 'cloze', 'numeric', 'tolerance', 'tolerancePercent', 'unit',
			// Leçon (mode "lesson") : déjà écrits ci-dessus, les noms canoniques
			// ET les alias hérités ne doivent pas être réécrits une seconde fois
			// via `_extraFields`.
			'lesson', 'lessonHtml', 'learn', 'learnHtml', '_learnHtml'
		]);
		for (const [key, val] of Object.entries(q._extraFields)) {
			if (exportedKeys.has(key)) continue; // Skip already exported keys
			/* UNE seule branche, `json5Value`, pour toutes les formes. Les
			   branches d'origine ne savaient écrire que des scalaires et des
			   tableaux de scalaires : un objet imbriqué sortait en
			   `[object Object]` (JSON5 invalide, donc écriture refusée en
			   silence) et un `null` disparaissait purement. Ces clés viennent
			   d'un bloc écrit à la main : on les rend telles qu'on les a lues,
			   quelle que soit leur forme — nom de clé compris. */
			L.push(`\t\t${json5Key(key)}: ${json5Value(val)},`);
		}
	}

	L.push("\t}");
	return L.join("\n");
}

/**
 * Identifiant d'une question dans la note.
 *
 * Celui qui y était ÉCRIT prime : il sert d'ancre HTML à la question
 * (engine/cards.ts) et figure dans les résultats déjà sauvegardés. Le dériver
 * du titre à chaque écriture le faisait changer à la moindre retouche.
 *
 * Pour une question qui n'en avait pas, le titre donne un slug — mais un slug
 * ASCII : un titre en grec, en arabe ou fait de ponctuation le vide
 * entièrement, d'où le repli sur `qN`. Et deux questions de MÊME titre
 * produisaient le même identifiant, donc deux ancres `id` identiques dans la
 * page ; `usedIds` les départage.
 */
/** Identifiants en jeu pour UNE écriture (cf. exportAll). */
interface IdContext {
	/** Tous les `_sourceId` du bloc, y compris ceux à venir. */
	reserves: Set<string>;
	/** Ceux déjà attribués au fil de l'écriture. */
	attribues: Set<string>;
}

function questionId(q: DraftQuestion, idx: number, ctx?: IdContext): string {
	const explicite = q._sourceId;
	const base = explicite
		|| (q.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20)
		|| `q${idx + 1}`;
	if (!ctx) return base;

	/* Un identifiant EXPLICITE a le droit de prendre SA réservation — celle-là
	   seulement. Un slug dérivé, ou un candidat suffixé, n'appartient à
	   personne : il doit éviter aussi les réservations à venir, sinon il prend
	   la place d'une question plus bas. Avec `dup, dup, dup-2`, ignorer cette
	   nuance donnait `dup, dup-2, dup-2-2` — la seule question qui avait un
	   identifiant unique le perdait (revue codex 2026-07-31).
	   Le suffixe, lui, s'applique même à un identifiant explicite : deux
	   questions portant le même (un copier-coller de bloc suffit) auraient la
	   même ancre, et la seconde deviendrait inatteignable. */
	const libre = (id: string): boolean => {
		if (ctx.attribues.has(id)) return false;
		if (explicite && id === base) return true;
		return !ctx.reserves.has(id);
	};

	let id = base;
	let n = 2;
	while (!libre(id)) id = `${base}-${n++}`;
	ctx.attribues.add(id);
	/* L'identifiant RETENU devient celui de la question. Sans ça, un slug
	   dérivé du titre était écrit dans la note mais oublié en mémoire : la
	   retouche suivante du titre le recalculait, et l'ancre HTML comme les
	   résultats déjà sauvegardés pointaient dans le vide (revue codex
	   2026-07-31). Vaut aussi pour un identifiant explicite qu'il a fallu
	   suffixer — c'est bien celui-là, désormais, qui est son ancre. */
	q._sourceId = id;
	return id;
}

function exportAll(questions: DraftQuestion[], examOptions: EditorExamOptions | null = null): string {
	/* Deux questions ne peuvent pas se retrouver avec la même ancre HTML.
	   `reserves` retient les identifiants ÉCRITS dans la note, y compris ceux
	   des questions qui viennent plus bas : un slug dérivé d'un titre ne doit
	   pas prendre la place de l'un d'eux, sinon c'est l'identifiant qu'il
	   fallait préserver qui se retrouve suffixé. */
	const attribution: IdContext = {
		reserves: new Set(questions.map(q => q._sourceId).filter((v): v is string => !!v)),
		attribues: new Set<string>(),
	};
	const parts = questions.map((q, i) => exportQuestion(q, i, attribution));

	/* L'objet de mode est réémis SOUS SA FORME D'ORIGINE. Un quiz importé en
	   mode leçon ressortait en mode examen (ou perdait son mode), parce que
	   l'export ne savait écrire que `examMode: true`. `examOptions.mode` est
	   déjà NORMALISÉ (readModeConfig) : il ne vaut donc jamais "learn", même
	   si le bloc lu portait l'ancien nom. */
	const mode = examOptions?.mode;
	const timing = examOptions
		? `\t\texamDurationMinutes: ${examOptions.durationMinutes},\n\t\texamAutoSubmit: ${examOptions.autoSubmit},\n\t\texamShowTimer: ${examOptions.showTimer},\n`
		: "";
	/* Les clés que le plugin ne comprend pas sont RENDUES, comme sur une
	   question : un bloc écrit à la main perdait sinon ses annotations
	   personnelles à la première sauvegarde. */
	const extra = Object.entries(examOptions?._extra || {})
		.map(([k, v]) => `\t\t${json5Key(k)}: ${json5Value(v)},\n`).join("");
	if (mode === "lesson") {
		// Mode leçon AVEC examen (« Passer l'examen ») ou sans, selon le chrono.
		parts.push(`\t// Mode leçon\n\t{\n\t\tmode: 'lesson',\n${examOptions?.enabled ? timing : ""}${extra}\t}`);
	} else if (examOptions && examOptions.enabled) {
		parts.push(`\t// Options mode examen\n\t{\n\t\texamMode: true,\n${timing}${extra}\t}`);
	} else if (mode === "quiz") {
		/* Le mode `quiz` est le comportement par défaut, mais s'il est ÉCRIT
		   dans la note c'est un choix : le taire faisait disparaître l'objet de
		   configuration entier — et ses clés personnalisées avec. */
		parts.push(`\t// Mode quiz\n\t{\n\t\tmode: 'quiz',\n${extra}\t}`);
	} else if (extra) {
		// Un objet de mode sans mode reconnaissable, mais porteur de contenu.
		parts.push(`\t{\n${extra}\t}`);
	}
	return "[\n" + parts.join(",\n\n") + "\n]";
}
function exportAllWithFence(questions: DraftQuestion[], examOptions: EditorExamOptions | null = null): string {
	return "```quiz-blocks\n" + exportAll(questions, examOptions) + "\n```";
}

export { exportQuestion, exportAll, exportAllWithFence };
