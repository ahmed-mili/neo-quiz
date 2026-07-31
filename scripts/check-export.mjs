/**
 * Non-régression de l'ÉCRITURE d'un bloc quiz-blocks.
 *
 * `exportAll()` est le seul chemin par lequel le plugin réécrit une note. Un
 * bloc qu'il produirait mal ne se relit plus : la sauvegarde est alors refusée
 * en silence (garde de detail-io.ts) et le travail de l'utilisateur reste en
 * mémoire jusqu'à ce qu'il ferme Obsidian. Deux défauts de ce genre ont déjà
 * existé — un objet imbriqué sorti en `[object Object]`, et deux questions de
 * même titre recevant le même identifiant.
 *
 *     npm run check:export
 */
import JSON5 from "json5";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

const question = (over) => ({
	_type: "single", _id: "x", title: "Titre", prompt: "Énoncé",
	options: ["a", "b"], correctIndex: 0, hint: "", explain: "",
	resourceButton: null, _useHtmlPrompt: false, ...over,
});

await withSrcModule("src/editor/export.ts", ({ exportAll }) => {
	const r = makeReporter("Export");

	/** Le bloc se relit-il, et que vaut la clé demandée ? */
	const relire = (questions, lire) => {
		const source = exportAll(questions, null);
		try {
			return lire(JSON5.parse(source));
		} catch (e) {
			return "JSON5 INVALIDE : " + e.message + "\n" + source;
		}
	};

	// Champs personnalisés : ils viennent d'un bloc écrit à la main et doivent
	// ressortir tels quels, quelle que soit leur forme.
	const extra = (valeur) => relire([question({ _extraFields: { v: valeur } })], p => p[0].v);
	r.check("objet imbriqué", extra({ a: 1, b: "deux" }), { a: 1, b: "deux" });
	r.check("tableau d'objets", extra([{ x: 1 }, { x: 2 }]), [{ x: 1 }, { x: 2 }]);
	r.check("null", extra(null), null);
	r.check("tableau de chaînes", extra(["un", "deux"]), ["un", "deux"]);
	r.check("apostrophes", extra("l'été c'est l'été"), "l'été c'est l'été");
	r.check("saut de ligne", extra("ligne1\nligne2"), "ligne1\nligne2");
	r.check("unicode", extra("α β 甲 → ✓"), "α β 甲 → ✓");
	r.check("antislash", extra("C:\\Users\\a"), "C:\\Users\\a");
	r.check("nombre", extra(42), 42);
	r.check("booléen", extra(true), true);
	// JSON5 accepte NaN et Infinity ; `JSON.stringify` les rendait `null`, ce
	// qui changeait la valeur en silence à la première sauvegarde.
	r.check("NaN imbriqué", Number.isNaN(extra({ x: NaN }).x), true);
	r.check("Infinity imbriqué", extra({ x: Infinity }).x, Infinity);
	r.check("objet profond", extra({ a: { b: { c: [1, "deux", null] } } }), { a: { b: { c: [1, "deux", null] } } });
	r.check("clé à apostrophe", extra({ "l'a": 1 }), { "l'a": 1 });

	// Identifiants : ancre HTML de la question et clé des résultats sauvegardés.
	const ids = (questions) => relire(questions, p => p.map(q => q.id));
	r.check("titres identiques → ids distincts",
		ids([question({ title: "Même titre" }), question({ title: "Même titre" })]),
		["m-me-titre", "m-me-titre-2"]);
	r.check("titre non latin → repli sur qN",
		ids([question({ title: "你好" })]), ["q1"]);
	r.check("titre de ponctuation → repli sur qN",
		ids([question({ title: "---" })]), ["q1"]);
	r.check("id d'origine préservé",
		ids([question({ title: "Autre titre", _sourceId: "nr-single" })]), ["nr-single"]);
	// Un identifiant EXPLICITE occupe sa place : le slug d'une question sans id
	// ne doit pas tomber dessus (deux ancres HTML identiques dans la page).
	r.check("slug généré n'écrase pas un id explicite",
		ids([question({ title: "X", _sourceId: "meme-titre" }), question({ title: "Même titre" })]),
		["meme-titre", "m-me-titre"]);
	r.check("deux ids explicites identiques restent distincts",
		ids([question({ _sourceId: "dup" }), question({ title: "dup" })]),
		["dup", "dup-2"]);

	// Le mode du bloc est réémis sous sa forme d'origine.
	const mode = (examOptions) => {
		const parsed = JSON5.parse(exportAll([question({})], examOptions));
		return parsed[parsed.length - 1];
	};
	r.check("mode learn conservé",
		mode({ mode: "learn", enabled: false, durationMinutes: 10, autoSubmit: true, showTimer: true }),
		{ mode: "learn" });
	r.check("mode examen avec chrono",
		mode({ mode: "exam", enabled: true, durationMinutes: 20, autoSubmit: true, showTimer: false }),
		{ examMode: true, examDurationMinutes: 20, examAutoSubmit: true, examShowTimer: false });

	r.done();
});
