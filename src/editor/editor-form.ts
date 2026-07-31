import { t } from "../i18n";
import type { EditorCtx } from "../types/editor-ctx";
import type { DraftQuestion } from "./utils";

/** API vault utilisée par l'éditeur : getConfig (non public) + writeBinary (accepte aussi une vue typée). */
type EditorVault = {
	getConfig(key: string): string | null;
	adapter: {
		writeBinary(path: string, data: ArrayBuffer | ArrayBufferView): Promise<void>;
		exists(path: string): Promise<boolean>;
	};
};

/** Handlers du formulaire d'édition d'une question (champs, ressource, éditeurs par type, éditeur de tableau). */
export interface EditorFormHandlers {
	renderEditor(): void;
	_field(parent: HTMLElement, label: string, value: string | undefined, placeholder: string, multiline: boolean, onChange: (value: string) => void, opts?: Record<string, unknown>): HTMLElement;
	_resourceSection(parent: HTMLElement, q: DraftQuestion): void;
	_renderTypeFields(box: HTMLElement, q: DraftQuestion): void;
	_arrayEditor(parent: HTMLElement, label: string, items: string[], onChange: () => void, placeholder: string, addLabel: string): void;
}

/**
 * Nom LIBRE pour une image collée, dans le dossier de pièces jointes du vault.
 *
 * L'horodatage seul ne distingue qu'à la SECONDE : coller deux captures coup
 * sur coup écrivait deux fois le même chemin, et la seconde image écrasait la
 * première — sans un mot (revue codex 2026-07-31). On demande donc au disque
 * si le nom est libre, et on suffixe tant qu'il ne l'est pas.
 */
async function nomImageLibre(vault: EditorVault, ext: string): Promise<{ fileName: string; filePath: string }> {
	const now = new Date();
	const ts = now.getFullYear().toString() +
		String(now.getMonth() + 1).padStart(2, "0") +
		String(now.getDate()).padStart(2, "0") +
		String(now.getHours()).padStart(2, "0") +
		String(now.getMinutes()).padStart(2, "0") +
		String(now.getSeconds()).padStart(2, "0");
	const dossier = vault.getConfig("attachmentFolderPath") || "";
	const chemin = (nom: string): string => dossier ? dossier + "/" + nom : nom;
	let fileName = `Pasted image ${ts}.${ext}`;
	for (let n = 2; await vault.adapter.exists(chemin(fileName)); n++) {
		fileName = `Pasted image ${ts}-${n}.${ext}`;
	}
	return { fileName, filePath: chemin(fileName) };
}

