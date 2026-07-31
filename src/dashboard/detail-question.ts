import { setIcon } from "obsidian";
import type { App, Plugin } from "obsidian";
import { t } from "../i18n";
import type { DraftQuestion } from "../editor/utils";
import { renderQuizPreviewCard } from "../editor/question-preview";
import { createFormBridge } from "./detail-form-bridge";
import type { FormBridge } from "./detail-form-bridge";

/* ══════════════════════════════════════════════════════════
   DETAIL QUESTION — panneau principal de la page « quiz »

   Deux états d'UNE même carte (contrat Excalidraw 2026-07-21) :
   - CONSULTATION : le VRAI rendu du quiz (editor/question-preview.ts,
     mêmes classes que le moteur), à son état INITIAL — la bonne réponse
     n'y est jamais distinguée (demande explicite d'Ahmed) ;
   - ÉDITION : énoncé, puis les champs propres au TYPE de la question, puis
     les sections optionnelles (document, ressource, indice, explication).

   Depuis le 2026-07-31 la page édite TOUS les types, pas seulement les
   choix : les formulaires viennent de l'éditeur via `detail-form-bridge`,
   ce qui a permis de retirer l'éditeur en trois colonnes sans rien perdre.
   Le renvoi « ouvrir l'éditeur complet » n'a donc plus lieu d'être.
══════════════════════════════════════════════════════════ */

/* ── Consultation ─────────────────────────────────────────── */

/** Le VRAI rendu du quiz (mêmes classes que le moteur), pas une imitation :
    demande d'Ahmed 2026-07-21 « il faut que ça ressemble au vrai rendu des
    quiz à droite ». Tout passe par editor/question-preview.ts, partagé avec
    l'aperçu de l'éditeur — un seul markup à suivre si le moteur change. */
export function renderQuestionView(parent: HTMLElement, q: DraftQuestion, app: App, index: number, sourcePath?: string): void {
	renderQuizPreviewCard(parent, q, {
		app,
		fallbackTitle: `Question ${index + 1}`,
		// Le chemin de la NOTE, pour que ses `![[…]]` se résolvent comme dans le
		// quiz. Absent pour un quiz encore en mémoire (résultat d'une génération).
		sourcePath,
		// Pas de bouton d'indice ici : l'indice se lit en jouant, la page
		// d'un quiz sert à relire et corriger.
	});
}

/* ── Édition ──────────────────────────────────────────────── */

export interface EditCallbacks {
	app: App;
	plugin: Plugin;
	/** Une donnée a changé : persister (débounce côté appelant) + rafraîchir la liste. */
	onChange(): void;
	/** Un ajout/retrait a changé la STRUCTURE : re-render du panneau. */
	onStructureChange(): void;
}

export function renderQuestionEdit(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks): void {
	const bridge = createFormBridge({
		app: cb.app,
		plugin: cb.plugin,
		onChange: cb.onChange,
		onStructureChange: cb.onStructureChange,
	});

	renderTitleField(parent, q, cb);
	renderPromptField(parent, q, cb, bridge);

	// ── Les champs du TYPE (réponses, emplacements, paires, gabarit…) ──
	// Rendus par le formulaire de l'éditeur : mêmes classes, mêmes règles
	// (jamais moins de deux réponses, au moins une bonne, réindexation à la
	// suppression) que ce que produisait l'éditeur en onglet.
	const typeBox = parent.createDiv({ cls: "qbd-qz-type-box" });
	bridge.renderTypeFields(typeBox, q);

	renderExtras(parent, q, cb, bridge);
}

/* ── Titre et énoncé ──────────────────────────────────────── */

function renderTitleField(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks): void {
	const field = parent.createDiv({ cls: "qbd-qz-field" });
	field.createDiv({ cls: "qbd-qz-field-label", text: t("dashboard.quiz.editTitle") });
	const input = field.createEl("input", { cls: "qbd-qz-field-input qbd-qz-field-input--single", type: "text" });
	input.value = q.title || "";
	input.placeholder = t("dashboard.quiz.editTitlePlaceholder");
	input.addEventListener("input", () => {
		q.title = input.value;
		// Un titre SAISI est un titre d'auteur, même s'il ressemble au motif
		// automatique : sans ce drapeau, le prochain réordonnancement le
		// remplacerait par « Question N ».
		q._userModifiedTitle = true;
		cb.onChange();
	});
}

/** Un champ importé peut porter du HTML que le texte brut ne sait pas
    exprimer — un tableau, mais aussi un simple `<strong>`. Le repérer décide
    lequel des deux champs éditer : sans quoi corriger une faute de frappe
    aplatissait la mise en forme.

    Les enveloppes NEUTRES ne comptent pas : `<p>…</p>` et `<br>` sont ce que
    md2html produit pour du texte ordinaire, et basculer en édition HTML pour
    ça imposerait des balises à qui écrit une phrase. */
