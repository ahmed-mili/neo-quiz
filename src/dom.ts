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
export function ancreDe(el: HTMLElement): { x: number; y: number; largeur: number; hauteur: number; limiteBas?: number } {
	const r = el.getBoundingClientRect();
	const limiteBas = limiteComposer();
	return { x: Math.round(r.left), y: Math.round(r.top), largeur: Math.round(r.width), hauteur: Math.round(r.height), ...(limiteBas === undefined ? {} : { limiteBas }) };
}

/** LA CLASSE QUI REMONTE UNE MODALE au-dessus d'une fenêtre posée sous elle
    (le terminal d'installation). Le CSS de l'hôte la porte ; le code partagé
    ne connaît que son nom. */
export const CLASSE_MODALE_HAUT = "qbd-modal-haut";

/** LA LIMITE BASSE d'une ancre : le haut de l'invite du composer, que la
    fenêtre posée sous la modale ne doit jamais recouvrir. `undefined` quand
    il n'y a pas de composer à l'écran (le terminal descend alors jusqu'au bas
    de la fenêtre). */
export function limiteComposer(): number | undefined {
	const el = document.querySelector<HTMLElement>(".qbd-ai-composer");
	if (!el) return undefined;
	const r = el.getBoundingClientRect();
	return r.height > 0 ? Math.round(r.top) : undefined;
}

/** Le rectangle qu'un élément AURA une fois remonté, mesuré SANS le peindre :
    la classe est posée, le rectangle lu (un reflow synchrone), la classe
    retirée — le tout dans la même tâche, donc aucune image intermédiaire.
    C'est ce qui permet d'envoyer la position cible à l'hôte AVANT que la
    modale ne bouge : elle ne remontera qu'une fois la fenêtre posée. */
/** Le rectangle qu'un élément AURA une fois remonté, APRÈS que la fenêtre a
    changé de taille : deux images d'attente, le temps que le rendu ait refait
    sa mise en page (la première suit le redimensionnement, la seconde le
    layout qui en découle). Remonté, parce que c'est sous cette place-là que
    la fenêtre se posera, et que la modale y montera ensuite. */
export function ancreApresRelayout(el: HTMLElement): Promise<{ x: number; y: number; largeur: number; hauteur: number }> {
	return new Promise(resolve => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve(ancreRemontee(el))));
	});
}

export function ancreRemontee(el: HTMLElement): { x: number; y: number; largeur: number; hauteur: number } {
	const avait = el.classList.contains(CLASSE_MODALE_HAUT);
	if (avait) return ancreDe(el);
	/* LA TRANSITION EST COUPÉE LE TEMPS DE LA MESURE : la remontée est un
	   `transform` animé, et `getBoundingClientRect` lit la valeur ANIMÉE — à
	   l'instant où la classe arrive, elle vaut encore zéro. Mesurée ainsi, la
	   « position remontée » était la position centrée, et le terminal se
	   posait quatorze centièmes de hauteur trop bas (vu le 2026-09-20). Sans
	   transition, la valeur calculée est la valeur finale. Le reflow forcé
	   avant de rendre la transition garantit qu'aucune image n'a été peinte
	   entre-temps. */
	const transition = el.style.transition;
	el.style.transition = "none";
	el.classList.add(CLASSE_MODALE_HAUT);
	const r = ancreDe(el);
	el.classList.remove(CLASSE_MODALE_HAUT);
	void el.offsetHeight;
	el.style.transition = transition;
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