export function createEditorFormHandlers(ctx: EditorCtx): EditorFormHandlers {
	const { Q_TYPES, _setIcon, _iconSpan, md2html } = ctx;
	const view = ctx.view;

	// Helper pour marquer comme modifié et planifier la sauvegarde
	function onEdit(): void {
		view.renderCode();
		view.schedulePreview();
		view.scheduleSave?.();
	}

	function renderEditor(): void {
		const q = ctx.questions[ctx.activeIdx];
		if (!q) return;
		const ti = Q_TYPES.find(t => t.key === q._type) || Q_TYPES[0];
		const wrap = view.editorInnerEl;
		wrap.empty();

		const badge = wrap.createDiv({ cls: "qb-type-badge" });
		const badgeIcon = badge.createDiv({ cls: "qb-type-icon" }); _setIcon(badgeIcon, ti.lucide);
		const badgeText = badge.createDiv();
		badgeText.createDiv({ cls: "qb-type-label", text: ti.label });
		badgeText.createDiv({ cls: "qb-type-desc", text: ti.desc });

		// Section Énoncé (toujours déployée par défaut)
		const promptSection = wrap.createEl("details", { cls: "qb-section-collapsible", attr: { open: "" } });
		const promptSummary = promptSection.createEl("summary", { cls: "qb-section-header" });
		ctx._setIcon(promptSummary, "file-question");
		promptSummary.createSpan({ text: t("editor.form.promptSection") });
		const promptContent = promptSection.createDiv({ cls: "qb-section-content" });

		_field(promptContent, "", (q._promptHtml || '').replace(/<br\s*\/?>/gi, '\n'), t("editor.form.promptPlaceholder"), true, v => {
			q._promptHtml = v; // Garde les \n tels quels
			onEdit();
		});

		_passageSection(wrap, q);

		_resourceSection(wrap, q);

		const box = wrap.createDiv({ cls: "qb-section-box" });
		_renderTypeFields(box, q);

		// Section Indice (optionnelle)
		const hintSection = wrap.createEl("details", { cls: "qb-section-collapsible" });
		const hintSummary = hintSection.createEl("summary", { cls: "qb-section-header" });
		ctx._setIcon(hintSummary, "lightbulb");
		hintSummary.createSpan({ text: t("editor.hint.label") });
		const hintContent = hintSection.createDiv({ cls: "qb-section-content" });

		_field(hintContent, "", (q.hint || '').replace(/<br\s*\/?>/gi, '\n'), t("editor.hint.placeholder"), true, v => {
			q.hint = v; // Garde les \n tels quels
			onEdit();
		});

		// Section Explication (optionnelle)
		const explainSection = wrap.createEl("details", { cls: "qb-section-collapsible" });
		const explainSummary = explainSection.createEl("summary", { cls: "qb-section-header" });
		ctx._setIcon(explainSummary, "book-open");
		explainSummary.createSpan({ text: t("editor.form.explainSection") });
		const explainContent = explainSection.createDiv({ cls: "qb-section-content" });

		_field(explainContent, "", (q.explain || '').replace(/<br\s*\/?>/gi, '\n'), t("editor.form.explainPlaceholder"), true, v => {
			q.explain = v; // Garde les \n tels quels
			delete q._explainHtml;
			onEdit();
		});
	}

	/* ── Section « Document » (support de compréhension) ──
	   Les trois champs vivent dans `_extraFields` : c'est le canal que l'éditeur
	   utilise déjà pour tout champ hors de son formulaire fixe, et l'export les
	   réémet tels quels (editor/export.ts). Une chaîne vide SUPPRIME la clé
	   plutôt que d'écrire `passage: ''` dans la note — un champ vide n'est pas
	   une donnée. */
	function _passageSection(parent: HTMLElement, q: DraftQuestion): void {
		const extras = (q._extraFields ||= {});
		const read = (key: string): string => {
			const v = extras[key];
			return typeof v === "string" ? v : "";
		};
		const write = (key: string, value: string): void => {
			const v = value.trim();
			if (v) extras[key] = value; else delete extras[key];
			onEdit();
		};

		// Ouverte d'emblée si la question porte déjà un document : on ne cache pas
		// à l'auteur le texte sur lequel porte sa question.
		const hasPassage = !!(read("passage") || read("passageId"));
		const section = parent.createEl("details", {
			cls: "qb-section-collapsible",
			attr: hasPassage ? { open: "" } : {}
		});
		const summary = section.createEl("summary", { cls: "qb-section-header" });
		ctx._setIcon(summary, "book-open-text");
		summary.createSpan({ text: t("editor.passage.section") });
		const content = section.createDiv({ cls: "qb-section-content" });

		content.createDiv({ cls: "qb-field-help", text: t("editor.passage.help") });

		_field(content, t("editor.passage.textLabel"), read("passage"), t("editor.passage.textPlaceholder"), true,
			v => write("passage", v));
		_field(content, t("editor.passage.titleLabel"), read("passageTitle"), t("editor.passage.titlePlaceholder"), false,
			v => write("passageTitle", v));
		_field(content, t("editor.passage.idLabel"), read("passageId"), t("editor.passage.idPlaceholder"), false,
			v => write("passageId", v));
	}

	// ── Entités pour la toolbar ──
	// FONCTION et non constante : la liste était évaluée à la création des
	// handlers (montage de l'éditeur), ce qui aurait figé les infobulles dans la
	// langue d'alors. Appelée depuis _field, donc au rendu. `label` et `insert`
	// sont des symboles/entités HTML — jamais traduits.
	function entities(): { label: string; insert: string; title: string }[] {
		return [
			{ label: '>', insert: '&gt;', title: t("editor.entity.gt") },
			{ label: '<', insert: '&lt;', title: t("editor.entity.lt") },
			{ label: '&', insert: '&amp;', title: t("editor.entity.amp") },
			{ label: '␣', insert: '&nbsp;', title: t("editor.entity.nbsp") },
			{ label: "'", insert: "&#39;", title: t("editor.entity.apos") },
			{ label: '"', insert: "&quot;", title: t("editor.entity.quot") },
			{ label: '```', insert: '<pre><code>\n</code></pre>', title: t("editor.entity.codeBlock") },
		];
	}

	function _insertAt(ta: HTMLTextAreaElement, text: string, cb: (value: string) => void): void {
		const s = ta.selectionStart ?? 0;
		const before = ta.value.substring(0, s);
		const after = ta.value.substring(ta.selectionEnd ?? 0);
		ta.value = before + text + after;
		const nl = text.indexOf('\n');
		ta.selectionStart = ta.selectionEnd = before.length + (nl !== -1 ? nl + 1 : text.length);
		ta.focus();
		cb(ta.value);
	}

	function _autoResize(ta: HTMLTextAreaElement): void {
		ta.style.height = 'auto';
		const minHeight = 100; // Hauteur minimale plus grande pour être plus propre
		const newHeight = Math.max(minHeight, ta.scrollHeight);
		ta.style.height = newHeight + 'px';
	}

	function _field(parent: HTMLElement, label: string, value: string | undefined, placeholder: string, multiline: boolean, onChange: (value: string) => void, opts: Record<string, unknown> = {}): HTMLElement {
		const wrap = parent.createDiv();
		wrap.createEl("label", { cls: "qb-field-label", text: label });
		if (multiline) {
			// Toolbar entités
			const toolbar = wrap.createDiv({ cls: "qb-entity-toolbar" });
			const ta = wrap.createEl("textarea", { cls: "qb-field-textarea qb-prompt-editor", placeholder, text: value ?? "" });

			entities().forEach(ent => {
				const btn = toolbar.createEl("button", { cls: "qb-entity-btn", text: ent.label });
				btn.title = ent.title;
				btn.addEventListener("click", (e) => { e.preventDefault(); _insertAt(ta, ent.insert, onChange); _autoResize(ta); });
			});

			// Input + auto-resize
			ta.addEventListener("input", () => { onChange(ta.value); _autoResize(ta); });
			requestAnimationFrame(() => _autoResize(ta));

			// Raccourci ``` + Enter
			ta.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					const pos = ta.selectionStart ?? 0;
					const lineStart = ta.value.lastIndexOf('\n', pos - 1) + 1;
					if (ta.value.substring(lineStart, pos).trim() === '```') {
						e.preventDefault();
						const before = ta.value.substring(0, lineStart);
						const after = ta.value.substring(pos);
						ta.value = before + '<pre><code>\n</code></pre>' + after;
						ta.selectionStart = ta.selectionEnd = before.length + '<pre><code>\n'.length;
						onChange(ta.value);
						_autoResize(ta);
					}
				}
			});

			// Coller des images - activé pour tous les champs textarea
			ta.addEventListener("paste", async (e) => {
				const items = e.clipboardData?.items;
				if (!items) return;
				for (const item of Array.from(items)) {
					if (item.type.startsWith("image/")) {
						e.preventDefault();
						const file = item.getAsFile();
						if (!file) continue;
						const ext = item.type.split("/")[1] || "png";
						const vault = ctx.plugin.app.vault as unknown as EditorVault;
						const { fileName, filePath } = await nomImageLibre(vault, ext);
						const buffer = await file.arrayBuffer();
						await vault.adapter.writeBinary(filePath, new Uint8Array(buffer));
						_insertAt(ta, `![[${fileName}]]`, onChange);
						_autoResize(ta);
						view.schedulePreview();
						break;
					}
				}
			});
		} else {
			const inp = wrap.createEl("input", { cls: "qb-field-input", placeholder, value: value ?? "" });
			inp.addEventListener("input", () => onChange(inp.value));
		}
		return wrap;
	}

	function _resourceSection(parent: HTMLElement, q: DraftQuestion): void {
		const rb0 = q.resourceButton;
		const has = !!rb0;
		const fileName = rb0 && rb0.fileName ? rb0.fileName : "";
		const summaryText = has && fileName ? t("editor.form.resourceSectionWithFile", { file: fileName }) : t("editor.form.resourceSection");

		const details = parent.createEl("details", { cls: "qb-section-collapsible" + (has ? "" : " qb-section-locked"), attr: has ? { open: "" } : {} });
		const summary = details.createEl("summary", { cls: "qb-section-header" });
		ctx._setIcon(summary, "paperclip");
		const summaryLabel = summary.createSpan({ text: summaryText, cls: "qb-resource-summary-text" });

		// Toggle dans le header pour activer/désactiver
		const toggle = summary.createEl("button", { cls: "qb-resource-toggle-btn", attr: { type: "button", title: t(has ? "editor.toggle.disable" : "editor.toggle.enable") } });
		toggle.createSpan({ cls: "qb-resource-toggle-dot" + (has ? " is-on" : "") });
		toggle.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			// Libellé de DÉPART du bouton ressource : contenu (modifiable puis
			// écrit dans le .md), pas un jeton de format — traduit à la création.
			q.resourceButton = has ? null : { label: t("editor.form.resourceDefaultLabel"), fileName: "" };
			onEdit();
			renderEditor();
		});

		if (!rb0) return;
		const contentDiv = details.createDiv({ cls: "qb-section-content" });
