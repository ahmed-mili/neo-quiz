/* ══════════════════════════════════════════════════════════
   DETAIL SLIDE — le carrousel du quiz, appliqué à la page

   Même transition que le moteur (engine/track.ts) : une PISTE que l'on
   translate en `translate3d(px)`, hauteur du viewport verrouillée au max
   des deux slides pendant le glissement pour qu'aucun reflow ne saute.
   Durée et courbes reprises telles quelles — changer de question dans la
   page doit se sentir comme changer de question dans le quiz.

   Version allégée : deux slides au plus (l'actuelle et la suivante), pas
   de warming ni de synchro de hauteur permanente — la page n'a pas de
   slides voisines pré-rendues à entretenir.
══════════════════════════════════════════════════════════ */

export interface SlideHost {
	viewport: HTMLElement;
	track: HTMLElement;
	/** Jeton d'animation : une navigation rapide invalide la précédente. */
	token: number;
	cleanup: (() => void) | null;
}

/** Durée du moteur (engine/track.ts slideDuration) : ~680 ms pour un saut. */
function slideDuration(dist: number): number {
	const d = Math.max(1, Number(dist) || 1);
	return Math.min(1200, 860 + (d - 3) * 90);
}

/** Courbes du moteur (engine/track.ts getTrackEaseForDistance). */
function slideEase(hops: number): string {
	if (hops <= 1) return "cubic-bezier(0.22, 0.88, 0.24, 1)";
	if (hops <= 3) return "cubic-bezier(0.24, 0.84, 0.22, 1)";
	return "cubic-bezier(0.26, 0.80, 0.20, 1)";
}

function prefersReducedMotion(): boolean {
	return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function mountSlideHost(panel: HTMLElement): SlideHost {
	const viewport = panel.createDiv({ cls: "qbd-qz-viewport" });
	const track = viewport.createDiv({ cls: "qbd-qz-track" });
	return { viewport, track, token: 0, cleanup: null };
}

/** Pose une slide SANS animation (premier rendu, re-render sur place). */
export function setSlide(host: SlideHost, fill: (slide: HTMLElement) => void): HTMLElement {
	finish(host);
	host.token++;
	host.track.empty();
	host.track.style.transition = "none";
	host.track.style.transform = "translate3d(0,0,0)";
	host.viewport.style.height = "";
	const slide = host.track.createDiv({ cls: "qbd-qz-slide" });
	fill(slide);
	return slide;
}

/**
 * Glisse vers une nouvelle question.
 * @param dir  +1 vers la suivante (entre par la droite), -1 vers la précédente.
 * @param hops nombre de questions franchies (allonge la durée, comme le moteur).
 */
export function slideTo(host: SlideHost, fill: (slide: HTMLElement) => void, dir: 1 | -1, hops: number): void {
	// Terminer AVANT de lire la slide courante : un glissement encore en vol
	// tient DEUX slides, et sa conclusion en retire une. Lire `old` d'abord
	// désignait celle qui allait disparaître — la nouvelle restait alors dans
	// la piste, et le panneau affichait la question précédente (bug 2026-07-21,
	// deux clics rapides sur ‹ ›).
	finish(host);
	const old = host.track.firstElementChild as HTMLElement | null;
	if (!old || prefersReducedMotion()) { setSlide(host, fill); return; }

	const token = ++host.token;

	const next = document.createElement("div");
	next.className = "qbd-qz-slide";
	fill(next);
	if (dir > 0) host.track.appendChild(next);
	else host.track.insertBefore(next, old);

	const w = Math.max(1, host.viewport.clientWidth);
	const startX = dir > 0 ? 0 : -w;
	const endX = dir > 0 ? -w : 0;

	// Hauteur VERROUILLÉE au max des deux slides pendant le glissement (recette
	// du moteur) : la piste ne se réajuste pas en cours de route, donc rien ne
	// saute quand les deux questions n'ont pas le même nombre de réponses.
	const locked = Math.max(1, Math.ceil(old.offsetHeight), Math.ceil(next.offsetHeight));
	host.viewport.style.height = `${locked}px`;

	host.track.style.transition = "none";
	host.track.style.transform = `translate3d(${startX}px,0,0)`;
	host.track.style.willChange = "transform";

	const dur = slideDuration(hops);
	const ease = slideEase(hops);

	requestAnimationFrame(() => {
		if (token !== host.token) return;
		host.track.style.transition = `transform ${dur}ms ${ease}`;
		host.track.style.transform = `translate3d(${endX}px,0,0)`;
	});

	const done = (): void => {
		if (token !== host.token) return;
		// Ne garder QUE la slide d'arrivée, au lieu de retirer `old` nommément :
		// la piste finit à une seule slide quoi qu'il soit arrivé avant (clics
		// enchaînés, re-render au milieu d'un glissement).
		for (const child of [...host.track.children]) {
			if (child !== next) child.remove();
		}
		host.track.style.transition = "none";
		host.track.style.transform = "translate3d(0,0,0)";
		host.track.style.willChange = "";
		host.viewport.style.height = "";
		host.cleanup = null;
		host.track.removeEventListener("transitionend", onEnd);
		window.clearTimeout(timer);
	};

	const onEnd = (e: TransitionEvent): void => {
		if (e.target !== host.track || e.propertyName !== "transform") return;
		done();
	};
	host.track.addEventListener("transitionend", onEnd);
	// Filet : transitionend ne part pas si l'onglet passe en arrière-plan
	// pendant le glissement — sans lui la page resterait figée à mi-course.
	const timer = window.setTimeout(done, dur + 160);
	host.cleanup = done;
}

/** Termine sur-le-champ une animation en vol (navigation rapide, sortie de page). */
export function finish(host: SlideHost): void {
	if (host.cleanup) host.cleanup();
}

/**
 * Réserve la hauteur de la question la PLUS HAUTE du quiz.
 *
 * Sans elle, le viewport épouse la question courante et les chevrons
 * remontent ou descendent à chaque navigation — ils doivent rester au même
 * endroit (demande Ahmed 2026-07-21). Chaque question est donc rendue une
 * fois dans un calque de mesure (hors flux, `visibility: hidden` : le layout
 * est calculé, rien n'est peint), on garde la plus haute, et on la borne à la
 * place réellement disponible pour que les chevrons ne sortent jamais de
 * l'écran.
 */
export function reserveTallest(host: SlideHost, fills: Array<(slide: HTMLElement) => void>, available: number): void {
	const probe = host.viewport.createDiv({ cls: "qbd-qz-measure" });
	let tallest = 0;
	for (const fill of fills) {
		const slide = probe.createDiv({ cls: "qbd-qz-slide" });
		try { fill(slide); } catch { /* une question illisible ne doit pas casser la mesure */ }
		tallest = Math.max(tallest, slide.offsetHeight);
		slide.remove();
	}
	probe.remove();
	setReserve(host, tallest, available);
}

/** Étend la réserve si le contenu COURANT dépasse (une réponse ajoutée en
    cours d'édition, un rendu MathJax plus haut que la mesure à froid). */
export function growReserve(host: SlideHost, available: number): void {
	const slide = host.track.firstElementChild as HTMLElement | null;
	if (!slide) return;
	const current = parseFloat(host.viewport.style.minHeight) || 0;
	setReserve(host, Math.max(current, slide.offsetHeight), available);
}

function setReserve(host: SlideHost, wanted: number, available: number): void {
	const h = available > 0 ? Math.min(wanted, available) : wanted;
	host.viewport.style.minHeight = h > 0 ? `${Math.ceil(h)}px` : "";
}
