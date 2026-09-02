/*
 * Monte la version d'un seul geste :
 *
 *   npm run version:set -- patch     2.4.0-beta → 2.4.1-beta
 *   npm run version:set -- minor     2.4.1-beta → 2.5.0-beta
 *   npm run version:set -- major     2.5.0-beta → 3.0.0-beta
 *   npm run version:set -- 3.0.0     le numéro exact, quand il le faut
 *
 * CE QUE DIT UN NUMÉRO. Les trois nombres ne sont pas décoratifs : ils
 * répondent à « qu'est-ce que ça change pour moi ? ».
 *
 *   MAJEUR    l'utilisateur perd une habitude : un format de quiz qui ne se
 *             relit plus comme avant, un réglage qui disparaît.
 *   MINEUR    quelque chose de neuf que l'on peut faire et que l'on ne
 *             pouvait pas. Rien ne casse.
 *   CORRECTIF rien de neuf : ce qui existait déjà marche enfin comme il
 *             devait.
 *
 * SUFFIXE -beta. Ce dépôt publie en pré-version tant que le plugin n'est pas
 * soumis à la liste communautaire d'Obsidian (2.4.0-beta au 2026-08-31). Un
 * bump garde le suffixe : la série reste « en beta » jusqu'à ce qu'un numéro
 * exact, écrit en toutes lettres sans suffixe, la fasse sortir de ce statut.
 * Perdre le suffixe en bumpant serait publier une release stable par accident
 * — c'est `.github/workflows/release.yml` qui décide `prerelease` sur la
 * présence d'un `-` dans le tag, donc ce choix a un effet direct sur GitHub.
 *
 * UN SEUL FICHIER PORTE LE NUMÉRO ICI, contrairement à neo-calendar (six
 * fichiers, dont un `versionCode` Android à incrémenter séparément) : ce
 * dépôt est un plugin Obsidian, décrit par le seul `src/assets/manifest.json`
 * (cf. CLAUDE.md — la version de `package.json` est statique et ignorée,
 * volontairement). Toute la machinerie multi-fichiers de neo-calendar
 * (LOCKFILES, TAURI_CONFIG, CARGO_*, GRADLE_MODULE) n'a donc pas de raison
 * d'exister ici : la porter aurait été de la complexité sans destinataire.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	".."
);

export const VERSION_FILE = "src/assets/manifest.json";

// Optionnel : `-beta`, `-rc.1`… — tout ce que semver appelle un identifiant
// de pré-version. Le workflow de release en dérive `prerelease` tel quel.
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

export function isVersion(value) {
	return typeof value === "string" && VERSION_PATTERN.test(value);
}

/** Les trois mots qui décrivent une livraison, du plus lourd au plus léger. */
export const LEVELS = ["major", "minor", "patch"];

/**
 * Le numéro suivant, à partir de celui d'aujourd'hui et de ce que la
 * livraison change. Le suffixe de pré-version, s'il y en a un, survit au
 * bump tel quel (voir l'en-tête) — seul un numéro exact demandé en toutes
 * lettres peut l'enlever.
 */
export function nextVersion(current, level) {
	if (!isVersion(current)) {
		throw new Error(`Version actuelle illisible : « ${current} ».`);
	}
	const [, core, suffix] = current.match(/^(\d+\.\d+\.\d+)(-.+)?$/);
	const [major, minor, patch] = core.split(".").map(Number);

	const bumped = (() => {
		switch (level) {
			case "major":
				return `${major + 1}.0.0`;
			case "minor":
				return `${major}.${minor + 1}.0`;
			case "patch":
				return `${major}.${minor}.${patch + 1}`;
			default:
				throw new Error(
					`Niveau attendu parmi ${LEVELS.join(", ")}, reçu « ${level} ».`
				);
		}
	})();

	return suffix ? `${bumped}${suffix}` : bumped;
}

/** Le numéro que porte le plugin en ce moment. */
export async function currentVersion() {
	const manifest = await readFile(
		path.join(repositoryRoot, VERSION_FILE),
		"utf8"
	);
	const found = manifest.match(/"version": "([^"]+)"/);

	if (!found) {
		throw new Error(`Version introuvable dans ${VERSION_FILE}.`);
	}

	return found[1];
}

/**
 * Ce qui est demandé, résolu en un numéro : « patch » et consorts se lisent
 * à partir de la version en place, un numéro écrit en toutes lettres passe
 * tel quel — c'est le seul moyen de sortir de `-beta`.
 */
export async function resolveVersion(request) {
	if (!request) {
		throw new Error(
			`Attendu : ${LEVELS.join(" | ")} ou un numéro comme 3.0.0.`
		);
	}
	if (LEVELS.includes(request)) {
		return nextVersion(await currentVersion(), request);
	}
	if (isVersion(request)) return request;

	throw new Error(
		`Attendu : ${LEVELS.join(" | ")} ou un numéro comme 3.0.0, ` +
			`reçu « ${request} ».`
	);
}

/**
 * Remplace exactement une occurrence, ou échoue plutôt que d'en rater une —
 * le manifest ne contient qu'un seul `"version"`, donc une deuxième
 * occurrence trouvée serait le signe que le fichier a changé de forme.
 */
export function withVersion(manifestText, version) {
	const pattern = /("version": ")[^"]+(")/g;
	const found = [...manifestText.matchAll(pattern)].length;

	if (found !== 1) {
		throw new Error(
			`${VERSION_FILE} : 1 occurrence de "version" attendue, ${found} trouvée(s).`
		);
	}

	return manifestText.replace(/("version": ")[^"]+(")/, `$1${version}$2`);
}

export async function setVersion(version) {
	if (!isVersion(version)) {
		throw new Error(
			`Version attendue sous la forme 1.2.3 ou 1.2.3-beta, reçu « ${version} ».`
		);
	}

	const absolutePath = path.join(repositoryRoot, VERSION_FILE);
	const before = await readFile(absolutePath, "utf8");
	const after = withVersion(before, version);

	if (after === before) {
		throw new Error(`Rien à changer dans ${VERSION_FILE}.`);
	}

	await writeFile(absolutePath, after);
	return [VERSION_FILE];
}

const invokedScript = process.argv[1]
	? pathToFileURL(path.resolve(process.argv[1])).href
	: undefined;

if (invokedScript === import.meta.url) {
	const [request] = process.argv.slice(2);

	try {
		const version = await resolveVersion(request);
		const touched = await setVersion(version);
		for (const relativePath of touched) {
			console.log(`  ${relativePath}`);
		}
		console.log(`\nVersion ${version}. Reste à publier :`);
		console.log(`  git commit -am "Version ${version}"`);
		console.log(`  git tag v${version} && git push --atomic origin main v${version}`);
		console.log(`\nOu, la prochaine fois, tout d'un geste :`);
		console.log(`  git ship "Ce que ça change"   (voir scripts/ship.mjs)`);
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