const group = contentDiv.createDiv({ cls: "qb-resource-group" });
const updateSummary = () => {
    const fn = q.resourceButton?.fileName || "";
    summaryLabel.textContent = fn ? t("editor.form.resourceSectionWithFile", { file: fn }) : t("editor.form.resourceSection");
};
_field(group, t("editor.form.resourceLabel"), rb0.label, t("editor.form.resourceLabelPlaceholder"), false, v => { rb0.label = v; onEdit(); updateSummary(); });
_field(group, t("editor.form.resourceFileName"), rb0.fileName, t("editor.form.resourceFilePlaceholder"), false, v => { rb0.fileName = v; onEdit(); updateSummary(); });


		const helpNote = contentDiv.createEl("p", { cls: "qb-resource-help-note" });
		helpNote.createSpan({ text: t("editor.form.resourceHelp") });
	}

	function _renderTypeFields(box: HTMLElement, q: DraftQuestion): void {
		// Renommé `t` → `qType` : le type de question masquait la fonction de
		// traduction t() importée en tête de module.
		const qType = q._type;
		const rerender = () => { onEdit(); };

		if (qType === "single" || qType === "multi") {
			const isMulti = qType === "multi";
			const cardsContainer = box.createDiv({ cls: "qb-answer-cards" });

			const renderCards = () => {
				cardsContainer.empty();

				q.options!.forEach((o, i) => {
					const isCorrect = isMulti ? (q.correctIndices || []).includes(i) : i === q.correctIndex;
					const card = cardsContainer.createDiv({ cls: `qb-answer-card ${isCorrect ? "qb-answer-correct" : "qb-answer-wrong"}` });

					const toggleRow = card.createDiv({ cls: "qb-answer-toggle-row" });
					toggleRow.createSpan({ cls: "qb-answer-toggle-label", text: t(isCorrect ? "editor.answer.correct" : "editor.answer.wrong") });

					const toggle = toggleRow.createDiv({ cls: "qb-answer-toggle" });
					const track = toggle.createDiv({ cls: "qb-answer-toggle-track" });
					const thumb = track.createDiv({ cls: "qb-answer-toggle-thumb" });
					_setIcon(thumb, isCorrect ? "check" : "x");

					const triggerFlash = (toCorrect: boolean) => {
						card.classList.remove("qb-answer-flash-green", "qb-answer-flash-red");
						void card.offsetWidth;
						card.classList.add(toCorrect ? "qb-answer-flash-green" : "qb-answer-flash-red");
						setTimeout(() => {
							card.classList.remove("qb-answer-flash-green", "qb-answer-flash-red");
						}, 500);
					};

					toggle.addEventListener("click", () => {
						if (isMulti) {
							const a = q.correctIndices || [];
							if (a.includes(i)) {
								if (a.length > 1) {
									triggerFlash(false);
									q.correctIndices = a.filter(x => x !== i);
									view.render(); view.scheduleSave?.();
								}
							} else {
								triggerFlash(true);
								q.correctIndices = [...a, i].sort((a, b) => a - b);
								view.render(); view.scheduleSave?.();
							}
						} else {
							if (!isCorrect) {
								triggerFlash(true);
								q.correctIndex = i;
								view.render(); view.scheduleSave?.();
							}
						}
					});

					const input = card.createEl("input", {
						cls: "qb-answer-input",
						type: "text",
						value: o || "",
						placeholder: t("editor.answer.placeholder")
					});

					input.addEventListener("input", () => {
						q.options![i] = input.value;
						rerender();
					});

					input.addEventListener("paste", async (e) => {
						const items = e.clipboardData?.items;
						if (!items) return;

						for (const item of Array.from(items)) {
							if (item.type.startsWith("image/")) {
								e.preventDefault();
								const file = item.getAsFile();
								if (!file) continue;

								try {
									const ext = file.type?.split("/")[1] || "png";
									const vault = ctx.plugin.app.vault as unknown as EditorVault;
									const { fileName, filePath: path } = await nomImageLibre(vault, ext);

									const buf = await file.arrayBuffer();
									await vault.adapter.writeBinary(path, new Uint8Array(buf));

									const before = input.value.slice(0, input.selectionStart ?? 0);
									const after = input.value.slice(input.selectionEnd ?? 0);
									const wikiLink = `![[${fileName}]]`;
									input.value = before + wikiLink + after;
									input.selectionStart = input.selectionEnd = before.length + wikiLink.length;

									q.options![i] = input.value;
									view.schedulePreview();
									view.renderCode();
								} catch (err) {
									console.error("Failed to paste image:", err);
								}
								break;
							}
						}
					});

					if (!isCorrect && q.options!.length > 2) {
						const delBtn = card.createEl("button", { cls: "qb-answer-delete" });
						_setIcon(delBtn, "x");
						delBtn.addEventListener("click", () => {
							q.options!.splice(i, 1);
							if (isMulti) {
								q.correctIndices = (q.correctIndices || []).filter(idx => idx !== i).map(idx => idx > i ? idx - 1 : idx);
							} else {
								if (q.correctIndex === i) q.correctIndex = 0;
								else if ((q.correctIndex ?? 0) > i) q.correctIndex = (q.correctIndex ?? 0) - 1;
							}
							view.render(); view.scheduleSave?.();
						});
					}
				});

				const addBtn = box.createEl("button", { cls: "qb-answer-add" });
				addBtn.appendChild(document.createTextNode(t("editor.answer.add")));
				addBtn.addEventListener("click", () => {
					q.options!.push("");
					if (isMulti && q.options!.length === 1) {
						q.correctIndices = [0];
					}
					view.render(); view.scheduleSave?.();
				});
			};

			renderCards();
		}

		if (qType === "ordering") {
			_arrayEditor(box, t("editor.ordering.possibilities"), q.possibilities!, () => {
				while (q.correctOrder!.length < q.possibilities!.length) q.correctOrder!.push(q.correctOrder!.length);
				q.correctOrder = q.correctOrder!.slice(0, q.possibilities!.length);
				while (q.slots!.length < q.possibilities!.length) q.slots!.push(t("editor.ordering.slotDefault", { n: q.slots!.length + 1 }));
				q.slots = q.slots!.slice(0, q.possibilities!.length);
				rerender();
			}, t("editor.ordering.itemPlaceholder"), t("editor.action.add"));
			_arrayEditor(box, t("editor.ordering.slotLabels"), q.slots!, rerender, t("editor.ordering.slotPlaceholder"), t("editor.action.add"));

			box.createEl("label", { cls: "qb-field-label", text: t("editor.ordering.correctOrder") });
			(q.correctOrder || []).forEach((val, i) => {
				const row = box.createDiv({ cls: "qb-arr-row" });
				row.createSpan({ cls: "qb-arr-idx", text: (q.slots?.[i] || `S${i}`) + " →" });
				const inp = row.createEl("input", { cls: "qb-field-input qb-field-sm", type: "number", value: String(val) });
				inp.min = "0"; inp.max = String(q.possibilities!.length - 1); inp.style.width = "55px";
				inp.addEventListener("input", () => { q.correctOrder![i] = parseInt(inp.value) || 0; rerender(); });
			});
		}

		if (qType === "matching") {
			_arrayEditor(box, t("editor.matching.rows"), q.rows!, () => {
				while (q.correctMap!.length < q.rows!.length) q.correctMap!.push(0);
				q.correctMap = q.correctMap!.slice(0, q.rows!.length);
				rerender();
			}, t("editor.matching.rowPlaceholder"), t("editor.action.add"));
			_arrayEditor(box, t("editor.matching.choices"), q.choices!, () => {
				q.correctMap = q.correctMap!.map(v => Math.min(v, q.choices!.length - 1));
				rerender();
			}, t("editor.matching.choicePlaceholder"), t("editor.action.add"));

			box.createEl("label", { cls: "qb-field-label", text: t("editor.matching.mapping") });
			(q.rows || []).forEach((row, i) => {
				const r = box.createDiv({ cls: "qb-match-row" });
				r.createSpan({ cls: "qb-match-label", text: row || t("editor.matching.rowFallback", { n: i }) });
				_iconSpan(r, "arrow-right", "qb-match-arrow");
				const sel = r.createEl("select", { cls: "qb-field-select" });
				(q.choices || []).forEach((c, ci) => {
					const opt = sel.createEl("option", { text: c || "...", value: String(ci) });
					if ((q.correctMap?.[i] ?? 0) === ci) opt.selected = true;
				});
				sel.addEventListener("change", () => { q.correctMap![i] = parseInt(sel.value) || 0; rerender(); });
			});
		}

		if (qType === "cloze") {
			// Le gabarit EST la question : un seul champ, multiligne, avec la
			// syntaxe rappelée au-dessus — personne ne devine les doubles accolades.
			box.createDiv({ cls: "qb-field-help", text: t("editor.cloze.help") });
			_field(box, t("editor.cloze.templateLabel"), q.cloze, t("editor.cloze.templatePlaceholder"), true,
				v => { q.cloze = v; rerender(); });

			// Compte des trous : la seule vérification qui compte, et elle dit
			// aussi si la syntaxe a été comprise (0 trou = accolades ratées).
			const blanks = (String(q.cloze || "").match(/\{\{[^{}]*\}\}/g) || []).length;
			box.createDiv({
				cls: "qb-field-help" + (blanks === 0 ? " qb-field-help--warn" : ""),
				text: t(blanks === 0 ? "editor.cloze.noBlank" : "editor.cloze.blankCount", { n: blanks })
			});

			const czWrap = box.createDiv({ cls: "qb-toggle-wrap" });
			const czTrack = czWrap.createDiv({ cls: `qb-toggle-track ${q.caseSensitive ? "on" : ""}` });
			czTrack.createDiv({ cls: "qb-toggle-thumb" });
			czWrap.appendChild(document.createTextNode(t("editor.text.caseSensitive")));
			czWrap.addEventListener("click", () => { q.caseSensitive = !q.caseSensitive; view.render(); view.scheduleSave?.(); });
		}

		if (qType === "numeric") {
			box.createDiv({ cls: "qb-field-help", text: t("editor.numeric.help") });
			_arrayEditor(box, t("editor.numeric.answers"), q.acceptedAnswers!, rerender, t("editor.numeric.answerPlaceholder"), t("editor.action.add"));
			_field(box, t("editor.numeric.unit"), q.unit, t("editor.numeric.unitPlaceholder"), false,
				v => { q.unit = v; rerender(); });
			/* Les deux marges s'EXCLUENT : renseigner l'une efface l'autre.
			   Les cumuler n'aurait pas de sens (numeric.ts applique l'absolue en
			   priorité), et laisser l'ancienne valeur en place ferait mentir
			   l'écran sur ce qui est réellement toléré. */
			_field(box, t("editor.numeric.tolerance"), q.tolerance != null ? String(q.tolerance) : "", "0.05", false, v => {
				const n = Number(v.replace(",", "."));
				q.tolerance = v.trim() && Number.isFinite(n) ? n : undefined;
				if (q.tolerance != null) q.tolerancePercent = undefined;
				rerender();
			});
			_field(box, t("editor.numeric.tolerancePercent"), q.tolerancePercent != null ? String(q.tolerancePercent) : "", "2", false, v => {
				const n = Number(v.replace(",", "."));
				q.tolerancePercent = v.trim() && Number.isFinite(n) ? n : undefined;
				if (q.tolerancePercent != null) q.tolerance = undefined;
				rerender();
			});
			_field(box, t("editor.text.placeholderLabel"), q.placeholder, t("editor.text.placeholderHint"), false,
				v => { q.placeholder = v; rerender(); });
		}

		if (["text", "cmd", "powershell", "bash"].includes(qType)) {
			// "C:\>" / "PS>" : invites de commandes réelles, pas de l'UI.
			if (qType === "cmd" || qType === "powershell")
				_field(box, t("editor.text.commandPrefix"), q.commandPrefix, qType === "cmd" ? "C:\\>" : "PS>", false, v => { q.commandPrefix = v; rerender(); });
			_field(box, t("editor.text.placeholderLabel"), q.placeholder, t("editor.text.placeholderHint"), false, v => { q.placeholder = v; rerender(); });
			_arrayEditor(box, t("editor.text.acceptedAnswers"), q.acceptedAnswers!, rerender, t("editor.text.answerPlaceholder"), t("editor.action.add"));
			const toggleWrap = box.createDiv({ cls: "qb-toggle-wrap" });
			const track = toggleWrap.createDiv({ cls: `qb-toggle-track ${q.caseSensitive ? "on" : ""}` });
			track.createDiv({ cls: "qb-toggle-thumb" });
			toggleWrap.appendChild(document.createTextNode(t("editor.text.caseSensitive")));
			toggleWrap.addEventListener("click", () => { q.caseSensitive = !q.caseSensitive; view.render(); view.scheduleSave?.(); });
		}
	}

	function _arrayEditor(parent: HTMLElement, label: string, items: string[], onChange: () => void, placeholder: string, addLabel: string): void {
		parent.createEl("label", { cls: "qb-field-label", text: label });
		const container = parent.createDiv();
		const renderItems = () => {
			container.empty();
			items.forEach((item, i) => {
				const row = container.createDiv({ cls: "qb-arr-row" });
				const inp = row.createEl("input", { cls: "qb-field-input", placeholder: `${placeholder} ${i + 1}`, value: item ?? "" });
				inp.addEventListener("input", () => { items[i] = inp.value; onChange(); });
				const del = row.createEl("button", { cls: "qb-btn-icon qb-btn-sm qb-btn-danger" }); _setIcon(del, "x");
				if (items.length <= 1) del.disabled = true;
				del.addEventListener("click", () => { if (items.length <= 1) return; items.splice(i, 1); onChange(); renderItems(); });
			});
			const addBtn = container.createEl("button", { cls: "qb-arr-add" });
			_iconSpan(addBtn, "plus", "qb-arr-add-icon");
			addBtn.appendChild(document.createTextNode(addLabel));
			addBtn.addEventListener("click", () => { items.push(""); onChange(); renderItems(); });
		};
		renderItems();
	}

	return {
		renderEditor,
		_field,
		_resourceSection,
		_renderTypeFields,
		_arrayEditor
	};
}
