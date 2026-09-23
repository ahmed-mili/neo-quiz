/**
 * Le CÂBLAGE D'ENVOI de la tuile vidéo — le parcours coller-puis-Envoyer.
 *
 * Le défaut corrigé ici ne se voyait dans AUCUN typecheck : `prets()`
 * laissait partir la demande SANS le document ET SANS la notice quand le
 * lien venait d'être collé (le débounce de 300 ms n'avait pas encore
 * tranché) ou quand la tuile était née PENDANT l'attente (la lecture de
 * l'état du lecteur encore en vol). La notice est le SEUL canal de vérité
 * de la spec § 5.2 : un envoi sans document ni notice y est un silence
 * interdit — l'utilisateur croyait la transcription partie.
 *
 * Le script charge le CODE RÉEL via load-src.mjs et un hôte vidéo bouchon
 * dont la lecture d'état peut être tenue EN RETARD : c'est exactement la
 * fenêtre à éprouver. `check:web-channel` éprouve de son côté le chemin
 * d'`ai.ts` ; ici, c'est le module de tuile lui-même.
 *
 *     npm run check:video-tile
 */
import { setTimeout as attendre } from "node:timers/promises";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/* La page (et son `window`) n'existe pas ici : le module n'en touche que
   les minuteurs sur les chemins vérifiés (`suivreTexte`, `vider`, `prets`). */
globalThis.window = { setTimeout, clearTimeout };

await withSrcModule("src/dashboard/video-tile.ts", async ({ creerTuilesVideo }) => {
	const r = makeReporter("Tuile vidéo — l'envoi attend, jamais silencieux");
	const LIEN = "regarde https://youtu.be/dQw4w9WgXcQ tout de suite";
	const ID = "dQw4w9WgXcQ";

	/** Un hôte vidéo bouchon. `retardEtat` tient la lecture d'état en
	    retard (la fenêtre « tuile née pendant l'attente ») ; `code` jette
	    le code typé du contrat (la transcription échoue). */
	function hote({ present = true, retardEtat = 0, code = null } = {}) {
		const etat = { present, source: present ? "systeme" : null };
		return {
			video: {
				etat: () => new Promise(ok => setTimeout(() => ok(etat), retardEtat)),
				infosInstallation: async () => ({ version: "2026.08.19", datePublication: null, taille: null, url: "https://github.com/yt-dlp/yt-dlp/releases/latest" }),
				installer: async () => {},
				transcrire: async (id) => {
					if (code) throw { code };
					return { document: "# " + id, nom: "Titre " + id + ".md", titre: "Titre", dureeS: 61, langue: "fr", type: "manuel", miniature: null };
				},
				annuler: () => {},
			},
		};
	}

	/* ── LE PARCOURS PRINCIPAL : coller, puis Envoyer AUSSITÔT ──
	   Le débounce de 300 ms n'a pas tranché : `prets()` doit le faire
	   trancher lui-même, attendre la transcription naissante, et rendre
	   le document. Sans la purge, il rendait { [], 0 } — la demande part
	   sans la transcription, aucun mot ne le dit. */
	{
		const tuiles = creerTuilesVideo({ host: hote({ retardEtat: 0 }), rerendre: () => {}, ouvrirApercu: () => {} });
		tuiles.suivreTexte(LIEN);
		const rendu = await tuiles.prets();
		r.check("coller puis Envoyer dans la fenêtre du débounce : le document part", rendu, {
			jointes: [{ name: "Titre dQw4w9WgXcQ.md", content: "# dQw4w9WgXcQ", source: "video", path: "youtube:dQw4w9WgXcQ" }],
			ecartees: 0,
		});
	}

	/* ── L'AUTRE BRANCHE DU MÊME PARCOURS : la transcription échoue ──
	   La demande part quand même (la spec ne bloque pas), mais elle est
	   COMPÉTÉE écartée — c'est ce compte que la notice d'envoi lit : le
	   silence reste impossible. */
	{
		const tuiles = creerTuilesVideo({ host: hote({ code: "pasDeSousTitres" }), rerendre: () => {}, ouvrirApercu: () => {} });
		tuiles.suivreTexte(LIEN);
		r.check("coller puis Envoyer, transcription échouée : écartée et non muette",
			await tuiles.prets(), { jointes: [], ecartees: 1 });
	}

	/* ── LA TUILE NÉE PENDANT L'ATTENTE (l'état du lecteur en retard) ──
	   Deuxième sous-cas tombé en silence : la tuile est en `lecture` avec
	   sa promesse de transcription encore NULLE — seule la naissance vole.
	   `prets` doit l'attendre aussi, sinon la demande part sans elle. */
	{
		const tuiles = creerTuilesVideo({ host: hote({ retardEtat: 80 }), rerendre: () => {}, ouvrirApercu: () => {} });
		tuiles.suivreTexte(LIEN);
		const rendu = await tuiles.prets();
		r.check("une tuile dont l'état du lecteur répond en retard est attendue", [
			rendu.jointes.length, rendu.jointes[0]?.path, rendu.ecartees,
		], [1, "youtube:dQw4w9WgXcQ", 0]);
	}

	/* ── LA REMISE À NEUF : le débounce ne ressuscite rien ──
	   `vider()` coupe le minuteur ET le texte périmé. Sans le
	   désarmement, le minuteur armé par la frappe tranchait 300 ms plus
	   tard, recréait la tuile SANS UI à venir — et un vrai yt-dlp
	   démarrait que plus personne ne voyait ni n'annulait. */
	{
		const tuiles = creerTuilesVideo({ host: hote(), rerendre: () => {}, ouvrirApercu: () => {} });
		tuiles.suivreTexte(LIEN);
		tuiles.vider();
		await attendre(400); // bien au-delà du débounce de 300 ms
		r.check("après vider(), le minuteur en vol ne recrée aucune tuile",
			await tuiles.prets(), { jointes: [], ecartees: 0 });
	}

	/* ── Une demande sans lien YouTube : rien à attendre, rien à dire ── */
	{
		const tuiles = creerTuilesVideo({ host: hote(), rerendre: () => {}, ouvrirApercu: () => {} });
		tuiles.suivreTexte("une demande ordinaire, sans lien");
		r.check("sans lien YouTube, l'envoi ne bloque pas et ne dit rien",
			await tuiles.prets(), { jointes: [], ecartees: 0 });
	}

	r.done();
});