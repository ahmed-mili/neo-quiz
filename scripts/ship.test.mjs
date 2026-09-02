import test from "node:test";
import assert from "node:assert/strict";

import {
	readArguments,
	worksToCommit,
	actionsUrl,
	checksToRun,
	resolveCommand,
	ongoingOperationFrom,
	stagedPathsFrom,
	confirmStagePrompt,
	confirmsStaging,
	requiresInteractiveConfirmation,
	describeTagConflict,
	OPERATION_MARKERS,
	versionCommitArgs,
	tagArgs,
	pushArgs,
} from "./ship.mjs";

test("sans rien, la livraison répare", () => {
	assert.deepEqual(readArguments([]), {
		request: "patch",
		message: undefined,
		watch: false,
	});
});

test("un seul mot est le message, pas un niveau", () => {
	assert.deepEqual(readArguments(["Fix collapse ghost pixels"]), {
		request: "patch",
		message: "Fix collapse ghost pixels",
		watch: false,
	});
});

test("le niveau précède le message", () => {
	assert.deepEqual(readArguments(["minor", "Add ordering questions"]), {
		request: "minor",
		message: "Add ordering questions",
		watch: false,
	});
});

test("un numéro écrit en toutes lettres tient lieu de niveau", () => {
	assert.deepEqual(readArguments(["3.0.0", "Sortie de bêta"]), {
		request: "3.0.0",
		message: "Sortie de bêta",
		watch: false,
	});
});

test("un numéro avec suffixe -beta tient aussi lieu de niveau", () => {
	assert.deepEqual(readArguments(["2.5.0-beta", "Nouvelle bêta"]), {
		request: "2.5.0-beta",
		message: "Nouvelle bêta",
		watch: false,
	});
});

test("un niveau peut venir seul, quand l'arbre est déjà propre", () => {
	assert.deepEqual(readArguments(["major"]), {
		request: "major",
		message: undefined,
		watch: false,
	});
});

test("le drapeau de suivi se glisse où il veut", () => {
	assert.deepEqual(readArguments(["--watch", "minor", "Add a view"]), {
		request: "minor",
		message: "Add a view",
		watch: true,
	});
	assert.deepEqual(readArguments(["Fix a leak", "--watch"]), {
		request: "patch",
		message: "Fix a leak",
		watch: true,
	});
});

test("refuse un mot de plus, plutôt que d'en perdre un", () => {
	assert.throws(() => readArguments(["Fix", "the", "toolbar"]), /guillemets/);
});

test("refuse un drapeau inconnu", () => {
	assert.throws(() => readArguments(["--force", "Fix a leak"]), /--force/);
});

test("un arbre sale sans message ne part pas", () => {
	assert.throws(() => worksToCommit(undefined, true), /message/);
});

test("un arbre sale avec un message donne un commit de travail", () => {
	assert.equal(worksToCommit("Fix a leak", true), true);
});

test("un arbre propre se passe de commit de travail", () => {
	assert.equal(worksToCommit(undefined, false), false);
});

test("un message sans rien à commiter est une erreur, pas un silence", () => {
	assert.throws(() => worksToCommit("Fix a leak", false), /Rien à commiter/);
});

test("l'adresse des exécutions se lit sur le dépôt distant", () => {
	assert.equal(
		actionsUrl("https://github.com/ahmed-mili/obsidian-quiz-blocks.git"),
		"https://github.com/ahmed-mili/obsidian-quiz-blocks/actions"
	);
	assert.equal(
		actionsUrl("git@github.com:ahmed-mili/obsidian-quiz-blocks.git"),
		"https://github.com/ahmed-mili/obsidian-quiz-blocks/actions"
	);
});

test("un distant qui n'est pas GitHub n'a pas d'exécutions à montrer", () => {
	assert.equal(
		actionsUrl("https://example.com/ahmed/obsidian-quiz-blocks.git"),
		undefined
	);
});

test("sans vault réel présent, seules les vérifications rapides tournent", () => {
	const { checks, skippedVaults } = checksToRun([]);
	assert.deepEqual(
		checks.map((c) => c.label),
		["typecheck", "check:md", "check:export", "check:lesson"]
	);
	assert.equal(skippedVaults, true);
});

