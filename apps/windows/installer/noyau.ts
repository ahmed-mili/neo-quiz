/* ══════════════════════════════════════════════════════════
   NOYAU PUR DU BOOTSTRAPPER D'INSTALLATION

   Ce module contient les décisions qui ne doivent dépendre ni d'Electron ni
   du réseau : quelle ressource d'une release est installable, quelle empreinte
   est exigée, et quels arguments sont donnés au NSIS déjà produit par
   electron-builder. Le processus principal et le travailleur élevé consomment
   ces fonctions ; le contrôle `check:installer` charge donc le code RÉEL.
══════════════════════════════════════════════════════════ */

export interface RessourceRelease {
	name: string;
	browser_download_url: string;
	size: number;
	digest?: string | null;
}

export interface ReleaseGithub {
	tag_name: string;
	draft: boolean;
	prerelease: boolean;
	assets: RessourceRelease[];
}

export interface PaquetInstallable {
	version: string;
	nom: string;
	url: string;
	taille: number;
	sha256: string;
}

/** Ne retient que le NSIS VERSIONNÉ de la dernière release applicative.
    Un ancien alias `neo-quiz-setup.exe` peut subsister dans une release
    historique : il n'est jamais une source de version et le site ne le
    distribue plus comme point d'entrée. */
export function resoudrePaquet(release: ReleaseGithub): PaquetInstallable | null {
	if (release.draft || release.prerelease) return null;
	const m = /^desktop-v(.+)$/.exec(release.tag_name);
	if (!m) return null;
	const version = m[1];
	const nom = `neo-quiz-setup-${version}.exe`;
	const asset = release.assets.find(a => a.name === nom);
	if (!asset || !Number.isFinite(asset.size) || asset.size <= 0) return null;
	const digest = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest ?? "");
	if (!digest) return null;

	let url: URL;
	try {
		url = new URL(asset.browser_download_url);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" || url.hostname !== "github.com") return null;
	if (!url.pathname.startsWith(`/ahmed-mili/neo-quiz/releases/download/${release.tag_name}/`)) return null;

	return {
		version,
		nom,
		url: url.toString(),
		taille: asset.size,
		sha256: digest[1].toLowerCase(),
	};
}

/** Arguments de l'installeur assisté d'electron-builder en mode silencieux.
    `/allusers` force le même mode machine que l'utilisateur choisissait dans
    l'ancienne page NSIS. `/D=` est spécial chez NSIS : electron-builder
    26.0.19 le lit comme TOUT ce qui suit, donc il doit rester le dernier. */
export function argumentsNsis(dossier: string): string[] {
	return ["/allusers", "/S", `/D=${dossier}`];
}

/* ─────────── la langue de l'installeur ───────────
   L'exe téléchargé ne sait pas de quelle page du site il vient. La langue
   voyage donc AVEC le fichier, par deux canaux, du plus sûr au moins sûr :

   1. Le NOM du fichier : la release attache le même bootstrapper deux fois,
      `Install-NeoQuiz.exe` (anglais) et `Install-NeoQuiz-fr.exe`, et la page
      française du site pointe sur le second.
   2. Le flux `Zone.Identifier` (« Mark of the Web ») que Chrome, Edge et
      Firefox posent sur tout téléchargement : il porte `ReferrerUrl` et
      `HostUrl`, donc `/fr/` quand le clic vient de la page française. Il
      couvre un fichier renommé par l'utilisateur ou par le navigateur
      (« Install-NeoQuiz (1).exe »), et le nom anglais servi par GitHub à qui
      a cliqué depuis la page française avant que la release porte le second.

   Ni l'un ni l'autre : `null`, et l'appelant retombe sur la locale système. */

export type LangueInstallateur = "en" | "fr";

const LANGUES: readonly LangueInstallateur[] = ["en", "fr"];

/** `Install-NeoQuiz-fr.exe`, `Install-NeoQuiz-fr (1).exe` → « fr » ;
    `Install-NeoQuiz.exe` → « en » ; un nom sans rapport → `null`. */
export function langueDepuisNom(nom: string): LangueInstallateur | null {
	const m = /^Install-NeoQuiz(?:-([a-z]{2}))?(?: \(\d+\))?\.exe$/i.exec(nom.trim());
	if (!m) return null;
	if (!m[1]) return "en";
	const code = m[1].toLowerCase();
	return (LANGUES as readonly string[]).includes(code) ? code as LangueInstallateur : null;
}

/** Lit `ReferrerUrl` puis `HostUrl` d'un flux `Zone.Identifier` (format
    INI) et en tire la langue du site : `/fr/` → « fr », la racine ou `/en/`
    → « en ». Un flux d'un autre site, ou sans URL, → `null` (jamais « en »
    par défaut : ce n'est pas une preuve). */
export function langueDepuisZone(zone: string): LangueInstallateur | null {
	for (const cle of ["ReferrerUrl", "HostUrl"]) {
		const m = new RegExp(`^${cle}=(.+)$`, "mi").exec(zone);
		if (!m) continue;
		let url: URL;
		try {
			url = new URL(m[1].trim());
		} catch {
			continue;
		}
		if (url.hostname !== "ahmed-mili.github.io") continue;
		const segments = url.pathname.split("/").filter(Boolean);
		if (segments[0] !== "neo-quiz") continue;
		const code = segments[1]?.toLowerCase();
		if (code && (LANGUES as readonly string[]).includes(code)) return code as LangueInstallateur;
		return "en";
	}
	return null;
}
