/* ══════════════════════════════════════════════════════════
   NOYAU PUR DU BOOTSTRAPPER D'INSTALLATION

   Ce module contient les décisions qui ne doivent dépendre ni d'Electron ni
   du réseau : où lire la description de la dernière release, quel paquet en
   est installable, quelle empreinte est exigée, et quels arguments sont donnés
   au NSIS déjà produit par electron-builder. Le processus principal et le
   travailleur élevé consomment ces fonctions ; le contrôle `check:installer`
   charge donc le code RÉEL.
══════════════════════════════════════════════════════════ */

/** Le dépôt d'où viennent le paquet ET sa description : le bootstrapper ne
    télécharge jamais ailleurs, quoi que dise un fichier. */
const DEPOT_RELEASES = "https://github.com/ahmed-mili/neo-quiz/releases";

/** La description de la dernière release applicative : le `latest.yml`
    qu'electron-builder écrit et qu'electron-updater lit, atteint par la
    redirection `releases/latest/download/…` de github.com.

    JAMAIS `api.github.com/…/releases/latest` : sans jeton, l'API REST est
    plafonnée à 60 requêtes par heure et par adresse IP, partagées entre tous
    les utilisateurs d'un même NAT (fac, entreprise, 4G) et tous les outils
    de la machine. Le bootstrapper 1.0.16 la lisait ; il s'ouvrait sur
    « La version actuelle de Neo Quiz n'a pas pu être préparée » dès le 61e
    lancement de l'heure — et chaque « Réessayer » comptait pour un. La
    redirection de github.com, elle, n'a pas ce plafond : c'est par elle que
    chaque application electron-updater du monde trouve sa mise à jour. */
export const URL_LATEST_YML = `${DEPOT_RELEASES}/latest/download/latest.yml`;

export interface PaquetInstallable {
	version: string;
	nom: string;
	url: string;
	taille: number;
	/** Base64, tel qu'electron-builder l'écrit — et tel que `check:package`
	    le compare à l'exe réel avant chaque publication. */
	sha512: string;
	/** Poids du logiciel une fois installé, publié par la CI sous la clé
	    racine `installedSize` de `latest.yml` (somme du dossier `win-unpacked`
	    qu'elle vient de construire). `null` pour toute release qui ne la porte
	    pas encore (1.0.0, 1.0.1) ou dont la valeur est invalide : le
	    pourcentage d'installation retombe alors sur une barre indéterminée,
	    jamais sur une valeur devinée. */
	tailleInstallee: number | null;
}

/** Candidat à valider : ce qu'on a lu d'un `latest.yml`, ou ce que le
    travailleur élevé reçoit du principal et ne croit pas sur parole. */
export interface CandidatPaquet {
	version: string;
	nom: string;
	taille: number;
	sha512: string;
	/** Non encore validée : `paquetInstallable` applique la même sévérité que
	    les autres champs (entier, positif, plus grand que le setup) et
	    retombe sur `null` plutôt que de refuser tout le paquet. */
	tailleInstallee?: number | null;
}

/** Une version publiée, sans suffixe : `releases/latest` ne sert jamais une
    pré-version (le workflow marque `prerelease` tout tag portant un `-`),
    et la refuser ici rend l'invariant explicite au lieu de le déléguer. */
const VERSION_PUBLIEE = /^\d+\.\d+\.\d+$/;
/** 64 octets en base64 : 86 caractères puis `==`. */
const SHA512_BASE64 = /^[A-Za-z0-9+/]{86}==$/;

/** Ne retient que le NSIS VERSIONNÉ (`neo-quiz-setup-X.Y.Z.exe`). Un ancien
    alias `neo-quiz-setup.exe` peut subsister dans une release historique : il
    n'est jamais une source de version et le site ne le distribue plus comme
    point d'entrée. L'URL est CONSTRUITE depuis la version, jamais lue : le
    fichier ne peut pas rediriger le téléchargement hors du dépôt. */
