# Refonte de la page Accueil — alignement sur « Mes quiz »

Contrat visuel : `C:\Users\Ahmed\Pictures\Screenshots\Clipboard 2026-07-28 054109.png`
(page « Mes quiz », validée). Page à refaire : `…054124.png` (Accueil).

Vocabulaire de référence, déjà présent dans le code (à RÉUTILISER, jamais réinventer) :

| Élément | Classe | Fichier |
| --- | --- | --- |
| Carte de dossier (verre + halo d'accent) | `.qbd-module-card` | `dashboard-quizzes.css:329` |
| Carte de quiz verre (handoff 7a) | `.qbd-quiz-card--folder` | `dashboard-components.css:810` |
| En-tête de section repliable (chevron + badge) | `.qbd-quizzes-node-head/-badge` | `dashboard-quizzes.css:192` |
| Pilule d'action claire | `.qbd-btn--create` (surcharge `.qbd-quizzes-group`) | `dashboard-components.css:328` |
| Chip de regroupement verre dense | `.qbd-quizzes-group-select` | `dashboard-quizzes.css:124` |
| Tokens verre | `--qbd-glass-*` | `tokens.css:13` |

## Écarts constatés (ordre d'attaque)

- [x] **E1 — Tuiles de stats opaques.** `.qbd-stat-card` = `--background-secondary`
  plein + radius 12. Cible : verre `--qbd-glass-bg`, `backdrop-filter`, sheen +
  ombre, radius 10, filet `--qbd-glass-edge`.
- [x] **E2 — Bandeau « Pick up where you left off » plein.** Dégradé d'accent +
  bordure accentuée. Cible : verre, filet discret, l'accent ne survit que sur le
  label et la barre de progression.
- [x] **E3 — Cartes de la grille TO DO / Complétés.** `.qbd-quiz-card` opaque
  (`--background-primary`) + barre d'accent supérieure. Cible : variante
  `variant: "folder"` déjà validée, teintée par l'accent du module parent
  (`moduleAccent`), avec bouton lecture et menu ⋯ comme dans « Mes quiz ».
- [x] **E4 — Header.** Titre 20px/800 sans-serif + sous-titre + bouton bleu
  `.qbd-btn--primary`. Cible : grammaire de la barre « Recent / New folder »
  (pilule claire `.qbd-btn--create`, typo/hauteur de la référence).
- [x] **E5 — En-têtes de section.** `TO DO` / `Completed` en micro-caps 10px.
  Cible : rangée 52px, chevron animé, libellé 16px/500, badge compteur, repli.
- [x] **E6 — Revue d'états.** Thème clair, `.is-mobile`, survols, page vide
  (onboarding), grille 2 vs 3 colonnes.

## Journal

- ca60222 — E1 fait : tuiles de stats en verre, jauge « mastered » supprimée.
- be934a6 — E2 + E3 faits : bandeau Reprendre en verre ; cartes de quiz en
  variante `folder` teintée par le dossier (play + menu ⋯ comme « Mes quiz »).
- fe355aa — E4 + E5 faits : titre serif 28px + pilule claire ; en-têtes de
  section repliables partagés (`dashboard/collapsible.ts`).
- 3b989b5 — E6a : teintes de la carte rendues thémables (le titre disparaissait
  en thème clair, vérifié en capture avant/après ; rendu sombre identique).
- 3f547d4 — E6b : pilule d'action pleine largeur quand le header s'empile
  (mesuré à 390px sous émulation, aucun débordement horizontal).
- 5a8b158 — Revue design Claude (projet « Design de plugin Obsidian », fichier
  « Vue Accueil v2 ») : héros teinté par son dossier, titre 20px, bouton verre
  au lieu du bleu, grille plafonnée à 6, « Complétés » replié.
  **Écarté de la revue** (contredit le contrat d'Ahmed) : dé-encadrer les
  tuiles de stats, et déclasser « Generate a quiz » en bouton fantôme.
- c824dd7 — E6c : état premier usage (vault vide) passé au verre.

- 1cd1df6 — Code mort supprimé : une seule anatomie de carte (l'option
  `variant`, la barre d'accent, la barre de progression, le meilleur score et
  le chevron ne s'exécutaient plus ; 76 lignes de CSS orphelines avec eux).
- 373264f — Transition d'entrée de l'accueil, mécanisme partagé
  (`dashboard/view-enter.ts`), cascade continue sur toute la page.
- c0d0554 — Carte de dossier lisible en thème clair (correctifs sous
  `.theme-light` seulement ; sombre prouvé inchangé par `getComputedStyle`).

## Vérifications passées

| Quoi | Comment | Résultat |
| --- | --- | --- |
| Thème sombre / clair | bascule `app.changeTheme`, captures | OK des deux côtés |
| Mobile 390px | `dev:mobile on` + `setDeviceMetricsOverride` | 1 colonne, 0 débordement |
| Fenêtre 1000px | override CDP | 2 colonnes, 0 débordement |
| Survol des cartes | `Input.dispatchMouseEvent` + computed style | lift -3px, filet accent |
| Repli des sections | clic réel + état persisté | replie, rouvre, persiste |
| UI française | `settings.language = "fr"` | aucune chaîne anglaise |
| Console | `dev:errors` | « No errors captured » |
| Non-régression « Mes quiz » | captures racine + drill | identiques à la référence |

## Reste à faire

- Rien de bloquant. Piste si Ahmed veut aller plus loin : la revue Claude
  proposait aussi une ligne de stats SANS cadre (chiffres + séparateurs, zéro
  surface) — écartée ici parce que la consigne demandait l'inverse.
