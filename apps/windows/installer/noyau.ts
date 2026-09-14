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
    Le nom fixe `neo-quiz-setup.exe` sert au site, jamais à identifier la
    version que le bootstrapper est sur le point d'installer. */
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
	return ["/allusers", `/D=${dossier}`, "/S"];
}
