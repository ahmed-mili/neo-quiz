/* ══════════════════════════════════════════════════════════
   L'ICÔNE D'UN FICHIER, PAR SON EXTENSION — une seule table

   Deux surfaces montrent des fichiers côte à côte : les chips du composer
   de « Générer » et les rangées Documents / Notes de la page d'un dossier.
   Toutes deux posaient `file-text` sur tout (retour Ahmed 2026-09-17 : « les
   fichiers ne doivent pas tous avoir la même icône »). Une table, deux
   consommateurs — deux tables auraient divergé au premier ajout.

   Lucide seulement, jamais d'emoji (règle du dépôt). Chaque nom existe dans
   `lucide` 1.41, la bibliothèque de l'application.
══════════════════════════════════════════════════════════ */

const PAR_EXTENSION: Record<string, string> = {
	// La note : ce qu'on écrit.
	md: "file-pen-line",
	// Le cours : ce qu'on lit.
	pdf: "book-open-text",
	txt: "file-type",
	// Bureautique.
	doc: "file-text", docx: "file-text", odt: "file-text", rtf: "file-text",
	xls: "file-spreadsheet", xlsx: "file-spreadsheet", ods: "file-spreadsheet", csv: "file-spreadsheet",
	ppt: "presentation", pptx: "presentation", odp: "presentation",
	// Médias.
	png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image",
	mp4: "video", webm: "video", mkv: "video", mov: "video", avi: "video",
	mp3: "audio-lines", wav: "audio-lines", m4a: "audio-lines", ogg: "audio-lines", flac: "audio-lines",
	// Archives.
	zip: "file-archive", "7z": "file-archive", rar: "file-archive", tar: "file-archive", gz: "file-archive",
	// Code — les TP de l'Efrei en sont pleins.
	py: "file-code", js: "file-code", ts: "file-code", c: "file-code", h: "file-code", cpp: "file-code",
	java: "file-code", sh: "file-code", ps1: "file-code", json: "file-code", html: "file-code", css: "file-code",
	sql: "file-code", yaml: "file-code", yml: "file-code", xml: "file-code",
};

/** Le BADGE d'une carte de pièce jointe : l'extension en capitales
    (« PDF », « MD »), ou « FILE » faute d'extension. C'est ce que montre
    claude.ai sous chaque carte, et c'est plus lisible qu'une icône à cette
    taille (retour Ahmed 2026-09-17). Les rangées d'un dossier, elles, ont la
    place d'une icône et gardent `fileIcon`. */
export function badgeDeFichier(name: string): string {
	const point = name.lastIndexOf(".");
	const ext = point > 0 ? name.slice(point + 1) : "";
	return (ext || "file").toUpperCase().slice(0, 6);
}

/** Le nom d'icône Lucide d'un fichier, par son extension ; `file` sinon. */
export function fileIcon(name: string): string {
	const point = name.lastIndexOf(".");
	const ext = point > 0 ? name.slice(point + 1).toLowerCase() : "";
	return PAR_EXTENSION[ext] ?? "file";
}
