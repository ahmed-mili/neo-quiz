import { setIcon } from "obsidian";
import { t } from "../i18n";
import type { DashboardCtx } from "../types/dashboard-ctx";
import type { QuizIndexEntry } from "./scanner";
import type { QuizStatRecord } from "./stats-store";
import { renderQuizCard as renderSharedQuizCard } from "./quiz-card";
import { isFolderArchived, buildQuizCardMenu } from "./quiz-menu";
import { moduleForQuiz, applyModuleOverrides, parseModuleMap } from "./quiz-modules";
import type { ModuleMap } from "./quiz-modules";
import { moduleAccent } from "./module-color";
import { openQuizForPlay } from "./quiz-open";
import { renderCollapsibleSection } from "./collapsible";
import { markViewEnter } from "./view-enter";

/* ══════════════════════════════════════════════════════════
   HOME VIEW — Dashboard
   Header + stats grid + sections "À reprendre" / "Complétés"
══════════════════════════════════════════════════════════ */

/** Cartes affichées par section : 2 rangées de 3 sur large, ni plus (l'accueil
    n'est pas « Mes quiz »), ni moins (une seule rangée ne relance pas assez). */
const HOME_GRID_MAX = 6;

/** Carte de la grille de stats (statCards ci-dessous). */
interface StatCard {
	label: string;
	value: string;
	sub: string;
	icon: string;
	highlight?: boolean;
}

export interface HomeHandlers {
	/** `entering` = on ARRIVE sur la page (la transition d'entrée se joue).
	    L'hôte le sait : c'est lui qui compare la vue peinte à la vue demandée
	    (dashboard.ts). Un re-render déclenché par le scanner du vault ou par le
	    menu ⋯ d'une carte passe `false` — sinon la page clignote à chaque
	    sauvegarde de note. */
	render(container: HTMLElement, entering?: boolean): void;
}

