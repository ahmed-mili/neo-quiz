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
	const old = host.track.firstElementChild as HTMLElement | null;
	if (!old || prefersReducedMotion()) { setSlide(host, fill); return; }

	// Une animation encore en vol est terminée d'abord : sinon deux pistes se
	// disputent le transform et l'ancienne slide reste collée à l'écran.
	finish(host);
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
		old.remove();
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
