/* ══════════════════════════════════════════════════════════
   VIEW ENTER — transition d'ENTRÉE d'une vue du dashboard.
   Extraite de quizzes.ts le 2026-07-28 pour que l'accueil joue la même
   entrée que « Mes quiz » sans recopier le piège ci-dessous.
══════════════════════════════════════════════════════════ */

/** Pose (ou retire) la classe d'entrée sur le conteneur d'une vue.
    `entering` ne vaut `true` que lorsqu'on ARRIVE sur la vue : un re-render
    interne (renommage, archivage, reset de stats) ne doit jamais rejouer
    l'animation, et `toggle(force)` garantit qu'aucune classe résiduelle ne
    survit à un tel rendu.

    La classe DOIT tomber une fois l'entrée jouée : une CSSAnimation en
    `fill: both` dont un keyframe contient `transform` reste propriétaire de la
    propriété même terminée → les transitions de transform (le lift des cartes
    au survol) ne se déclenchent plus et la surélévation saute d'un coup. */
export function markViewEnter(container: HTMLElement, entering: boolean, cls: string): void {
	container.classList.toggle(cls, entering);
	if (!entering) return;
	const onEnd = (ev: AnimationEvent): void => {
		if (!ev.animationName.startsWith("qbd-")) return;
		const stillRunning = container.getAnimations({ subtree: true })
			.some(a => a instanceof CSSAnimation && a.playState === "running");
		if (stillRunning) return;
		container.classList.remove(cls);
		container.removeEventListener("animationend", onEnd);
	};
	container.addEventListener("animationend", onEnd);
}
