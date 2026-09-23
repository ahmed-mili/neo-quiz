/* ══════════════════════════════════════════════════════════
   LA TUILE VIDÉO DU COMPOSER — UN LIEN YOUTUBE DEVENU PIÈCE JOINTE

   Tâche 6 des vidéos YouTube (spec
   docs/superpowers/specs/2026-09-22-videos-youtube-design.md,
   § 5, autorité liante). Un lien YouTube écrit dans la demande
   devient une tuile dans le composer ; quand la transcription est
   prête, elle part avec l'envoi comme une `NoteAttachment` ordinaire
   (`source: "video"`, le chemin est un IDENTIFIANT, pas un fichier).
   Les canaux CLI la reçoivent dans le texte du prompt, les canaux web
   comme fichier déposé (`depot.ecrire`) : AUCUN de ces chemins ne
   change — c'est le travail de cette tuile, tout le reste lit déjà
   des notes jointes.

   PURE, comme `ai.ts` : tout passe par le contrat d'hôte — `host.video`
   (`HostVideo`, membre OPTIONNEL), jamais un process ni un disque. Sans
   `host.video` (le greffon Obsidian), le module est INERTE : le retour
   anticipé en tête rend une implémentation à ne rien faire, d'où ni
   tuile ni notice — la spec § 3.3 dit la règle en un mot.

   LES QUATRE ÉTATS de la spec § 5.1 : `lecture` (miniature grise +
   spinner), `prete` (miniature, titre coupé au milieu, durée, badge
   de langue), `installer` (l'outil manque : le geste de l'utilisateur
   ouvre la modale, jamais un téléchargement sans lui), `erreur`
   (message selon le code, « Réessayer » sauf `pasDeSousTitres`).

   LA CROIX retire la tuile DANS TOUS LES ÉTATS et mémorise
   l'identifiant : ce lien n'en recrée pas tant qu'il reste dans le
   texte ; l'identifiant est oublié dès qu'il quitte le texte. Une
   transcription en vol est ABANDONNÉE au passage (`annuler` tue
   l'arbre de yt-dlp dans le principal), et son rejet `annule` arrive
   sur une tuile déjà partie : le retrait est SILENCIEUX, jamais un
   état `erreur` — c'est le geste de l'utilisateur, pas une panne.

   LE DÉBOUNCE de ~300 ms : `suivreTexte` est appelé à chaque frappe,
   les identifiants sont relus sur le texte COURANT au dépassement —
   un lien mal collé puis corrigé ne lance pas deux transcriptions,
   et une tuile dont le lien disparaît du texte est retirée.

   LA NOTICE des autres liens (§ 5.4) suit le MÊME texte : un lien
   http(s) non YouTube y est dit non lu, une ligne discrète, sans
   jamais bloquer l'envoi.
═══════════════════════════════════════════════════════════ */

import type { Host, HostVideo } from "../host/types";
import { ajouter } from "../dom";
import { t, type TransKey } from "../i18n";
import { idYoutube, liensNonLus } from "../video/youtube";
import { ouvrirInstallationVideo } from "./video-install-modal";
import { couperNomAuMilieu } from "./file-icons";
import type { NoteAttachment } from "./ai";

/** Les tuiles vidéo du composer : l'interface que `ai.ts` branche, et
    rien de plus. */
export interface TuilesVideo {
	/** Relit les identifiants du texte courant (débounce ~300 ms) et
	    crée ou retire les tuiles en conséquence. Appelé à chaque frappe
	    ET à chaque rendu du composer — toujours sur le texte vivant. */
	suivreTexte(texte: string): void;
	/** Dessine les tuiles dans la rangée des pièces jointes. Le parent
	    est NEUF à chaque rendu : aucune tuile doublée. */
	rendre(parent: HTMLElement): void;
	/** La ligne discrète des autres liens (spec § 5.4), sous le composer. */
	rendreNotice(parent: HTMLElement): void;
	/** Ce que l'envoi attend de nous (spec § 5.2) : la résolution attend
	    les transcriptions EN VOL, puis rend les documents prêts à joindre
	    et le compte de ce qui ne part pas (erreur, yt-dlp absent). */
	prets(): Promise<{ jointes: NoteAttachment[]; ecartees: number }>;
	/** Annule les transcriptions en vol et oublie tout : la remise à neuf
	    du composer (quiz enregistré, préréglage, fermeture de la vue). */
	vider(): void;
}

