import test from "node:test";
import assert from "node:assert/strict";

import { isVersion, nextVersion, withVersion, VERSION_FILE } from "./set-version.mjs";

test("un numéro simple est reconnu", () => {
	assert.equal(isVersion("2.4.0"), true);
});

test("un numéro avec suffixe -beta est reconnu", () => {
	assert.equal(isVersion("2.4.0-beta"), true);
});

test("un suffixe multi-segments (rc.1) est reconnu", () => {
	assert.equal(isVersion("2.4.0-rc.1"), true);
});

test("un texte qui n'est pas un numéro est rejeté", () => {
	assert.equal(isVersion("patch"), false);
	assert.equal(isVersion("2.4"), false);
	assert.equal(isVersion(undefined), false);
});

test("patch monte le dernier chiffre", () => {
	assert.equal(nextVersion("2.4.0", "patch"), "2.4.1");
});

test("minor remet le patch à zéro", () => {
	assert.equal(nextVersion("2.4.3", "minor"), "2.5.0");
});

test("major remet minor et patch à zéro", () => {
	assert.equal(nextVersion("2.4.3", "major"), "3.0.0");
});

test("le suffixe -beta survit à un bump patch", () => {
	assert.equal(nextVersion("2.4.0-beta", "patch"), "2.4.1-beta");
});

test("le suffixe -beta survit à un bump minor", () => {
	assert.equal(nextVersion("2.4.0-beta", "minor"), "2.5.0-beta");
});

test("le suffixe -beta survit à un bump major", () => {
	assert.equal(nextVersion("2.4.0-beta", "major"), "3.0.0-beta");
});

test("un niveau inconnu est refusé", () => {
	assert.throws(() => nextVersion("2.4.0", "bogus"), /Niveau attendu/);
});

test("une version actuelle illisible est refusée", () => {
	assert.throws(() => nextVersion("deux-point-quatre", "patch"), /illisible/);
});

test("withVersion remplace l'unique occurrence de version", () => {
	const before = `{\n  "id": "quiz-blocks",\n  "version": "2.4.0-beta",\n  "main": "main.js"\n}\n`;
	const after = withVersion(before, "2.5.0-beta");
	assert.match(after, /"version": "2\.5\.0-beta"/);
	// Rien d'autre que la ligne de version n'a bougé.
	assert.equal(after.replace('"2.5.0-beta"', '"2.4.0-beta"'), before);
});

test("withVersion échoue plutôt que de deviner si aucune version n'est trouvée", () => {
	assert.throws(() => withVersion(`{"id": "quiz-blocks"}`, "2.5.0"), /occurrence/);
});

test("withVersion échoue si le manifest porte deux occurrences de version", () => {
	const doubled = `{"version": "2.4.0-beta", "version": "2.4.0-beta"}`;
	assert.throws(() => withVersion(doubled, "2.5.0"), /occurrence/);
});

test("le fichier porté est bien le manifest du plugin, pas package.json", () => {
	// package.json de ce dépôt est statique et volontairement ignoré (CLAUDE.md) :
	// une régression qui ferait pointer ce script dessus casserait ce contrat
	// en silence.
	assert.equal(VERSION_FILE, "src/assets/manifest.json");
});