function isRichHtml(html: string | undefined): boolean {
	if (!html) return false;
	// Un commentaire HTML est du contenu que le texte brut perdrait.
	if (html.includes("<!--")) return true;
	/* Seule une balise `<p>` NUE est neutre — c'est ce que md2html produit
	   pour du texte ordinaire. Un `<p role="note">` porte de l'information que
	   le sanitizer conserve et affiche ; le traiter comme une enveloppe
	   effaçait ses attributs à la première frappe. Un `<p class="">` vide est
	   alors classé riche : l'erreur va dans le bon sens (on édite le HTML, on
	   ne perd rien). */
	const stripped = html.replace(/<\/?p>|<br\s*\/?>/gi, "");
	return /<[a-z][a-z0-9]*\b[^>]*>/i.test(stripped);
}

function renderPromptField(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks, bridge: FormBridge): void {
	// Champ NU (label + zone de saisie), pas une carte dans une carte — le
	// double cadre gris de la première version faisait lourd. La zone vient
	// du formulaire de l'éditeur : elle apporte la barre d'entités HTML, le
	// raccourci ``` + Entrée et le collage d'image vers le vault — trois
	// capacités que la version maison n'avait pas.
	const rich = isRichHtml(q._promptHtml);
	const field = parent.createDiv({ cls: "qbd-qz-field qbd-qz-field--rich" });
	field.createDiv({
		cls: "qbd-qz-field-label",
		text: t(rich ? "dashboard.quiz.editPromptHtml" : "dashboard.quiz.editPrompt"),
	});

	const value = rich
		? (q._promptHtml || "").replace(/<br\s*\/?>/gi, "\n")
		: (q.prompt || "");

	bridge.field(field, "", value, t("dashboard.quiz.editPromptPlaceholder"), true, (v) => {
		if (rich) {
			// On édite le HTML LUI-MÊME : c'est la seule façon de garder un
			// tableau ou un bloc de code qu'aucun texte brut ne rendrait.
			q._promptHtml = v;
			q._useHtmlPrompt = true;
		} else {
			q.prompt = v;
			// L'énoncé redevient du texte : le HTML pré-rendu d'un import
			// l'écraserait au rendu suivant (et à l'export, cf. export.ts).
			q._useHtmlPrompt = false;
			delete q._promptHtml;
		}
		cb.onChange();
	});

	if (rich) field.createDiv({ cls: "qbd-qz-section-help", text: t("dashboard.quiz.editPromptHtmlHint") });
}

/* ── Sections optionnelles ────────────────────────────────── */

/** Document, ressource, indice, explication : tout ce qui entoure la
    question. Repliées par défaut, sauf celles qui portent déjà une valeur —
    on ne cache pas à l'auteur un contenu qu'il a écrit. */
function renderExtras(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks, bridge: FormBridge): void {
	const extras = (q._extraFields ||= {});
	const readExtra = (key: string): string => {
		const v = extras[key];
		return typeof v === "string" ? v : "";
	};
	const writeExtra = (key: string, value: string): void => {
		// Une chaîne vide SUPPRIME la clé plutôt que d'écrire `passage: ''`
		// dans la note — un champ vide n'est pas une donnée.
		if (value.trim()) extras[key] = value; else delete extras[key];
		cb.onChange();
	};

	// ── Document (support de compréhension) ──
	const hasDoc = !!(readExtra("passage") || readExtra("passageId"));
	const doc = section(parent, "book-open-text", t("editor.passage.section"), hasDoc);
	doc.createDiv({ cls: "qbd-qz-section-help", text: t("editor.passage.help") });
	bridge.field(doc, t("editor.passage.textLabel"), readExtra("passage"), t("editor.passage.textPlaceholder"), true,
		v => writeExtra("passage", v));
	bridge.field(doc, t("editor.passage.titleLabel"), readExtra("passageTitle"), t("editor.passage.titlePlaceholder"), false,
		v => writeExtra("passageTitle", v));
	bridge.field(doc, t("editor.passage.idLabel"), readExtra("passageId"), t("editor.passage.idPlaceholder"), false,
		v => writeExtra("passageId", v));

	// ── Bouton ressource ──
	renderResourceSection(parent, q, cb, bridge);

	// ── Indice ──
	const hint = section(parent, "lightbulb", t("editor.hint.label"), !!q.hint);
	bridge.field(hint, "", (q.hint || "").replace(/<br\s*\/?>/gi, "\n"), t("editor.hint.placeholder"), true, v => {
		q.hint = v;
		cb.onChange();
	});

	// ── Explication (après correction) ──
	// Même règle que l'énoncé : une explication qui porte du HTML s'édite en
	// HTML, sinon la première correction l'aplatirait.
	const richExplain = isRichHtml(q._explainHtml);
	const explain = section(parent, "book-open", t("editor.form.explainSection"), !!(q.explain || q._explainHtml));
	const explainValue = (richExplain ? (q._explainHtml || "") : (q.explain || ""))
		.replace(/<br\s*\/?>/gi, "\n");
	bridge.field(explain, "", explainValue, t("editor.form.explainPlaceholder"), true, v => {
		if (richExplain) {
			// L'export préfère `explain` (texte) à `_explainHtml` : le vider est
			// ce qui donne la main au HTML qu'on édite ici.
			q._explainHtml = v;
			q.explain = "";
		} else {
			q.explain = v;
			// Le HTML pré-rendu d'un import cède la main au texte fraîchement
			// saisi — sinon l'export réémettrait l'ancien (cf. export.ts).
			delete q._explainHtml;
		}
		cb.onChange();
	});
	if (richExplain) explain.createDiv({ cls: "qbd-qz-section-help", text: t("dashboard.quiz.editPromptHtmlHint") });
}