/** Ce qu'une transcription rend : la forme DÉRIVÉE du contrat — la
    réécrire à la main divergerait en silence. */
type ResultatVideo = Awaited<ReturnType<HostVideo["transcrire"]>>;

/** Les quatre états de la spec § 5.1. */
type Etat = "lecture" | "prete" | "installer" | "erreur";

/** Une vidéo dont le lien est dans le composer. */
interface Tuile {
	id: string;
	etat: Etat;
	resultat: ResultatVideo | null;
	/** Le code de l'erreur typée du contrat (`erreur` seulement). */
	codeErreur: string | null;
	/** La transcription en vol ; nulle dès qu'elle a tranché. */
	promesse: Promise<void> | null;
}

/** Le pas du débounce : assez court pour suivre la frappe, assez long
    pour qu'une URL tapée en plusieurs morceaux ne lance pas une lecture
    par fragment. */
const DEBOUNCE_MS = 300;

/** Le message de chaque code d'erreur du contrat. `annule` n'y figure
    PAS : une transcription annulée est un retrait silencieux (en tête),
    jamais un état `erreur`. */
const CLES_ERREUR: Record<string, TransKey> = {
	absent: "ai.video.erreur.absent",
	reseau: "ai.video.erreur.reseau",
	pasDeSousTitres: "ai.video.erreur.pasDeSousTitres",
	videoIndisponible: "ai.video.erreur.videoIndisponible",
	delai: "ai.video.erreur.delai",
	inconnue: "ai.video.erreur.inconnue",
};

/** La durée d'une vidéo en `m:ss`, `h:mm:ss` au-delà de l'heure — la
    même grammaire que l'horodatage des paragraphes du document. */
function formaterDuree(dureeS: number): string {
	const h = Math.floor(dureeS / 3600);
	const m = Math.floor((dureeS % 3600) / 60);
	const s = dureeS % 60;
	const minutes = h > 0 ? String(m).padStart(2, "0") : String(m);
	return (h > 0 ? h + ":" : "") + minutes + ":" + String(s).padStart(2, "0");
}

