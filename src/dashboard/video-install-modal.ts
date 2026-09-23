/* ══════════════════════════════════════════════════════════
   LA MODALE D'INSTALLATION DE YT-DLP — LE POURQUOI AVANT LE CLIC

   Tâche 5 des vidéos YouTube (spec
   docs/superpowers/specs/2026-09-22-videos-youtube-design.md,
   § 4, autorité liante pour le CONTENU). Le contenu est celui de la
   spec, dans son ordre : ce qu'est yt-dlp, ce qu'il fait ICI et
   seulement ça, pourquoi, d'où il vient. La STRUCTURE et les classes
   sont celles de `ai-install-modal.ts` (l'apparence commune des
   modales, la coche, la fermeture une seconde et demie après elle) —
   jamais son texte.

   Trois états, posés sur `dataset.state` du panneau comme dans la
   modale des CLI : `initial` (les deux boutons), `en-cours` (la jauge,
   les boutons effacés — l'installation n'est pas annulable, le contrat
   `HostVideo.installer` n'offre pas d'abandon : cacher « Annuler »
   pendant le téléchargement est le reflet honnête de ça), `detecte`
   (la coche, puis la fermeture seule). Une erreur REMET les boutons :
   réessayer, c'est recliquer « Installer ».

   LA FERMETURE PAR ÉCHAP OU PAR LE FOND pendant le téléchargement ne
   coupe rien : le téléchargement vit dans le processus principal. À
   la résolution, si la modale est déjà partie, la page est quand
   même prévenue (`surInstalle`) — l'installation a réussi, les tuiles
   en attente ont le droit de démarrer, qu'on ait regardé ou non.

   LA TAILLE INCONNUE ne s'affiche PAS : une ligne « 0 o » pour une
   taille ignorée serait un mensonge (revue du 2026-09-23, bloquant) ;
   le contrat rend `null` et la modale omet la ligne. Idem pour la
   jauge : un `total` inconnu la laisse indéterminée, jamais 100 %.
═══════════════════════════════════════════════════════════ */
import type { Host, HostVideo } from "../host/types";
import { LOG_PREFIX } from "../branding";
import { ajouter } from "../dom";
import { requireHost } from "../host/current";
import { currentLang, t, type TransKey } from "../i18n";
import { poserOnde } from "./onde";

/* La date de CRÉATION du dépôt yt-dlp : le `created_at` que rend l'API
   GitHub pour `yt-dlp/yt-dlp`, vérifié le 2026-09-22 — un fait
   immuable, codé en dur comme le dit la spec § 4. */
const CREATION_YT_DLP = "2020-10-26";

/* L'URL de la release : le même lien que le principal (`URL_LATEST` de
   `video-installation.ts`, dont le contrat garantit qu'`infos.url` le
   porte). Posé ici parce que le lien est cliquable AVANT même que
   `infosInstallation()` ait répondu — et qu'il reste cliquable quand
   elle ne répond jamais (hors ligne). */
const URL_RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest";

/* La fermeture SEULE, une seconde et demie après la coche : la même
   valeur que `ai-install-modal.ts` (les CLI) — l'utilisateur a ouvert
   la modale pour UTILISER l'outil, pas pour cliquer une fois de plus. */
const FERMETURE_MS = 1500;

export interface InstallationVideoDeps {
	host: Host;
	/** Appelé au SUCCÈS de l'installation, après la coche et la
	    fermeture : les tuiles « Installer » en attente démarrent leur
	    transcription. Aussi appelé si la modale a été fermée pendant le
	    téléchargement qui, lui, a fini par réussir. */
	surInstalle: () => void;
}

/** La forme des infos, DÉRIVÉE du contrat (`HostVideo`) : la réécrire à
    la main divergerait en silence, et `src/` ne peut pas importer le
    module du processus principal qui la nomme. */
type InfosRelease = Awaited<ReturnType<HostVideo["infosInstallation"]>>;

/** Une date ISO AAAA-MM-JJ dans la langue de l'UI, `long` (« 26 October
    2020 » / « 26 octobre 2020 »). Le midi local évite le décalage de
    fuseau d'un `Date` ISO lu à minuit UTC : le 26 eût pu devenir le 25
    sur un poste d'Amérique. */
