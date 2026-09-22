/* ══════════════════════════════════════════════════════════
   L'HÔTE WINDOWS — LA LECTURE D'UNE VIDÉO, UN PASSE-PLAT
   VERS LE PRINCIPAL

   Tâche 4 des vidéos YouTube (spec
   docs/superpowers/specs/2026-09-22-videos-youtube-design.md,
   § 3.3). `HostVideo` (`src/host/types.ts`) côté RENDU : ce module ne
   touche AUCUN fichier et ne lance AUCUN process — il n'en a ni le
   droit ni les moyens (`require` n'existe pas ici, `contextIsolation`
   et `sandbox` le retirent). Il traduit chaque appel en un canal du
   pont (`video.*`), et c'est le PRINCIPAL qui résout l'exécutable,
   lance yt-dlp et tient le périmètre
   (`apps/windows/electron/video.ts`).

   LES DEUX CHOSES QUI SONT À NOUS ICI :

   1. L'ABONNEMENT À LA PROGRESSION, AVANT l'appel d'installation :
      les octets arrivent par un canal POUSSÉ
      (`neo:video/progression`), car un rappel ne traverse pas l'IPC
      (voir `Pont.video`) — le même ordre que l'attente d'un collage
      (`collage.ts`), et le désabonnement en `finally`.

   2. LE CODE DE L'ERREUR. `transcrire` et `installer` traversent en
      ENVELOPPE (`EnveloppeVideo`, pont.ts) parce que l'IPC d'Electron
      perd le `name` d'une erreur jetée — et tout le jugement de la
      tuile (tâche 6) tient dans ce code. Ce module le RECONSTRUIT,
      et c'est le seul endroit du rendu qui le fasse : sans lui,
      « vidéo privée » arriverait dans la page sous le nom « Error »,
      donc traitée comme une panne inconnue.

   L'ANNULATION, elle, ne tient à rien d'autre qu'un canal :
   `annuler(id)` relaie l'identifiant, et le principal abandonne les
   transcriptions vivantes de CETTE vidéo — l'arbre de yt-dlp est tué
   là-bas (`video.ts`), ici il n'y a ni process ni arbre.
═══════════════════════════════════════════════════════════ */

import type { HostVideo } from "../../../../src/host/types";
import type { EnveloppeVideo, Pont } from "../../electron/pont";

/** Une erreur dont le `code` est celui que la spec nomme, reconstruite
    depuis l'enveloppe du canal. Le `detail`, lui, est du JOURNAL
    (stderr, jamais traduit) que l'appelant peut journaliser. */
export interface ErreurVideo extends Error {
	code: string;
	detail?: string;
}

function erreurVideo(code: string, message: string, detail?: string): ErreurVideo {
	const e = new Error(message) as ErreurVideo;
	e.name = code;
	e.code = code;
	if (detail) e.detail = detail;
	return e;
}

/** Débarrasse une enveloppe du pont de son `ok` : la valeur, ou une
    erreur dont le `name` ET le `code` portent celui du principal —
    comme `erreurCli` (`process.ts`) reconstruit le nom d'un CLI. */
function depaquer<Valeur, Code extends string>(env: EnveloppeVideo<Valeur, Code>): Valeur {
	if (env.ok) return env.valeur;
	throw erreurVideo(env.code, "video : " + env.code, env.detail);
}

export function createWindowsVideo(pont: () => Pont): HostVideo {
	return {
		etat: () => pont().video.etat(),
		infosInstallation: () => pont().video.infosInstallation(),
		/* S'abonner à la progression SE FAIT DANS LE PRÉCHARGEMENT (le
		   canal poussé n'expose pas d'abonnement au rendu) : le rappel
		   traverse l'invoke lui-même, et `preload.ts` le pose sur le
		   canal `videoProgression` AVANT d'invoquer. Rien n'est à nous
		   ici, si ce n'est le re-typage du rejet. */
		installer(surProgression) {
			return pont().video.installer(surProgression).then(env => {
				depaquer(env);
			});
		},
		async transcrire(id) {
			return depaquer(await pont().video.transcrire(id));
		},
		/* L'abandon ne rend RIEN à attendre : le principal abandonne
		   les transcriptions vivantes de cet identifiant, et chacune
		   rejette `{ code: "annule" }` — la tuile le traite en
		   silence (tâche 6), jamais une promesse orpheline àAwaiter. */
		annuler(id) {
			void pont().video.annuler(id);
		},
	};
}