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

- [ ] **E1 — Tuiles de stats opaques.** `.qbd-stat-card` = `--background-secondary`
  plein + radius 12. Cible : verre `--qbd-glass-bg`, `backdrop-filter`, sheen +
  ombre, radius 10, filet `--qbd-glass-edge`.
- [ ] **E2 — Bandeau « Pick up where you left off » plein.** Dégradé d'accent +
  bordure accentuée. Cible : verre, filet discret, l'accent ne survit que sur le
  label et la barre de progression.
- [ ] **E3 — Cartes de la grille TO DO / Complétés.** `.qbd-quiz-card` opaque
  (`--background-primary`) + barre d'accent supérieure. Cible : variante
  `variant: "folder"` déjà validée, teintée par l'accent du module parent
  (`moduleAccent`), avec bouton lecture et menu ⋯ comme dans « Mes quiz ».
- [ ] **E4 — Header.** Titre 20px/800 sans-serif + sous-titre + bouton bleu
  `.qbd-btn--primary`. Cible : grammaire de la barre « Recent / New folder »
  (pilule claire `.qbd-btn--create`, typo/hauteur de la référence).
- [ ] **E5 — En-têtes de section.** `TO DO` / `Completed` en micro-caps 10px.
  Cible : rangée 52px, chevron animé, libellé 16px/500, badge compteur, repli.
- [ ] **E6 — Revue d'états.** Thème clair, `.is-mobile`, survols, page vide
  (onboarding), grille 2 vs 3 colonnes.

## Journal

(une ligne par itération)
