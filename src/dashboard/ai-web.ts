/* ══════════════════════════════════════════════════════════
   LE CANAL WEB — ce qui part à un site et comment il s'ouvre.
   Fonctions PURES : pas d'hôte, pas de DOM. Le câblage (ouvrir, copier,
   attendre) est dans ai.ts et dans le contrat d'hôte.
   Spec : docs/superpowers/specs/2026-09-18-generation-web-design.md
══════════════════════════════════════════════════════════ */

/** La plus longue URL qu'on ose passer au navigateur.
    MESURÉE le 2026-09-18 par `npm run report:url-max` : ShellExecute admet
    32644 caractères sur cette machine (le serveur de claude.ai en accepte
    65 555, la ligne de commande Windows est la borne qui compte). Posée
    avec une marge : le navigateur ajoute ses propres arguments devant
    l'URL. Au-delà, le texte part par le presse-papier (`preparerOuverture`). */
export const URL_MAX = 31600;
