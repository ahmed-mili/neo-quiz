/* ══════════════════════════════════════════════════════════
   CRÉATION D'ÉLÉMENTS — DOM standard, pour les trois hôtes.

   Obsidian pose sur `HTMLElement` des extensions bien pratiques
   (`createDiv`, `createSpan`, `createEl`, `empty`, `setText`…) qui
   n'existent NULLE PART ailleurs : ni dans la fenêtre de l'application
   Windows, ni dans un navigateur, ni dans Node.

   C'est une dépendance à Obsidian qu'AUCUN `import` ne trahit, donc que
   `check:host` ne pouvait pas voir. Elle s'est déjà glissée dans le code
   partagé une fois : `renderParagraph` (`quiz-utils.ts`) appelait
   `container.createEl("p", …)` et est partie telle quelle dans le bundle de
   l'application, où elle aurait planté si on l'avait atteinte.

   Ce module est la réponse : une seule fonction, du DOM standard, que le
   code partagé et les deux interfaces d'hôte emploient à la place. La
   quatrième assertion de `check:host` refuse désormais ces extensions dans
   tout fichier de `src/` qui n'importe pas Obsidian.
══════════════════════════════════════════════════════════ */

/**
 * Crée un élément, l'ajoute au parent, et le rend.
 *
 * `textContent` et JAMAIS `innerHTML` : les libellés passés ici portent des
 * noms de fichiers et des titres venus des notes de l'utilisateur. Une note
 * nommée « <img src=x onerror=…>.md » exécuterait son code avec les droits
 * de la fenêtre. Le HTML d'un quiz a ses propres portes (`sanitizer.ts`).
 */
/** Le rectangle d'un élément tel que l'hôte le veut pour poser une fenêtre
    dessous (`AncreTerminal`) : pixels CSS de la fenêtre, entiers. */
export function ancreDe(el: HTMLElement): { x: number; y: number; largeur: number; hauteur: number } {
	const r = el.getBoundingClientRect();
	return { x: Math.round(r.left), y: Math.round(r.top), largeur: Math.round(r.width), hauteur: Math.round(r.height) };
}

/** LA CLASSE QUI REMONTE UNE MODALE au-dessus d'une fenêtre posée sous elle
    (le terminal d'installation). Le CSS de l'hôte la porte ; le code partagé
    ne connaît que son nom. */
export const CLASSE_MODALE_HAUT = "qbd-modal-haut";

/** Le rectangle qu'un élément AURA une fois remonté, mesuré SANS le peindre :
    la classe est posée, le rectangle lu (un reflow synchrone), la classe
    retirée — le tout dans la même tâche, donc aucune image intermédiaire.
    C'est ce qui permet d'envoyer la position cible à l'hôte AVANT que la
    modale ne bouge : elle ne remontera qu'une fois la fenêtre posée. */
/** Le rectangle d'un élément APRÈS que la fenêtre a changé de taille : deux
    images d'attente, le temps que le rendu ait refait sa mise en page (la
    première suit le redimensionnement, la seconde le layout qui en découle). */
export function ancreApresRelayout(el: HTMLElement): Promise<{ x: number; y: number; largeur: number; hauteur: number }> {
	return new Promise(resolve => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve(ancreDe(el))));
	});
}

export function ancreRemontee(el: HTMLElement): { x: number; y: number; largeur: number; hauteur: number } {
	const avait = el.classList.contains(CLASSE_MODALE_HAUT);
	if (!avait) el.classList.add(CLASSE_MODALE_HAUT);
	const r = ancreDe(el);
	if (!avait) el.classList.remove(CLASSE_MODALE_HAUT);
	return r;
}

export function ajouter<K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tag: K,
	cls?: string,
	texte?: string,
): HTMLElementTagNameMap[K] {
	const el = parent.appendChild(document.createElement(tag));
	if (cls) el.className = cls;
	if (texte !== undefined) el.textContent = texte;
	return el;
}
