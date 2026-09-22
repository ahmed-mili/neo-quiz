/**
 * Vérification du NOYAU PUR des vidéos YouTube (src/video/).
 *
 * Même raison que check:scheduler : la RÈGLE de la piste (manuelle dans la
 * langue de la vidéo, sinon automatique `-orig`, JAMAIS une piste traduite)
 * est de la logique qu'une relecture ne suffit pas à juger — l'acceptation
 * d'une piste traduite n'apparaît dans aucun typecheck, elle fait jour au
 * moment où le modèle lit une transcription qui n'est pas celle de la vidéo.
 * Le script charge le CODE RÉEL via load-src.mjs et des FIXTURES réduites,
 * capturées avec yt-dlp (2026.08.19) le 2026-09-22.
 *
 *     npm run check:video
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { withSrcModule, makeReporter } from "./lib/load-src.mjs";

/* ── PURETÉ ──
   Le noyau tourne hors d'Obsidian, sans Node (le rendu de l'application
   l'importe tel quel), sans DOM et sans horloge : un id, des clés de pistes
   et du json3 sont des ENTRÉES. `check:host` tient la frontière des imports
   sur tout `src/` ; ici le filet est doublé au niveau du dossier, y compris
   contre une horloge cachée qui rendrait le texte dépendant du moment. */
{
	const r = makeReporter("Vidéos — pureté du noyau");
	const INTERDITS = [
		[/from\s+["']obsidian["']/, "import obsidian"],
		[/from\s+["']node:/, "import node:"],
		[/\brequire\s*\(/, "require()"],
		[/\bdocument\./, "document"],
		[/\bwindow\./, "window"],
		[/\bDate\.now\s*\(/, "Date.now()"],
		[/\bnew\s+Date\s*\(/, "new Date()"],
		[/\bMath\.random\s*\(/, "Math.random()"],
	];
	const dir = "src/video";
	for (const f of readdirSync(dir).filter(n => n.endsWith(".ts"))) {
		const src = readFileSync(join(dir, f), "utf8");
		for (const [re, nom] of INTERDITS) {
			r.check(`${f} sans ${nom}`, re.test(src), false);
		}
	}
	r.done();
}

const fixture = (nom) => JSON.parse(readFileSync(join("scripts/fixtures/video", nom), "utf8"));
const en = fixture("en.json");
const fr = fixture("fr.json");
const json3 = fixture("fr-orig.json3.json");

await withSrcModule(
	["src/video/youtube.ts", "src/video/piste.ts", "src/video/texte.ts", "src/video/document.ts"],
	(yt, piste, texte, document) => {
		const r = makeReporter("Noyau des vidéos YouTube");

		/* ── LIENS ──
		   Les cinq formes que la sonde a mesurées sur de vraies pages
		   YouTube : `watch` (avec ses paramètres qui suivent), `youtu.be`,
		   l'hôte mobile, et les chemins `/shorts/` et `/live/`. */
		r.check("les cinq formes de lien YouTube",
			yt.idYoutube([
				"https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3s",
				"https://youtu.be/dQw4w9WgXcQ?si=x",
				"https://m.youtube.com/watch?v=nh9e18bXpzc",
				"https://www.youtube.com/shorts/nh9e18bXpzc",
				"https://www.youtube.com/live/nh9e18bXpzc",
			].join("\n")),
			["dQw4w9WgXcQ", "nh9e18bXpzc"]);
		/* Le même identifiant arrive par deux formes : la tuile est UNE,
		   pas deux — sans l'unicité, deux transcriptions de la même vidéo. */
		r.check("un doublon est compté une fois, ordre d'apparition conservé",
			yt.idYoutube("regarde https://youtu.be/nh9e18bXpzc puis https://www.youtube.com/watch?v=dQw4w9WgXcQ et encore https://youtu.be/nh9e18bXpzc"),
			["nh9e18bXpzc", "dQw4w9WgXcQ"]);
		r.check("un identifiant de 10 ou 15 caractères n'en est pas un", [
			yt.idYoutube("https://www.youtube.com/watch?v=tropcourt0"),
			yt.idYoutube("https://www.youtube.com/watch?v=bien_trop_long1"),
		], [[], []]);
		/* Un lien non YouTube ne doit PAS disparaître : c'est ce que la
		   notice « ce lien ne sera pas lu » doit afficher (spec §5.4). */
		r.check("hors YouTube : aucun identifiant, mais le lien reste non lu", [
			yt.idYoutube("regarde https://vimeo.com/1 et https://example.com/page?a=b"),
			yt.liensNonLus("regarde https://vimeo.com/1 et https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
		], [[], ["https://vimeo.com/1"]]);

		/* LA PONCTUATION QUI FERME UNE PHRASE n'est pas l'URL : « résume
		   https://youtu.be/x. » est la façon NORMALE d'écrire un lien dans
		   une phrase. Sans le retrait, l'identifiant porterait le point,
		   serait rejeté par `ID_VIDEO`, et la vidéo serait ignorée en
		   silence. La ponctuation sort aussi des liens non lus — la notice
		   ne va pas répéter le point au lecteur. */
		r.check("un lien suivi d'une ponctuation est reconnu", [
			yt.idYoutube("résume https://youtu.be/dQw4w9WgXcQ."),
			yt.idYoutube("https://www.youtube.com/watch?v=dQw4w9WgXcQ, puis"),
			yt.idYoutube("« regarde https://youtu.be/nh9e18bXpzc», dit-il."),
			yt.liensNonLus("voir https://vimeo.com/1."),
		], [
			["dQw4w9WgXcQ"],
			["dQw4w9WgXcQ"],
			["nh9e18bXpzc"],
			["https://vimeo.com/1"],
		]);

		/* ── LA RÈGLE DE LA PISTE ──
		   Fixture réelle : vidéo anglaise à sous-titres manuels (`en`), vidéo
		   française sans aucun manuel mais avec `fr-orig`. Les clés de langue
		   des fixtures sont TOUTES conservées : c'est elles que la règle juge. */
		r.check("vidéo anglaise : la piste manuelle dans sa langue",
			piste.choisirPiste(en),
			{ cle: "en", type: "manuel", langue: "en" });
		r.check("vidéo française sans manuels : la piste automatique d'origine",
			piste.choisirPiste(fr),
			{ cle: "fr-orig", type: "auto", langue: "fr" });

		/* JAMAIS TRADUITE : pour une vidéo française, `en` et `de` des pistes
		   automatiques sont des TRADUCTIONS de `fr-orig`. Les prendre ici
		   joindrait au prompt une transcription qui n'est pas celle de la
		   vidéo — le cas qui rend ce test discriminant (le casser rougit). */
		r.check("jamais une piste traduite",
			piste.choisirPiste({ language: "fr", subtitles: {}, automatic_captions: { en: [], de: [] } }),
			null);
		r.check("sans langue : la seule piste -orig",
			piste.choisirPiste({ language: null, subtitles: {}, automatic_captions: { "ja-orig": [], en: [] } }),
			{ cle: "ja-orig", type: "auto", langue: "ja" });
		r.check("sans langue : deux -orig, aucune n'est LA piste",
			piste.choisirPiste({ language: null, subtitles: {}, automatic_captions: { "ja-orig": [], "en-orig": [] } }),
			null);
		r.check("variante régionale des manuels",
			piste.choisirPiste({ language: "pt", subtitles: { "pt-BR": [] } }),
			{ cle: "pt-BR", type: "manuel", langue: "pt" });
		r.check("sans langue : un seul jeu manuel, lui seul",
			piste.choisirPiste({ language: null, subtitles: { fr: [] }, automatic_captions: {} }),
			{ cle: "fr", type: "manuel", langue: "fr" });
		/* Le salon live n'est pas des sous-titres : sans le filtre, une vidéo
		   à sous-titres manuels + live_chat pourrait choisir le salon. */
		r.check("live_chat n'est jamais une piste",
			piste.choisirPiste({ language: "fr", subtitles: { live_chat: [] } }),
			null);

		/* ── TEXTE PROPRE ──
		   La fixture réelle : 40 événements sur 41 s, un seul paragraphe. */
		const transcription = texte.json3VersTexte(json3);
		r.check("non vide et préfixé [00:00]", [
			transcription.length > 0,
			transcription.startsWith("[00:00]"),
		], [true, true]);
		r.check("les paragraphes sont séparés par UNE ligne vide, pas deux",
			transcription.includes("\n\n\n"),
			false);
		/* SYNTHÉTIQUE (la fixture n'a aucune répétition consécutive — sans
		   ce cas, supprimer la déduplication laisserait tout vert) : un
		   segment répété est absorbé, et 70 s plus tard un paragraphe neuf
		   s'ouvre préfixé de SON horodatage. */
		r.check("répétition absorbée, paragraphe neuf après 60 s",
			texte.json3VersTexte({
				events: [
					{ tStartMs: 0, segs: [{ utf8: "bonjour" }] },
					{ tStartMs: 500, segs: [{ utf8: "bonjour\n" }] },
					{ tStartMs: 70_000, segs: [{ utf8: "suite" }] },
					{ tStartMs: 71_000, segs: [{ utf8: "suite" }] },
				],
			}),
			"[00:00] bonjour\n\n[01:10] suite");
		r.check("un event sans segs n'ouvre rien", texte.json3VersTexte(json3.events[0]), "");
		r.check("horodatage : mm:ss puis h:mm:ss au-delà d'une heure",
			[0, 70_000, 3_723_000].map(texte.horodatage),
			["[00:00]", "[01:10]", "[1:02:03]"]);

		/* ── NOM DU DOCUMENT ──
		   Les caractères que Windows refuse dans un nom de fichier sortent ;
		   80 caractères avant l'extension. */
		const nom = document.nomDocument('a/b:c*?"<>|' + "x".repeat(200));
		r.check("interdits retirés, tronqué à 80, extension .md", [
			["/", "\\", ":", "*", "?", '"', "<", ">", "|"].some(c => nom.includes(c)),
			nom.endsWith(".md"),
			nom.length <= 83,
		], [false, true, true]);
		r.check("nom de la fixture française intact",
			document.nomDocument(fr.title),
			"Les variables en Python®.md");
		/* Repli du REVUE (2026-09-22) : un titre entièrement interdit ou vide
		   ne donne pas « .md » nu — un fichier caché chez Windows. */
		r.check("titre entièrement interdit ou vide : repli video.md", [
			document.nomDocument('***'),
			document.nomDocument(""),
		], ["video.md", "video.md"]);

		/* ── LE DOCUMENT ──
		   Les libellés de section arrivent en paramètre : le noyau ne
		   connaît ni t() ni une langue. Document porté par la fixture FR
		   (piste automatique : le libellé « auto » doit paraître). */
		const documentFr = document.documentVideo({
			infos: fr,
			piste: piste.choisirPiste(fr),
			texte: transcription,
			libelles: {
				chaine: "Chaîne", duree: "Durée", langue: "Langue",
				manuel: "sous-titres manuels", auto: "sous-titres automatiques",
				description: "Description", transcription: "Transcription",
			},
		});
		r.check("le document porte titre, lien, sections, texte et type de piste", [
			documentFr.includes("# " + fr.title),
			documentFr.includes("https://youtu.be/" + fr.id),
			documentFr.includes("Chaîne : " + fr.channel),
			documentFr.includes("Durée : 6:06"),
			documentFr.includes("Langue : fr (sous-titres automatiques)"),
			documentFr.includes("## Description"),
			documentFr.includes("## Transcription"),
			documentFr.includes(transcription),
		], [true, true, true, true, true, true, true, true]);
		r.check("le type manuel vient des libellés, pas du noyau",
			document.documentVideo({
				infos: en,
				piste: piste.choisirPiste(en),
				texte: "texte quelconque",
				libelles: {
					chaine: "Channel", duree: "Duration", langue: "Language",
					manuel: "manual subtitles", auto: "auto subtitles",
					description: "Description", transcription: "Transcript",
				},
			}).includes("manual subtitles"),
			true);

		r.done();
	});