function formaterDate(iso: string): string {
	return new Intl.DateTimeFormat(currentLang(), { dateStyle: "long" })
		.format(new Date(iso + "T12:00:00"));
}

/** La taille en mégaoctets, UNE décimale, dans la langue de l'UI —
    « 17.8 » / « 17,8 » pour 17 832 140 octets. Le mégaoctet vaut
    1 000 000 d'octets (c'est l'exemple de la spec qui le fixe) ; l'unité
    (MB / Mo) vit dans le libellé traduit, jamais ici. */
function formaterTaille(octets: number): string {
	return new Intl.NumberFormat(currentLang(), {
		minimumFractionDigits: 1,
		maximumFractionDigits: 1,
	}).format(octets / 1_000_000);
}

/** Les infos de la release, lues À L'OUVERTURE, et la ligne de version
    remplie quand elles arrivent. `version` null (hors ligne) : la ligne
    dit « dernière version publiée » et la modale reste utilisable. */
function remplirVersions(zone: HTMLElement, video: HostVideo, poserInfos: (i: InfosRelease) => void): void {
	void video.infosInstallation().then((infos: InfosRelease) => {
		if (!zone.isConnected) return; // la modale est déjà fermée
		poserInfos(infos);
		zone.replaceChildren();
		if (!infos.version) {
			ajouter(zone, "div", undefined, t("ai.video.modal.versionInconnue"));
			return;
		}
		ajouter(zone, "div", undefined, t("ai.video.modal.version", {
			version: infos.version,
			date: infos.datePublication ? formaterDate(infos.datePublication) : "",
		}));
		/* La ligne de taille ne s'affiche QUE si elle est connue : jamais
		   « 0 o » pour une taille ignorée (revue du 2026-09-23). */
		if (infos.taille !== null) {
			ajouter(zone, "div", undefined, t("ai.video.modal.taille", {
				taille: formaterTaille(infos.taille),
			}));
		}
	}).catch((e: unknown) => {
		// Le contrat ne rejette pas ; un hôte fautif n'a pas à bloquer la modale.
		console.warn(LOG_PREFIX, "infos de la release yt-dlp illisibles :", e);
	});
}