export function creerTuilesVideo(deps: {
	host: Host;
	/** Redessine les zones de la page qui portent les tuiles et la notice
	    — SEULEMENT elles : une tuile qui se règle ne doit ni détruire le
	    champ (le caret y vit) ni fermer un menu ouvert. */
	rerendre: () => void;
	/** L'aperçu d'une pièce jointe prête : LE MÊME que celui d'une note
	    (`ouvrirApercu` de ai.ts, réutilisé, jamais recopié — spec § 5.3). */
	ouvrirApercu(note: NoteAttachment): void;
}): TuilesVideo {
	const host = deps.host;
	/* Sans `host.video`, aucune tuile, aucune notice — le retour anticipé
	   dit la règle de la spec § 3.3 en un seul endroit. */
	if (!host.video) {
		return {
			suivreTexte() { /* inerte */ },
			rendre() { /* inerte */ },
			rendreNotice() { /* inerte */ },
			prets: () => Promise.resolve({ jointes: [], ecartees: 0 }),
			vider() { /* inerte */ },
		};
	}
	const video = host.video;

	/** Les tuiles vivantes, par identifiant. L'ordre d'insertion est
	    l'ordre d'apparition dans le texte — l'ordre d'affichage. */
	const tuiles = new Map<string, Tuile>();
	/** Les identifiants dont la tuile a été retirée PAR LA CROIX : ce lien
	    n'en recrée pas tant qu'il reste dans le texte (en tête). */
	const ecartes = new Set<string>();
	let minuteur: number | null = null;
	/** Le texte SUR LEQUEL le débounce tranchera — mis à jour à chaque
	    appel, relu seul au dépassement (le ruling 5 du brief). */
	let dernierTexte = "";
	/** L'état courant de la notice, pour ne redessiner que sur changement. */
	let noticeAffichee: boolean | null = null;

	function avertir(): void {
		deps.rerendre();
	}

	/** Lance (ou relance) la transcription d'une tuile. Le rejet est un
	    ÉTAT de la tuile, jamais une exception qui remonte : `prets` peut
	    attendre sans craindre de lever. */
	function demarrer(tuile: Tuile): void {
		tuile.etat = "lecture";
		tuile.codeErreur = null;
		avertir();
		tuile.promesse = video.transcrire(tuile.id).then((r) => {
			tuile.promesse = null;
			if (tuiles.get(tuile.id) !== tuile) return; // retirée entre-temps
			tuile.resultat = r;
			tuile.etat = "prete";
			avertir();
		}).catch((e: unknown) => {
			tuile.promesse = null;
			if (tuiles.get(tuile.id) !== tuile) return;
			const code = (e as { code?: string } | null)?.code ?? "inconnue";
			/* « annule » : l'abandon d'une croix (ou d'un retrait du texte)
			   arrive ICI, sur une tuile déjà partie ou à retirer en silence. */
			if (code === "annule") { retirer(tuile.id, false); avertir(); return; }
			tuile.codeErreur = code;
			tuile.etat = "erreur";
			avertir();
		});
	}

	/** Retire une tuile — en abandonnant sa transcription en vol. Ne
	    redessine pas : les appelants regroupent (le débounce peut retirer
	    PLUSIEURS tuiles d'un coup). */
	function retirer(id: string, parCroix: boolean): void {
		const tuile = tuiles.get(id);
		if (!tuile) return;
		if (tuile.etat === "lecture") video.annuler(id);
		tuiles.delete(id);
		if (parCroix) ecartes.add(id);
	}

	/** La naissance d'une tuile : l'état du lecteur est lu À L'ARRIVÉE du
	    lien (le ruling 1), jamais sondé en boucle. Lecteur présent → la
	    transcription part d'elle-même ; absent → l'état `installer`, le
	    geste de l'utilisateur (spec § 2) ouvrira la modale. */
	function naitre(id: string): void {
		const tuile: Tuile = { id, etat: "lecture", resultat: null, codeErreur: null, promesse: null };
		tuiles.set(id, tuile);
		void video.etat().then((e) => {
			if (tuiles.get(id) !== tuile) return;
			if (e.present) demarrer(tuile);
			else { tuile.etat = "installer"; avertir(); }
		}).catch(() => {
			/* Un état illisible n'est pas un lecteur confirmé : c'est le
			   geste de l'utilisateur qui tranche, jamais un lancement. */
			if (tuiles.get(id) !== tuile) return;
			tuile.etat = "installer";
			avertir();
		});
	}

	/** Le débounce a tranché : relit les identifiants sur le texte COURANT,
	    retire les tuiles dont le lien a disparu, crée celles qui sont
	    nées, et suit la notice. Un seul redraw, groupé. */
	function recompter(): void {
		minuteur = null;
		const presents = new Set(idYoutube(dernierTexte));
		/* Un écart mémorisé n'a plus de sens quand son lien a quitté le
		   texte : le recoller recrée la tuile, la spec le dit ainsi. */
		for (const id of [...ecartes]) if (!presents.has(id)) ecartes.delete(id);
		let change = false;
		for (const id of [...tuiles.keys()]) {
			if (presents.has(id)) continue;
			retirer(id, false);
			change = true;
		}
		for (const id of presents) {
			if (tuiles.has(id) || ecartes.has(id)) continue;
			naitre(id);
			change = true;
		}
		/* La notice suit le TEXTE, pas les tuiles : un lien non YouTube
		   collé sans aucun lien YouTube doit la faire arriver aussi. */
		const notice = liensNonLus(dernierTexte).length > 0;
		if (change || notice !== noticeAffichee) avertir();
		noticeAffichee = notice;
	}

	/** La pièce jointe d'une vidéo prête : une NoteAttachment ORDINAIRE.
	    `path` est un identifiant (`youtube:<id>`) — jamais un fichier :
	    l'aperçu l'affiche tel quel, le canal web passe par `depot.ecrire`. */
	function pieceDe(tuile: Tuile): NoteAttachment {
		const r = tuile.resultat as NonNullable<ResultatVideo>;
		return {
			name: r.nom,
			content: r.document,
			source: "video",
			path: "youtube:" + tuile.id,
			thumb: r.miniature ?? undefined,
		};
	}

	/** Le badge de langue : le CODE brut de la piste (« fr », « pt-BR ») et
	    son TYPE traduit (ruling 4). Langue absente du flux : le type seul. */
	function badgeDe(tuile: Tuile): string {
		const r = tuile.resultat as NonNullable<ResultatVideo>;
		const type = t(r.type === "auto" ? "ai.video.badge.auto" : "ai.video.badge.manuel");
		return r.langue ? r.langue + " · " + type : type;
	}

	/** Une carte de la même famille que les chips (même bande, même croix).
	    Un clic sur une carte PRÊTE ouvre l'aperçu du document (spec § 5.3),
	    le même que celui d'une note jointe. */
	function poser(parent: HTMLElement, tuile: Tuile): void {
		const carte = ajouter(parent, "div", "qbd-ai-video-tile");
		carte.dataset.etat = tuile.etat;
		const r = tuile.resultat;
		if (tuile.etat === "prete" && r) {
			const bande = ajouter(carte, "div", "qbd-ai-video-tile-thumb");
			/* L'infobulle natif porte le nom ENTIER, comme sur une chip. */
			carte.title = r.nom;
			if (r.miniature) {
				const img = ajouter(bande, "img", "qbd-ai-video-tile-thumb-img");
				img.src = r.miniature;
				img.alt = "";
				img.draggable = false;
			}
			const info = ajouter(carte, "div", "qbd-ai-video-tile-info");
			/* LE TYPE DU FICHIER RESTE TOUJOURS VISIBLE (règle du dépôt) :
			   coupe AU MILIEU, partagée avec la pile du canal web
			   (`couperNomAuMilieu`, file-icons.ts) — la règle vit là-bas. */
			const nom = ajouter(info, "span", "qbd-ai-video-tile-nom");
			const { tete, queue } = couperNomAuMilieu(r.nom);
			ajouter(nom, "span", "qbd-ai-video-tile-nom-tete", tete);
			if (queue) ajouter(nom, "span", "qbd-ai-video-tile-nom-queue", queue);
			const duree = r.dureeS !== null ? formaterDuree(r.dureeS) : null;
			const meta = [duree, badgeDe(tuile)].filter(Boolean).join(" · ");
			ajouter(info, "div", "qbd-ai-video-tile-meta", meta);
			carte.addEventListener("click", (e) => {
				if ((e.target as HTMLElement).closest(".qbd-ai-video-tile-remove")) return;
				deps.ouvrirApercu(pieceDe(tuile));
			});
		} else if (tuile.etat === "lecture") {
			/* Miniature GRISE + spinner, la légende dessous (spec § 5.1).
			   Les états `installer` et `erreur` n'ont PAS de bande : leur
			   message remplirait un bandeau vide au-dessus. */
			const bande = ajouter(carte, "div", "qbd-ai-video-tile-thumb is-vide");
			ajouter(bande, "div", "qbd-install-spinner");
			ajouter(carte, "div", "qbd-ai-video-tile-msg", t("ai.video.reading"));
		} else if (tuile.etat === "installer") {
			const msg = ajouter(carte, "div", "qbd-ai-video-tile-msg");
			ajouter(msg, "span", "qbd-ai-video-tile-texte", t("ai.video.installer"));
			const pilule = ajouter(msg, "button", "qbd-ai-video-tile-pilule");
			pilule.type = "button";
			host.ui.setIcon(ajouter(pilule, "span", "qbd-ai-video-tile-pilule-icone"), "download");
			ajouter(pilule, "span", undefined, t("ai.video.installButton"));
			/* LE GESTE de l'utilisateur (décision de la spec § 2) : la modale
			   explique avant d'installer ; à son succès, TOUTES les tuiles en
			   attente démarrent (le ruling 1). */
			pilule.addEventListener("click", () => {
				ouvrirInstallationVideo({
					host,
					surInstalle: () => {
						for (const enAttente of [...tuiles.values()]) {
							if (enAttente.etat === "installer") demarrer(enAttente);
						}
					},
				});
			});
		} else {
			const msg = ajouter(carte, "div", "qbd-ai-video-tile-msg");
			ajouter(msg, "span", "qbd-ai-video-tile-texte",
				t(CLES_ERREUR[tuile.codeErreur ?? ""] ?? "ai.video.erreur.inconnue"));
			/* « Réessayer » SAUF `pasDeSousTitres` (spec § 5.1) : relancer
			   une vidéo sans transcription donnerait le même néant. */
			if (tuile.codeErreur !== "pasDeSousTitres") {
				const reessayer = ajouter(msg, "button", "qbd-ai-video-tile-reessayer");
				reessayer.type = "button";
				ajouter(reessayer, "span", undefined, t("ai.video.retry"));
				reessayer.addEventListener("click", () => demarrer(tuile));
			}
		}
		const croix = ajouter(carte, "button", "qbd-ai-video-tile-remove");
		croix.type = "button";
		host.ui.setIcon(croix, "x");
		ajouter(croix, "span", "qbd-sr-only", t("ai.video.remove"));
		croix.addEventListener("click", (e) => {
			e.stopPropagation(); // ne déclenche ni l'aperçu ni le basculement
			retirer(tuile.id, true);
			avertir();
		});
	}

	return {
		suivreTexte(texte: string): void {
			dernierTexte = texte;
			if (minuteur !== null) window.clearTimeout(minuteur);
			minuteur = window.setTimeout(recompter, DEBOUNCE_MS);
		},
		rendre(parent: HTMLElement): void {
			parent.replaceChildren();
			for (const tuile of tuiles.values()) poser(parent, tuile);
		},
		rendreNotice(zone: HTMLElement): void {
			zone.replaceChildren();
			const visible = liensNonLus(dernierTexte).length > 0;
			noticeAffichee = visible;
			if (!visible) return;
			/* UNE ligne, discrète, jamais bloquante (spec § 5.4). */
			const ligne = ajouter(zone, "span", "qbd-ai-video-notice-ligne");
			host.ui.setIcon(ajouter(ligne, "span", "qbd-ai-video-notice-icone"), "info");
			ajouter(ligne, "span", undefined, t("ai.video.otherLinks"));
		},
		async prets(): Promise<{ jointes: NoteAttachment[]; ecartees: number }> {
			/* L'envoi ATTEND les transcriptions en vol (spec § 5.2) ; elles
			   ne lèvent jamais — l'échec est un état de la tuile. Un
			   instantané : une tuile installée pendant l'attente ne la
			   repousse pas, elle compte déjà comme écartée. */
			await Promise.all(
				[...tuiles.values()]
					.filter(x => x.etat === "lecture")
					.map(x => x.promesse ?? Promise.resolve()),
			);
			const jointes: NoteAttachment[] = [];
			let ecartees = 0;
			for (const tuile of tuiles.values()) {
				if (tuile.etat === "prete" && tuile.resultat) jointes.push(pieceDe(tuile));
				else if (tuile.etat === "erreur" || tuile.etat === "installer") ecartees++;
			}
			return { jointes, ecartees };
		},
		vider(): void {
			/* Le débounce aussi, en même temps que les transcriptions en vol
			   qu'il annule déjà : sans ça, le minuteur en vol relisait le
			   texte PÉRIMÉ après la remise à neuf, recréait des tuiles sans
			   aucune UI à venir (plus de rendu, plus de croix) — jusqu'à
			   lancer un vrai yt-dlp que plus personne ne voit ni n'annule. */
			if (minuteur !== null) { window.clearTimeout(minuteur); minuteur = null; }
			dernierTexte = "";
			noticeAffichee = false;
			for (const tuile of tuiles.values()) {
				if (tuile.etat === "lecture") video.annuler(tuile.id);
			}
			tuiles.clear();
			ecartes.clear();
			/* Pas de redessin : les appelants (remise à neuf, fermeture de la
			   vue) redessinent ou quittent la page juste après. */
		},
	};
}