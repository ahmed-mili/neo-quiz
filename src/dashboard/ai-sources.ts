import { currentHost } from "../host/current";
import type { ModeQuiz, Manque } from "../quiz-format";
import { lireBlocQuiz, planDesTranches } from "../quiz-format";
import { t } from "../i18n";

/**
 * UNE SOURCE, DEUX NOTES (spec Learn/Practice §1.2) : `<source> — Learn.md`
 * et `<source> — Practice.md`, dans le même dossier. La source est la
 * première pièce jointe (le CM), sinon le titre que le modèle a donné.
 * C'est ce nom commun qui permet à la génération Practice de retrouver le
 * Learn et d'y lire le plan des tranches.
 */

const INTERDITS = /[\\/:*?"<>|]/g;

export function nomDeSource(pieces: { name: string }[], titre: string | undefined, repli: string): string {
	const brut = pieces[0]?.name.replace(/\.[^.\\/]+$/, "") || titre || repli;
	return brut.replace(INTERDITS, "-").replace(/\s+/g, " ").trim() || repli;
}

export function nomDeNote(source: string, mode: ModeQuiz): string {
	return `${source} — ${mode === "learn" ? "Learn" : "Practice"}`;
}

/** Le plan des tranches du Learn de cette source, s'il existe dans le
    dossier ; `null` sinon, ou s'il est illisible — la génération Practice
    part alors sans plan, jamais en échec. */
export async function lirePlanLearn(dossier: string, source: string): Promise<{ slice: number; titre: string }[] | null> {
	const fs = currentHost().fs;
	const chemin = `${dossier ? dossier + "/" : ""}${nomDeNote(source, "learn")}.md`;
	try {
		if (!(await fs.exists(chemin))) return null;
		const items = lireBlocQuiz(await fs.read(chemin));
		const plan = items ? planDesTranches(items) : [];
		return plan.length ? plan : null;
	} catch {
		return null;
	}
}

/** Une notice par manque, traduite, qui NOMME les questions. */
export function messagesDesManques(manques: Manque[]): string[] {
	return manques.map(m => {
		switch (m.kind) {
			case "sansExplication": return t("ai.format.noExplain", { count: m.questions.length, names: m.questions.join(", ") });
			case "trancheInconnue": return t("ai.format.unknownSlice", { count: m.questions.length, names: m.questions.join(", ") });
			case "sansTranche": return t("ai.format.noSlice", { count: m.questions.length, names: m.questions.join(", ") });
			case "trancheIncomplete": return t("ai.format.incompleteSlice", { slice: m.slice, roles: m.rolesManquants.join(", ") });
			case "sansObjectifs": return t("ai.format.noObjectives");
		}
	});
}