test("un vault présent ajoute check:markers et audit-vaults, avec son chemin", () => {
	const { checks, skippedVaults } = checksToRun(["C:/obsidian-vaults/Personal"]);
	assert.deepEqual(
		checks.map((c) => c.label),
		["typecheck", "check:md", "check:export", "check:lesson", "check:markers", "audit-vaults"]
	);
	assert.equal(skippedVaults, false);
	const auditVaults = checks.find((c) => c.label === "audit-vaults");
	assert.deepEqual(auditVaults.args, [
		"scripts/audit-vaults.mjs",
		"C:/obsidian-vaults/Personal",
	]);
});

test("le typecheck passe toujours en premier, avant tout ce qui touche un vault", () => {
	// Le moins cher d'abord : un typecheck cassé n'a pas à attendre un aller-
	// retour sur 67 quiz pour être signalé.
	const { checks } = checksToRun(["C:/obsidian-vaults/Personal"]);
	assert.equal(checks[0].label, "typecheck");
});

// FINDING 1 — npm est un .cmd sur Windows, pas un exécutable direct.
test("resolveCommand mappe npm vers npm.cmd sur Windows", () => {
	assert.equal(resolveCommand("npm", "win32"), "npm.cmd");
});

test("resolveCommand laisse npm tel quel ailleurs que Windows", () => {
	assert.equal(resolveCommand("npm", "linux"), "npm");
	assert.equal(resolveCommand("npm", "darwin"), "npm");
});

test("resolveCommand laisse les vrais exécutables intacts, y compris sur Windows", () => {
	assert.equal(resolveCommand("git", "win32"), "git");
	assert.equal(resolveCommand("node", "win32"), "node");
	assert.equal(resolveCommand("gh", "win32"), "gh");
});

test("les vérifications utilisent déjà le nom résolu de la commande", () => {
	// Sur ce poste (win32), une vérification qui appellerait encore "npm" nu
	// reproduirait ENOENT — la régression que le finding 1 a trouvée.
	const { checks } = checksToRun([]);
	for (const check of checks) {
		assert.equal(check.command, resolveCommand("npm"));
	}
});

// FINDING 2 — une fusion/rebasage/cherry-pick en cours doit bloquer avant tout.
test("ongoingOperationFrom repère une fusion en cours", () => {
	assert.equal(ongoingOperationFrom(["MERGE_HEAD"]), "MERGE_HEAD");
});

test("ongoingOperationFrom repère un rebasage en cours", () => {
	assert.equal(ongoingOperationFrom(["rebase-merge"]), "rebase-merge");
	assert.equal(ongoingOperationFrom(["rebase-apply"]), "rebase-apply");
});

test("ongoingOperationFrom repère un cherry-pick ou un revert en cours", () => {
	assert.equal(ongoingOperationFrom(["CHERRY_PICK_HEAD"]), "CHERRY_PICK_HEAD");
	assert.equal(ongoingOperationFrom(["REVERT_HEAD"]), "REVERT_HEAD");
});

test("ongoingOperationFrom ne voit rien quand rien n'est en cours", () => {
	assert.equal(ongoingOperationFrom([]), null);
});

// FINDING 2, round 2 — un picorage/retour multi-commits sans conflit ne
// laisse que .git/sequencer : aucun autre marqueur n'existe alors.
test("ongoingOperationFrom repère un sequencer suspendu sans conflit", () => {
	assert.equal(ongoingOperationFrom(["sequencer"]), "sequencer");
});

test("sequencer fait bien partie des marqueurs surveillés", () => {
	assert.ok(OPERATION_MARKERS.includes("sequencer"));
});

// FINDING 4 — git add -A doit se montrer avant de balayer l'arbre.
test("stagedPathsFrom lit les chemins d'un statut porcelain", () => {
	const porcelain = " M package.json\n?? scripts/ship.mjs\n";
	assert.deepEqual(stagedPathsFrom(porcelain), [
		"package.json",
		"scripts/ship.mjs",
	]);
});

test("stagedPathsFrom tolère les fins de ligne CRLF", () => {
	const porcelain = " M src/assets/manifest.json\r\n";
	assert.deepEqual(stagedPathsFrom(porcelain), ["src/assets/manifest.json"]);
});

test("stagedPathsFrom ignore les lignes vides", () => {
	assert.deepEqual(stagedPathsFrom(""), []);
	assert.deepEqual(stagedPathsFrom("\n\n"), []);
});