export function ouvrirInstallationVideo(deps: InstallationVideoDeps): void {
	requireHost("modals").open({
		className: "qbd-video-install-modal",
		title: t("ai.video.modal.title"),
		titleIcon: (el) => { deps.host.ui.setIcon(el, "play"); },
		onOpen: (m) => {
			const c = m.contentEl;
			m.panelEl.dataset.state = "initial";
			/* L'hôte ne possède `video` que dans l'application, et la tuile qui
			   ouvre cette modale (tâche 6) ne l'appelle QUE quand le membre
			   existe — aucune branche de repli ici, un hôte sans `video` ne
			   peut jamais y entrer. */
			const video = deps.host.video!;

			/* ── LE CONTENU DE LA SPEC § 4, dans son ordre ── */
			ajouter(c, "p", "qbd-video-install-quoi",
				t("ai.video.modal.quoi", { date: formaterDate(CREATION_YT_DLP) }));
			ajouter(c, "p", "qbd-video-install-role", t("ai.video.modal.role"));
			ajouter(c, "p", "qbd-video-install-pourquoi", t("ai.video.modal.pourquoi"));

			/* ── D'OÙ IL VIENT ──
			   Le lien est posé par l'HÔTE au clic, comme partout ailleurs :
			   un `target="_blank"` du DOM ne mène nulle part dans la fenêtre
			   de l'app, qui n'a pas de navigateur d'onglets. */
			const source = ajouter(c, "div", "qbd-video-install-source");
			let infos: InfosRelease | null = null;
			const lien = ajouter(source, "a", "qbd-video-install-lien", t("ai.video.modal.lien"));
			lien.href = URL_RELEASE;
			lien.addEventListener("click", (e) => {
				e.preventDefault();
				void deps.host.shell.openUrl(infos?.url ?? URL_RELEASE);
			});
			const versions = ajouter(source, "div", "qbd-video-install-lignes");
			remplirVersions(versions, video, (i) => { infos = i; });
			ajouter(source, "div", "qbd-video-install-fixe", t("ai.video.modal.installation"));

			/* La zone d'état : la jauge, la coche, ou l'erreur expliquée.
			   Vide à l'ouverture, sans fond (le sélecteur `:not(:empty)`). */
			const etat = ajouter(c, "div", "qbd-video-install-etat");

			/* ── LES BOUTONS ── */
			let lancee = false;
			const actions = ajouter(c, "div", "qbd-video-install-actions");
			const bouton = ajouter(actions, "button", "qbd-btn--create");
			bouton.type = "button";
			poserOnde(bouton);
			deps.host.ui.setIcon(ajouter(bouton, "span", "qbd-btn-icon"), "download");
			ajouter(bouton, "span", undefined, t("ai.video.modal.installer"));
			const annuler = ajouter(actions, "button", "qbd-video-install-annuler", t("ai.video.modal.annuler"));
			annuler.type = "button";
			annuler.addEventListener("click", () => m.close());

			bouton.addEventListener("click", () => {
				if (lancee) return;
				lancee = true;
				m.panelEl.dataset.state = "en-cours";
				etat.replaceChildren();
				/* La jauge, animée par la progression en OCTETS du contrat ;
				   le total inconnu (`null`) la laisse indéterminée — jamais
				   un 100 % de travers (revue du 2026-09-23). */
				const barre = ajouter(etat, "div", "qbd-video-install-jauge");
				const plein = ajouter(barre, "div", "qbd-video-install-jauge-plein");
				const ligne = ajouter(etat, "div", "qbd-video-install-progression");
				ajouter(ligne, "span", "qbd-video-install-texte", t("ai.video.modal.progression"));
				const pourcent = ajouter(ligne, "span", "qbd-video-install-pourcent");
				video.installer((recus, total) => {
					if (!etat.isConnected) return;
					if (total === null) {
						barre.classList.add("qbd-video-install-jauge--indeterminee");
						plein.style.width = "";
						pourcent.textContent = "";
						return;
					}
					barre.classList.remove("qbd-video-install-jauge--indeterminee");
					const p = Math.min(100, Math.round((recus / total) * 100));
					plein.style.width = p + "%";
					pourcent.textContent = t("ai.video.modal.pourcent", { percent: p });
				}).then(() => {
					/* LA COCHE, puis la fermeture SEULE une seconde et demie
					   après — comme les CLI. `surInstalle` part même si la
					   modale a été fermée pendant le téléchargement : l'outil
					   est là, les tuiles peuvent démarrer. */
					m.panelEl.dataset.state = "detecte";
					etat.replaceChildren();
					const coche = ajouter(etat, "div", "qbd-video-install-ligne-coche");
					deps.host.ui.setIcon(ajouter(coche, "span", "qbd-install-check"), "check");
					ajouter(coche, "span", undefined, t("ai.video.modal.installe"));
					if (!etat.isConnected) { deps.surInstalle(); return; }
					window.setTimeout(() => { m.close(); deps.surInstalle(); }, FERMETURE_MS);
				}).catch((e: unknown) => {
					if (!etat.isConnected) {
						console.warn(LOG_PREFIX, "installation yt-dlp échouée après fermeture :", e);
						return;
					}
					/* L'ERREUR EXPLIQUÉE DANS LA MODALE, jamais une Notice :
					   le code typé du contrat porte la décision, la phrase est
					   le travail de la modale. Les boutons reviennent —
					   réessayer, c'est recliquer « Installer ». */
					lancee = false;
					m.panelEl.dataset.state = "initial";
					etat.replaceChildren();
					const code = (e as { code?: string })?.code;
					let cle: TransKey;
					if (code === "reseau") cle = "ai.video.modal.erreur.reseau";
					else if (code === "empreinte") cle = "ai.video.modal.erreur.empreinte";
					else cle = "ai.video.modal.erreur.inconnue";
					const ligneErreur = ajouter(etat, "div", "qbd-video-install-erreur");
					deps.host.ui.setIcon(ajouter(ligneErreur, "span", "qbd-video-install-erreur-icone"), "triangle-alert");
					ajouter(ligneErreur, "span", undefined, t(cle));
				});
			});
		},
		/* PAS de onClose à couper : la jauge meurt avec le DOM (le rappel
		   relit `isConnected`), et le minuteur de fermeture n'appelle que
		   `close()` et `surInstalle()` — tous deux sûrs sur une modale
		   déjà partie. */
	});
}