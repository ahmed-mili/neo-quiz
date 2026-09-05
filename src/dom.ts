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