/** Le bouton « ressource » n'existe que s'il est activé : son interrupteur
    vit dans l'en-tête de la section, comme dans l'éditeur. */
function renderResourceSection(parent: HTMLElement, q: DraftQuestion, cb: EditCallbacks, bridge: FormBridge): void {
	const has = !!q.resourceButton;
	const fileName = q.resourceButton?.fileName || "";
	const label = fileName
		? t("editor.form.resourceSectionWithFile", { file: fileName })
		: t("editor.form.resourceSection");
	const box = section(parent, "paperclip", label, has);
	const head = box.previousElementSibling as HTMLElement | null;

	if (head) {
		const toggle = head.createEl("button", {
			cls: "qbd-qz-section-toggle" + (has ? " is-on" : ""),
			attr: { type: "button", "aria-pressed": String(has), title: t(has ? "editor.toggle.disable" : "editor.toggle.enable") },
		});
		toggle.createSpan({ cls: "qbd-qz-section-toggle-dot" });
		toggle.addEventListener("click", (e) => {
			// L'en-tête ouvre/ferme la section : l'interrupteur, lui, active la
			// ressource — sans stopPropagation le clic ferait les deux.
			e.preventDefault();
			e.stopPropagation();
			// Libellé de DÉPART : contenu (modifiable puis écrit dans le .md),
			// pas un jeton de format — traduit à la création.
			q.resourceButton = has ? null : { label: t("editor.form.resourceDefaultLabel"), fileName: "" };
			cb.onChange();
			cb.onStructureChange();
		});
	}

	const rb = q.resourceButton;
	if (!rb) return;
	bridge.field(box, t("editor.form.resourceLabel"), rb.label, t("editor.form.resourceLabelPlaceholder"), false,
		v => { rb.label = v; cb.onChange(); });
	bridge.field(box, t("editor.form.resourceFileName"), rb.fileName, t("editor.form.resourceFilePlaceholder"), false,
		v => { rb.fileName = v; cb.onChange(); });
	box.createDiv({ cls: "qbd-qz-section-help", text: t("editor.form.resourceHelp") });
}

/** Section repliable : en-tête cliquable + corps. Renvoie le CORPS (l'appelant
    y écrit ses champs) ; l'en-tête se retrouve par `previousElementSibling`
    quand il faut y greffer un interrupteur. */
function section(parent: HTMLElement, icon: string, label: string, open: boolean): HTMLElement {
	const wrap = parent.createDiv({ cls: "qbd-qz-section" + (open ? "" : " is-collapsed") });
	const head = wrap.createEl("button", { cls: "qbd-qz-section-head", attr: { type: "button", "aria-expanded": String(open) } });
	// UN seul glyphe, tourné par CSS : deux icônes échangées par setIcon() ne
	// peuvent pas transitionner (cf. obsidian:plugin-dev §6 ter).
	setIcon(head.createSpan({ cls: "qbd-qz-section-chevron" }), "chevron-right");
	setIcon(head.createSpan({ cls: "qbd-qz-section-icon" }), icon);
	head.createSpan({ cls: "qbd-qz-section-label", text: label });

	// Corps TOUJOURS monté, réduit à 0 par la classe : sans lui il n'y aurait
	// rien à révéler à l'ouverture.
	const body = wrap.createDiv({ cls: "qbd-qz-section-body" });
	const inner = body.createDiv({ cls: "qbd-qz-section-inner" });

	head.addEventListener("click", () => {
		const collapsed = wrap.classList.contains("is-collapsed");
		wrap.classList.add("is-animating");
		wrap.classList.toggle("is-collapsed", !collapsed);
		head.setAttribute("aria-expanded", String(collapsed));
		const stop = (): void => wrap.classList.remove("is-animating");
		body.addEventListener("transitionend", function onEnd(e: TransitionEvent) {
			if (e.target !== body || e.propertyName !== "grid-template-rows") return;
			body.removeEventListener("transitionend", onEnd);
			stop();
		});
		// Filet : transitionend ne part jamais en reduced-motion.
		window.setTimeout(stop, 320);
	});

	return inner;
}