export function createHomeHandlers(ctx: DashboardCtx): HomeHandlers {

	/* Dernier conteneur peint : le menu ⋯ d'une carte (archivage, reset de
	   stats) doit pouvoir repeindre l'accueil sans repasser par la navigation. */
	let containerRef: HTMLElement | null = null;
	/* Valeur d'`entering` du dernier rendu : quand la table des modules arrive
	   (lecture async) et déclenche un repeint, il doit REJOUER l'entrée si le
	   rendu interrompu en était une — sinon la cascade se coupe net à peine
	   commencée (même piège que quizzes.ts). */
	let lastEntering = true;

	/* Table des modules lue dans la note de correspondance, comme « Mes quiz ».
	   Sans elle, un quiz rangé dans un SOUS-dossier de son module se voyait
	   attribuer l'accent (et le dossier d'archivage) du sous-dossier ici, celui
	   du module là-bas : deux couleurs pour un même quiz selon la page. */
	let moduleMap: ModuleMap | null = null;
	let moduleMapLoaded = false;

	async function loadModuleMap(): Promise<void> {
		moduleMapLoaded = true;
		// Cède TOUJOURS avant de poursuivre : sans ce yield, la branche « note
		// absente » ne traverse aucun await réel et re-rendrait DEPUIS le render()
		// en cours, qui peindrait ensuite une seconde copie par-dessus (piège
		// documenté au long dans quizzes.ts).
		await Promise.resolve();
		try {
			const name = ctx.plugin.settings.quizzesModuleMapNote || "Dashboard";
			const file = ctx.app.metadataCache.getFirstLinkpathDest(name, "");
			moduleMap = file ? parseModuleMap(await ctx.app.vault.cachedRead(file)) : { byFolder: new Map(), ueOrder: [] };
		} catch {
			moduleMap = { byFolder: new Map(), ueOrder: [] };
		}
		if (containerRef) render(containerRef, lastEntering);
	}

	/** Re-render déclenché par la page elle-même (menu ⋯) : jamais d'entrée. */
	function rerender(): void {
		if (containerRef) render(containerRef, false);
	}

	function render(container: HTMLElement, entering = true): void {
		containerRef = container;
		lastEntering = entering;
		markViewEnter(container, entering, "qbd-home-enter");
		container.empty();

		// Cascade d'entrée : UN seul compteur pour toute la page (tuiles de
		// stats, en-têtes de section, cartes) — même formule que « Mes quiz ».
		let entryIndex = 0;
		const entryDelay = (): string => `${100 + entryIndex++ * 45}ms`;

		// Les quiz des DOSSIERS ARCHIVÉS (menu ⋯ d'une carte de dossier de
		// « Mes quiz ») n'existent plus pour l'accueil : ni stats, ni sections.
		// Ils ne reviennent que sous la section « Archivés » de « Mes quiz ».
		// Même table effective que « Mes quiz » : la note (chargée en tâche de
		// fond au premier rendu) recouverte par les overrides du modal
		// « Modifier dossier », relus à chaque rendu.
		if (!moduleMapLoaded) { void loadModuleMap(); }
		const map: ModuleMap = applyModuleOverrides(
			moduleMap ?? { byFolder: new Map(), ueOrder: [] },
			ctx.plugin.settings.quizzesModuleOverrides || {}
		);
		const allQuizzes: QuizIndexEntry[] = ctx.scanner ? ctx.scanner.getQuizzes() : [];
		const quizzes = allQuizzes.filter(q => !isFolderArchived(ctx, moduleForQuiz(q.path, map).folder));
		const stats: Record<string, QuizStatRecord> = ctx.statsStore ? ctx.statsStore.getAll() : {};

		// ── Premier usage : aucun quiz → onboarding guidé ──
		if (allQuizzes.length === 0) {
			renderOnboarding(container);
			return;
		}

		// ── Classement des quiz par état (utilisé par le hero + les sections) ──
		const inProgress = quizzes.filter(q => {
			const s = stats[q.path];
			return s && s.questionsDone > 0 && s.questionsDone < q.questions;
		});
		const notStarted = quizzes.filter(q => {
			const s = stats[q.path];
			return !s || s.questionsDone === 0;
		});
		const completed = quizzes.filter(q => {
			const s = stats[q.path];
			return s && s.questionsDone >= q.questions;
		});

		// ── Header ──
		const header = container.createDiv({ cls: "qbd-home-header" });
		const headerLeft = header.createDiv({ cls: "qbd-home-header-left" });
		headerLeft.createEl("h2", { cls: "qbd-home-title", text: "Quiz Blocks" });

		// Sous-titre orientant : annonce les deux actions principales. (La note
		// active reste dans le footer de la sidebar, et la vue Générer la relit.)
		const subtitle = inProgress.length > 0
			? t("dashboard.home.subtitleResume")
			: t("dashboard.home.subtitleStart");
		headerLeft.createEl("p", { cls: "qbd-home-subtitle", text: subtitle });

		// Pilule claire IDENTIQUE à « + New folder » de « Mes quiz » : une seule
		// grammaire d'action primaire dans le dashboard (contrat 2026-07-28).
		const genBtn = header.createEl("button", { cls: "qbd-btn--create" });
		const genIcon = genBtn.createSpan({ cls: "qbd-btn-icon" });
		setIcon(genIcon, "sparkles");
		genBtn.createSpan({ text: t("dashboard.home.generate") });
		genBtn.addEventListener("click", () => ctx.navigate("ai"));

		// ── Reprendre : dernier quiz en cours (action primaire du returning user) ──
		const resumeQuiz = inProgress
			.slice()
			.sort((a, b) => {
				const la = (stats[a.path] && stats[a.path].lastPlayed) || 0;
				const lb = (stats[b.path] && stats[b.path].lastPlayed) || 0;
				return lb - la;
			})[0];
		if (resumeQuiz) {
			renderResumeHero(container, resumeQuiz, stats[resumeQuiz.path], accentOf(resumeQuiz, map));
		}

		// ── Stats grid ──
		const statsGrid = container.createDiv({ cls: "qbd-home-stats" });

		const totalQuestions = ctx.scanner ? ctx.scanner.getTotalQuestions() : 0;
		const mastered = quizzes.filter(q => {
			const s = stats[q.path];
			return s && s.bestScore >= 80;
		}).length;

		// Construit DANS render : les libellés sont traduits à chaque rendu (une
		// constante de module serait figée dans la langue du démarrage).
		const statCards: StatCard[] = [
			{ label: t("dashboard.home.statQuizzes"), value: String(quizzes.length), sub: t("dashboard.home.statQuizzesSub"), icon: "layers" },
			{ label: t("dashboard.home.statQuestions"), value: String(totalQuestions), sub: t("dashboard.home.statQuestionsSub"), icon: "list" },
			{
				label: t("dashboard.home.statMastered"), value: `${mastered}/${quizzes.length}`, sub: t("dashboard.home.statMasteredSub"),
				icon: "award", highlight: true
			}
		];

		for (const card of statCards) {
			const el = statsGrid.createDiv({ cls: `qbd-stat-card${card.highlight ? " qbd-stat-card--highlight" : ""}` });
			el.style.setProperty("--qbd-card-delay", entryDelay());
			const head = el.createDiv({ cls: "qbd-stat-head" });
			const icon = head.createSpan({ cls: "qbd-stat-icon" });
			setIcon(icon, card.icon);
			head.createEl("p", { cls: "qbd-stat-label", text: card.label });
			el.createEl("p", { cls: "qbd-stat-value", text: card.value });
			// Aucune barre de progression sur une tuile de stats : même règle que
			// les cartes de dossier (contrat visuel « Mes quiz »), le chiffre porte
			// déjà l'information.
			el.createEl("p", { cls: "qbd-stat-sub", text: card.sub });
		}

		// ── Sections de quiz ──
		// Mêmes en-têtes que « Mes quiz » : rangée 52px, chevron animé, libellé
		// 16px, badge compteur, repli persisté (contrat visuel 2026-07-28). Les
		// micro-capitales 10px, propres à l'accueil, ont disparu avec eux.
		const collapse = {
			isExpanded: (key: string) => new Set(ctx.plugin.settings.quizzesExpandedFolders || []).has(key),
			toggleExpanded: (key: string) => {
				const set = new Set(ctx.plugin.settings.quizzesExpandedFolders || []);
				if (set.has(key)) set.delete(key); else set.add(key);
				ctx.plugin.settings.quizzesExpandedFolders = [...set];
				ctx.plugin.saveSettings().catch(() => {});
			},
		};

		// À faire (en cours + à commencer). La grille est PLAFONNÉE (revue design
		// 2026-07-28) : 54 cartes faisaient de l'accueil un doublon de « Mes
		// quiz ». Deux rangées de trois suffisent à reprendre le travail ; le
		// reste vit derrière « See all », qui affiche le total resté dehors.
		/* Une section = en-tête repliable + grille plafonnée + « See all » vers
		   « Mes quiz ». TOUTE section plafonnée porte ce lien : sans lui, les
		   quiz au-delà du 6e n'auraient aucune sortie depuis l'accueil. */
		const renderSection = (key: string, label: string, list: QuizIndexEntry[], defaultOpen: boolean): void => {
			const shown = list.slice(0, HOME_GRID_MAX);
			const section = container.createDiv({ cls: "qbd-home-section" });
			const body = renderCollapsibleSection(collapse, section, key, label, list.length, {
				rowClass: "qbd-home-node-row",
				entryDelay,
				defaultOpen,
				// « See all » vit à CÔTÉ de l'en-tête, jamais dedans : l'en-tête
				// est lui-même un <button> (un bouton dans un bouton est invalide).
				headRow: (row) => {
					const seeAll = row.createEl("button", { cls: "qbd-btn qbd-btn--subtle" });
					seeAll.type = "button";
					seeAll.createSpan({
						text: list.length > shown.length
							? t("dashboard.home.seeAllCount", { count: list.length })
							: t("dashboard.home.seeAll")
					});
					const chevron = seeAll.createSpan({ cls: "qbd-btn-icon qbd-btn-icon--sm" });
					setIcon(chevron, "chevron-right");
					seeAll.addEventListener("click", () => ctx.navigate("quizzes"));
				},
			});

			const grid = body.createDiv({ cls: "qbd-home-grid" });
			for (const quiz of shown) {
				renderQuizCard(grid, quiz, stats[quiz.path], map).style
					.setProperty("--qbd-card-delay", entryDelay());
			}
		};

		// À faire (en cours + à commencer). La grille est PLAFONNÉE (revue design
		// 2026-07-28) : 54 cartes faisaient de l'accueil un doublon de « Mes
		// quiz ». Deux rangées de trois suffisent à reprendre le travail ; le
		// reste vit derrière « See all », qui affiche le total resté dehors.
		const todo = [...inProgress, ...notStarted];
		if (todo.length > 0) {
			renderSection("home:todo", t("dashboard.home.todo"), todo, true);
		}

		// Complétés — repliés par défaut : le badge dit combien, la grille ne
		// repousse plus « À faire » hors de l'écran.
		if (completed.length > 0) {
			renderSection("home:completed", t("dashboard.home.completed"), completed, false);
		}

	}

	/* Héros « Reprendre » — teinté par l'accent du DOSSIER du quiz, comme sa
	   carte (revue design 2026-07-28) : liseré vertical, halo, label, barre et
	   bouton en dérivent. C'est ce qui règle la concurrence d'accents : la
	   pilule claire reste l'action de page (« Generate a quiz »), le héros parle
	   la couleur de son module au lieu du bleu d'interface. */
	function renderResumeHero(container: HTMLElement, quiz: QuizIndexEntry, stats: QuizStatRecord | null | undefined, accent: string): void {
		const total = quiz.questions || (stats && stats.totalQuestions) || 0;
		const done = stats ? stats.questionsDone : 0;
		const pct = total > 0 ? Math.round(done / total * 100) : 0;

		const hero = container.createDiv({ cls: "qbd-resume-hero" });
		hero.style.setProperty("--accent", accent);
		const open = () => ctx.navigate("detail", { quiz });
		hero.addEventListener("click", open);

		// Halo derrière le contenu : boîte propre, entièrement contenue (une
		// ellipse qui dépasserait se ferait couper net par un ancêtre à scroll).
		hero.createDiv({ cls: "qbd-resume-halo" });

		const info = hero.createDiv({ cls: "qbd-resume-info" });

		const label = info.createDiv({ cls: "qbd-resume-label" });
		const labelIcon = label.createSpan({ cls: "qbd-resume-label-icon" });
		setIcon(labelIcon, "history");
		label.createSpan({ text: t("dashboard.home.resumeLabel") });

		info.createEl("p", { cls: "qbd-resume-title", text: quiz.title });

		// Dossier parent, même source que la ligne des cartes : le héros dit d'où
		// vient le quiz, sinon sa couleur d'accent n'a aucun référent à l'écran.
		const segs = quiz.path.split("/").slice(0, -1).filter(Boolean);
		if (segs.length > 0) {
			info.createEl("p", { cls: "qbd-resume-path", text: segs[segs.length - 1] });
		}

		const progress = info.createDiv({ cls: "qbd-resume-progress" });
		const bar = progress.createDiv({ cls: "qbd-resume-bar" });
		const fill = bar.createDiv({ cls: "qbd-resume-bar-fill" });
		fill.style.width = `${pct}%`;
		// L'accord se joue sur le TOTAL (« 0/1 question », « 3/10 questions ») :
		// le compteur formé est ensuite inséré tel quel dans la ligne de progression.
		const questions = t(total === 1 ? "dashboard.common.questionsOfOne" : "dashboard.common.questionsOfOther", { done, total });
		progress.createEl("span", { cls: "qbd-resume-progress-text", text: t("dashboard.home.resumeProgress", { questions, pct }) });

		const btn = hero.createEl("button", { cls: "qbd-btn qbd-resume-btn" });
		const btnIcon = btn.createSpan({ cls: "qbd-btn-icon" });
		setIcon(btnIcon, "play");
		btn.createSpan({ text: t("dashboard.home.resumeBtn") });
		btn.addEventListener("click", (e) => { e.stopPropagation(); open(); });
	}

	function renderOnboarding(container: HTMLElement): void {
		const wrap = container.createDiv({ cls: "qbd-onboarding" });

		const icon = wrap.createDiv({ cls: "qbd-onboarding-icon" });
		setIcon(icon, "graduation-cap");

		wrap.createEl("h2", { cls: "qbd-onboarding-title", text: t("dashboard.onboarding.title") });
		wrap.createEl("p", {
			cls: "qbd-onboarding-lead",
			text: t("dashboard.onboarding.lead")
		});

		// Action primaire évidente — MÊME pilule claire que l'accueil peuplé et
		// que « + New folder » : une seule grammaire d'action primaire.
		const primary = wrap.createEl("button", { cls: "qbd-btn--create qbd-onboarding-cta" });
		const pIcon = primary.createSpan({ cls: "qbd-btn-icon" });
		setIcon(pIcon, "sparkles");
		primary.createSpan({ text: t("dashboard.onboarding.generate") });
		primary.addEventListener("click", () => ctx.navigate("ai"));

		// Séparateur
		const divider = wrap.createDiv({ cls: "qbd-onboarding-divider" });
		divider.createSpan({ text: t("dashboard.onboarding.or") });

		// Méthode manuelle (divulgation progressive)
		const manual = wrap.createDiv({ cls: "qbd-onboarding-manual" });
		const manualHead = manual.createDiv({ cls: "qbd-onboarding-manual-head" });
		const mIcon = manualHead.createSpan({ cls: "qbd-onboarding-manual-icon" });
		setIcon(mIcon, "code");
		manualHead.createSpan({ text: t("dashboard.onboarding.manualTitle") });

		manual.createEl("p", {
			cls: "qbd-onboarding-manual-desc",
			text: t("dashboard.onboarding.manualDesc")
		});

		// Construit au rendu (et non en constante de module) : l'exemple affiché
		// ET copié doit être dans la langue courante. ⚠️ Les 2 valeurs traduites
		// sont injectées entre apostrophes SIMPLES : une apostrophe dans la
		// traduction casserait le JSON5 collé par l'utilisateur (contrainte
		// rappelée dans les 2 dictionnaires). Les noms de villes ne se traduisent
		// pas — ce sont les réponses de la question.
		const CODE_SAMPLE = [
			"```quiz-blocks",
			"[",
			"  {",
			`    title: '${t("dashboard.onboarding.sampleTitle")}',`,
			`    prompt: '${t("dashboard.onboarding.samplePrompt")}',`,
			"    options: ['Lyon', 'Paris', 'Marseille'],",
			"    correctIndex: 1,",
			"  }",
			"]",
			"```"
		].join("\n");

		const codeWrap = manual.createDiv({ cls: "qbd-onboarding-code-wrap" });
		const pre = codeWrap.createEl("pre", { cls: "qbd-onboarding-code" });
		pre.createEl("code", { text: CODE_SAMPLE });

		const copyBtn = codeWrap.createEl("button", { cls: "qbd-onboarding-copy", attr: { "aria-label": t("dashboard.onboarding.copy") } });
		const copyIcon = copyBtn.createSpan({ cls: "qbd-btn-icon qbd-btn-icon--sm" });
		setIcon(copyIcon, "copy");
		copyBtn.addEventListener("click", async () => {
			try {
				await navigator.clipboard.writeText(CODE_SAMPLE);
				copyIcon.empty();
				setIcon(copyIcon, "check");
				window.setTimeout(() => { copyIcon.empty(); setIcon(copyIcon, "copy"); }, 1500);
			} catch (e) { /* clipboard indisponible : sans effet */ }
		});
	}

	/** Accent du DOSSIER d'un quiz — même source que « Mes quiz ». */
	function accentOf(quiz: QuizIndexEntry, map: ModuleMap): string {
		const folder = moduleForQuiz(quiz.path, map).folder;
		return moduleAccent(map.byFolder.get(folder) ?? { folder });
	}

	/* Carte de quiz — MÊME anatomie que « Mes quiz » : verre, teinte du dossier
	   parent, bouton lecture et menu ⋯. L'accueil et « Mes quiz » ne parlaient
	   pas la même langue visuelle ; depuis le contrat 2026-07-28, une carte de
	   quiz a UNE seule apparence. Le cran de cascade est posé par l'appelant :
	   il continue le compteur de la page (stats et en-têtes l'ont déjà avancé). */
	function renderQuizCard(
		container: HTMLElement,
		quiz: QuizIndexEntry,
		stats: QuizStatRecord | null | undefined,
		map: ModuleMap
	): HTMLDivElement {
		return renderSharedQuizCard(container, quiz, stats, (q) => ctx.navigate("detail", { quiz: q }), {
			onPlay: (q) => openQuizForPlay(ctx.app, q),
			menu: buildQuizCardMenu(ctx, rerender),
			accent: accentOf(quiz, map),
		});
	}

	return { render };
}