test("confirmStagePrompt liste chaque chemin et demande de recopier leur nombre", () => {
	const prompt = confirmStagePrompt([
		"package.json",
		"src/assets/css/dashboard/dashboard-ai.css",
	]);
	assert.match(prompt, /git add -A/);
	assert.match(prompt, /package\.json/);
	assert.match(prompt, /dashboard-ai\.css/);
	assert.match(prompt, /Tape 2/);
});

test("confirmStagePrompt reste lisible sans rien à ajouter", () => {
	const prompt = confirmStagePrompt([]);
	assert.match(prompt, /Tape 0/);
});

// FINDING 1, round 2 — une confirmation "o/N" se tape sans lire ; il faut
// recopier le compte exact affiché, qui suppose de l'avoir lu.
test("confirmsStaging exige le nombre exact, pas un simple oui", () => {
	assert.equal(confirmsStaging("3", 3), true);
	assert.equal(confirmsStaging(" 3 ", 3), true);
	assert.equal(confirmsStaging("o", 3), false);
	assert.equal(confirmsStaging("oui", 3), false);
	assert.equal(confirmsStaging("y", 3), false);
	assert.equal(confirmsStaging("2", 3), false);
	assert.equal(confirmsStaging("", 3), false);
});

// FINDING 1, round 2 — sans terminal, la question ne se résoudrait jamais :
// il faut refuser AVANT d'ouvrir `readline`, pas y entrer.
test("requiresInteractiveConfirmation refuse un commit de travail sans TTY", () => {
	assert.equal(requiresInteractiveConfirmation(true, false), true);
	assert.equal(requiresInteractiveConfirmation(true, undefined), true);
});

test("requiresInteractiveConfirmation laisse passer un TTY réel", () => {
	assert.equal(requiresInteractiveConfirmation(true, true), false);
});

test("requiresInteractiveConfirmation ne concerne pas une livraison sans commit de travail", () => {
	// Sans message ni changement à commiter, aucune confirmation n'est
	// demandée : l'absence de TTY n'a alors rien à bloquer.
	assert.equal(requiresInteractiveConfirmation(false, false), false);
});

// FINDING 3, round 2 — un push refusé laisse une étiquette locale, jamais
// publiée : le message ne doit pas prétendre le contraire.
test("describeTagConflict ne trouve rien à signaler sans étiquette", () => {
	assert.equal(describeTagConflict({ local: false, remote: false }, "2.4.1-beta"), null);
});

test("describeTagConflict distingue une étiquette locale seule d'une étiquette publiée", () => {
	const localOnly = describeTagConflict({ local: true, remote: false }, "2.4.1-beta");
	assert.match(localOnly, /LOCAL/);
	assert.doesNotMatch(localOnly, /publiée/);

	const published = describeTagConflict({ local: true, remote: true }, "2.4.1-beta");
	assert.match(published, /publiée/);
});

test("describeTagConflict signale la publication même si le local ne l'a pas encore", () => {
	// Cas rare (étiquette créée par quelqu'un/quelque chose d'autre puis vue
	// via ls-remote sans être encore rapatriée) : le distant a le dernier mot.
	const published = describeTagConflict({ local: false, remote: true }, "2.4.1-beta");
	assert.match(published, /publiée/);
});

// FINDING 3 / séquence finale — l'étiquette est nommée explicitement, jamais
// via --follow-tags, dans le même push atomique que la branche.
test("versionCommitArgs commite avec le message attendu", () => {
	assert.deepEqual(versionCommitArgs("2.4.1-beta"), [
		"commit",
		"-am",
		"Version 2.4.1-beta",
	]);
});

test("tagArgs pose l'étiquette vX", () => {
	assert.deepEqual(tagArgs("2.4.1-beta"), ["tag", "v2.4.1-beta"]);
});

test("pushArgs nomme la branche ET l'étiquette dans le même push atomique", () => {
	assert.deepEqual(pushArgs("2.4.1-beta"), [
		"push",
		"--atomic",
		"origin",
		"main",
		"v2.4.1-beta",
	]);
});

test("pushArgs ne s'appuie jamais sur --follow-tags", () => {
	// Une étiquette légère y échapperait en silence (finding source) : la
	// forme retenue nomme l'étiquette elle-même, pas une option qui la devine.
	assert.equal(pushArgs("2.4.1-beta").includes("--follow-tags"), false);
});