export function paquetInstallable(candidat: CandidatPaquet): PaquetInstallable | null {
	const { version, nom, taille, sha512, tailleInstallee } = candidat;
	if (!VERSION_PUBLIEE.test(version)) return null;
	if (nom !== `neo-quiz-setup-${version}.exe`) return null;
	if (!Number.isInteger(taille) || taille <= 0) return null;
	if (!SHA512_BASE64.test(sha512)) return null;
	/* Un logiciel installé pèse toujours plus que son installeur compressé :
	   une valeur qui ne respecte pas ça (absente, non entière, nulle,
	   négative, ou plus petite que `taille`) n'est pas une ERREUR de paquet,
	   c'est simplement une release sans cette information — `null`, jamais
	   une exception qui invaliderait tout le paquet. */
	const tailleInstalleeValidee =
		Number.isInteger(tailleInstallee) && (tailleInstallee as number) > taille
			? (tailleInstallee as number)
			: null;
	return {
		version,
		nom,
		url: `${DEPOT_RELEASES}/download/desktop-v${version}/${nom}`,
		taille,
		sha512,
		tailleInstallee: tailleInstalleeValidee,
	};
}

/** Le sous-ensemble de YAML qu'electron-builder écrit dans `latest.yml` :
    des `clé: valeur` au niveau racine, et sous `files:` une liste d'entrées
    `- url: …` suivies de leurs clés indentées. Pas de bibliothèque YAML : le
    format est fixe, et un analyseur complet accepterait bien plus que lui. */
function lireLatestYml(texte: string): { racine: Map<string, string>; fichiers: Map<string, string>[] } {
	const racine = new Map<string, string>();
	const fichiers: Map<string, string>[] = [];
	let dansFiles = false;
	for (const ligne of texte.split(/\r?\n/)) {
		const m = /^(\s*)(-\s+)?([A-Za-z0-9_]+):\s*(.*?)\s*$/.exec(ligne);
		if (!m) continue;
		const [, indentation, tiret, cle, brut] = m;
		const valeur = brut.replace(/^(['"])(.*)\1$/, "$2");
		if (indentation === "" && !tiret) {
			dansFiles = cle === "files";
			if (!dansFiles) racine.set(cle, valeur);
			continue;
		}
		if (!dansFiles) continue;
		if (tiret) fichiers.push(new Map([[cle, valeur]]));
		else fichiers.at(-1)?.set(cle, valeur);
	}
	return { racine, fichiers };
}

/** La dernière release installable d'après son `latest.yml`, ou `null` si le
    fichier ne décrit pas exactement UN NSIS versionné, avec sa taille et son
    empreinte, cohérentes entre la racine et l'entrée `files`. */
export function resoudrePaquet(latestYml: string): PaquetInstallable | null {
	const { racine, fichiers } = lireLatestYml(latestYml);
	const version = racine.get("version");
	const nom = racine.get("path");
	const sha512 = racine.get("sha512");
	if (!version || !nom || !sha512) return null;
	const entree = fichiers.find(f => f.get("url") === nom);
	if (!entree || entree.get("sha512") !== sha512) return null;
	const taille = Number(entree.get("size"));
	/* Clé racine facultative, ignorée d'electron-updater comme de tout lecteur
	   qui ne la connaît pas : absente sur les releases publiées avant elle. */
	const installedSize = racine.get("installedSize");
	const tailleInstallee = installedSize === undefined ? null : Number(installedSize);
	return paquetInstallable({ version, nom, taille, sha512, tailleInstallee });
}

/** Le seuil de croissance qui distingue une VRAIE reprise (une mise à jour
    a fini de retirer l'ancienne version) d'un simple sursaut d'écriture NSIS. */
const SEUIL_CROISSANCE_OCTETS = 8 * 1024 * 1024;

/** Le pourcentage d'installation, comme fonction PURE des octets observés.
    Étant donné le minimum jamais vu (une mise à jour commence par RÉTRÉCIR
    le dossier, le temps que NSIS retire l'ancienne version), le courant, le
    total publié et la dernière valeur émise :
    - `total` absent → `null` pendant toute l'étape (repli sans régression) ;
    - tant que la croissance depuis le minimum ne dépasse pas le seuil,
      `dernier` est repropagé tel quel (donc `null` avant toute reprise) ;
    - une fois le seuil dépassé, `(courant - minimum) / (total - minimum)`,
      borné à [0, 99] ;
    - jamais de valeur republiée en dessous de `dernier` : la jauge ne recule
      jamais, quelle que soit la fluctuation du sondage suivant. */
export function progressionInstallation(e: {
	courant: number;
	minimum: number;
	total: number | null;
	dernier: number | null;
}): number | null {
	const { courant, minimum, total, dernier } = e;
	if (total === null) return null;
	const denominateur = total - minimum;
	const croissance = courant - minimum;
	if (denominateur <= 0 || croissance < SEUIL_CROISSANCE_OCTETS) return dernier;
	const brut = (croissance / denominateur) * 100;
	const borne = Math.max(0, Math.min(99, brut));
	return dernier !== null && borne < dernier ? dernier : borne;
}

/** Arguments de l'installeur assisté d'electron-builder en mode silencieux.
    `/allusers` force le même mode machine que l'utilisateur choisissait dans
    l'ancienne page NSIS. `/D=` est spécial chez NSIS : electron-builder
    26.0.19 le lit comme TOUT ce qui suit, donc il doit rester le dernier. */
export function argumentsNsis(dossier: string): string[] {
	return ["/allusers", "/S", `/D=${dossier}`];
}

/* ─────────── la langue de l'installeur ───────────
   La LANGUE D'AFFICHAGE DE WINDOWS (`app.getLocale()`, dans `main.ts`), et
   rien d'autre — la même source que l'application en mode « auto »
   (`apps/windows/electron/main.ts`) : installeur, application et dialogues
   natifs parlent la même langue sans qu'aucun réglage soit écrit ; qui veut
   autre chose le change dans Réglages.

   Jusqu'à la 1.0.16 la langue « voyageait dans le fichier » : un second nom
   `-fr.exe` pour la page française, puis le flux `Zone.Identifier` du
   navigateur en repli, puis seulement Windows. Deux mécanismes, deux assets,
   et le résultat était MOINS fiable que la langue du système (un exe renommé,
   copié, ou servi par GitHub à qui n'était pas passé par le site retombait
   de toute façon sur Windows). Retiré le 2026-09-15. */

export type LangueInstallateur = "en" | "fr";

/** La langue du système, telle que Chromium la rend (`fr`, `fr-FR`,
    `fr_CA`…) : tout ce qui commence par « fr » est français, le reste
    anglais — l'interface n'a que ces deux langues. */
export function langueDepuisLocale(locale: string): LangueInstallateur {
	return /^fr\b/i.test(locale.replace(/_/g, "-")) ? "fr" : "en";
}

/* ─────────── les pages légales ───────────
   Les deux liens du texte légal ouvrent le SITE, dans la langue de
   l'installeur. La page française vit sous `/fr/`, l'anglaise à la racine,
   comme la page de téléchargement. Le rendu ne transmet que le nom de la
   page (`LienLegal`) : l'URL est composée ICI, depuis deux constantes. */

const SITE = "https://ahmed-mili.github.io/neo-quiz/";
const PAGES_LEGALES = { terms: "terms.html", privacy: "privacy.html" } as const;

export type PageLegale = keyof typeof PAGES_LEGALES;

export function urlLegale(page: PageLegale, langue: LangueInstallateur): string {
	return `${SITE}${langue === "fr" ? "fr/" : ""}${PAGES_LEGALES[page]}`;
}
