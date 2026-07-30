# Usage : icône composer + modal claude.ai + libellés de modèles vivants

Date : 2026-07-30 · Références : captures `Clipboard 2026-07-30 204819.png`
(modal claude.ai, CONTRAT pixel), `204910.png` (emplacement icône composer),
`204748.png` (état à remplacer), `205712.png` (menu modèles périmé).

## Contexte

La 2.1.0-beta (sources sur le desktop, à puller avant implémentation) affiche
sur la page Générer un chip « Usage » sous le titre + un panneau inline
(TODAY / SUBSCRIPTION / RECORDED SO FAR). Demandes :

1. L'icône usage rejoint le bas-gauche du composer (rangée « + » / réglages).
2. Le clic ouvre un MODAL reproduisant exactement le panneau « Limites
   d'utilisation » de claude.ai (capture 204819).
3. Le type d'abonnement est détecté et affiché (« Max (5x) »).
4. Rafraîchissement manuel comme sur claude.ai (« Dernière mise à jour : … » + ↻).
5. (message du 30/07) Le menu des modèles Claude affiche « Opus 4.8 » alors
   qu'Opus 5 est sorti : les libellés doivent suivre tout seuls.

## Sources de données (vérifiées le 2026-07-30 sur la machine d'Ahmed)

- `GET https://api.anthropic.com/api/oauth/usage` (Bearer =
  `~/.claude/.credentials.json` → `claudeAiOauth.accessToken`, header
  `anthropic-beta: oauth-2025-04-20`). Champ moderne **`limits[]`** :
  `{ kind: "session"|"weekly_all"|"weekly_scoped", percent, resets_at,
  scope.model.display_name }` — correspond UN POUR UN aux trois barres du
  modal claude.ai. Fallback : vieux champs `five_hour`/`seven_day`/
  `seven_day_opus` (forme déjà gérée par `ai-usage.ts` 2.1.0-beta).
- Abonnement : `claudeAiOauth.subscriptionType` (`max`) +
  `claudeAiOauth.rateLimitTier` (`default_claude_max_5x` → « (5x) » par regex
  `_(\d+)x`). Pas d'appel réseau.
- Codex : `readCodexLimits()` (2.1.0-beta) inchangé — le modal rend les mêmes
  barres génériques (« 5 h » / « 7 j »), sans chip de plan ni encart Fable.
- Modèles : `claude -p … --output-format json` renvoie `modelUsage` avec
  `canonicalModel` (ex. `claude-haiku-4-5`) — vérifié CLI 2.1.220. Aucun
  cache local (`modelAccessCache` vide) ni endpoint OAuth (`/v1/models` → 400)
  ne publie le catalogue : l'apprentissage par génération est la seule source
  vivante.

## Design

### 1. Icône dans le composer (réf. 204910)

- `.qbd-ai-composer-bottom`, groupe gauche : `[+] [réglages] [jauge usage]` —
  même gabarit que ses voisins (bouton 24-30 px, svg 14-15 px, Lucide
  `gauge`), visible seulement si provider ∈ {claude-code, codex} et desktop.
- Tooltip d'état au survol (pattern hover-tip existant) : « Usage · {n} % »
  (dernier % session connu, rien si jamais fetché).
- Le chip sous le titre (`renderUsageOpener`) et le panneau inline
  (`renderUsageDetail`) disparaissent, avec leur CSS (`qbd-ai-usage-opener/…`)
  — composer-first, pas de section morte. Le badge post-génération
  (« 35k tokens · $0.433 ») en phase résultat est CONSERVÉ (élément distinct),
  ainsi que `recordUsage`/`aiUsageLog` (données réutilisées par le badge).

### 2. Modal (réf. 204819 — contrat par élément)

Modal Obsidian (via `modal-base.ts`), verre `--qbd-glass-*`, largeur ~520 px.

1. Titre : « Limites d'utilisation du forfait » (gras) + « Max (5x) »
   (muted, même ligne).
2. Rangée session : « Session actuelle » (gras) à gauche avec sous-ligne
   « Réinitialisation dans {4 h 31 min} » (muted, relatif) ; barre fine
   (~6 px, piste sombre, remplissage bleu arrondi) au centre ;
   « {20} % utilisés » à droite (muted).
3. Heading « Limites hebdomadaires » (gras).
4. Encart info (boîte sombre arrondie, icône ⓘ, uniquement provider Claude
   ET `isFableOffered()`) : « **Fable 5 est toujours inclus dans votre
   forfait {Max}.** Si un message vous demande de configurer des crédits
   d'utilisation, redémarrez Claude Code. »
5. Lien « En savoir plus sur les limites d'utilisation » (souligné) → hub
   `support.claude.com/en/collections/18031876-usage-and-limits`, retenu après
   vérification en ligne : les quatre identifiants d'articles présents dans le
   binaire du CLI traitent d'autre chose (sécurité, bascule de modèle, crédits),
   et aucun article isolé ne couvre à la fois session et hebdomadaire.
6. Rangée « Tous les modèles » : sous-ligne « Réinitialisation {mer. 07:00} »
   (ABSOLU : jour court + heure via Intl, locale de l'UI) + barre + « {10} %
   utilisés ».
7. Une rangée par `weekly_scoped` : label = `scope.model.display_name`
   (« Fable »), même anatomie.
8. Pied : « Dernière mise à jour : {à l'instant|il y a n min} » (muted) +
   bouton ↻ (Lucide `rotate-cw`) — rafraîchit à la demande, icône en rotation
   pendant le fetch. Fetch aussi à l'ouverture du modal (cache affiché
   immédiatement s'il existe).
- Réglage `aiUsageLimitsEnabled` respecté : à off, le modal affiche la note
  `ai.usage.planOff` à la place des barres.
- i18n : nouvelles clés `ai.usage.*` (planTitle, sessionCurrent, weeklyTitle,
  allModels, resetAbsolute, resetInLong, usedPercent, lastUpdated…, fableInfo),
  en révisant les clés 2.1.0-beta devenues mortes avec le panneau inline.

### 3. Libellés de modèles vivants (réf. 205712)

`claude --help` le confirme : `fable`/`opus`/`sonnet` sont des alias « du
dernier modèle ». Les générations tournaient donc DÉJÀ sur Opus 5 (sonde :
`--model opus` → `canonicalModel: claude-opus-5`) ; seul le libellé mentait.

- Source vivante retenue : `~/.claude.json` → `projects[*].lastModelUsage`,
  dont les clés sont les modèles que le CLI a réellement consommés
  (`claude-opus-5`, `claude-haiku-4-5-20251001`…). C'est le fichier que le
  plugin lit DÉJÀ pour la promo Fable : même lecture, même cache TTL, aucun
  accès nouveau.
- Par famille, on retient la version la plus haute vue (comparaison par
  segments : `[5]` > `[4,7]`), en ignorant les suffixes de date (8 chiffres) et
  de fenêtre (`[1m]`). Libellé dérivé : `claude-opus-5` → « Opus 5 ».
  Un identifiant d'ancienne génération (`claude-3-5-haiku`) est rejeté plutôt
  que mal étiqueté.
- Fallback statique corrigé et daté (2026-07-30) : Fable 5, **Opus 5**,
  Sonnet 5, Haiku 4.5 — il ne sert que pour une famille jamais utilisée.
- Hors périmètre : descriptions (`ai.modelDesc.*`) restent statiques.

### 4. Ce qui s'ajoute sous l'écran officiel

L'écran de claude.ai ignore ce vault : il ne dit rien des tokens consommés par
les générations du plugin. Cette comptabilité (« Cette génération »,
« Aujourd'hui », « Enregistré à ce jour ») existait dans le panneau supprimé et
n'a pas d'autre logement — elle est donc conservée SOUS l'écran officiel,
séparée par un filet. Écart assumé vs la référence, à retirer si Ahmed préfère
l'écran nu.

## Périmètre / risques

- Baseline : sources 2.1.0-beta du desktop (décision Ahmed : push depuis le
  fixe, pull ici avant tout code). Le bundle déployé est sauvegardé dans le
  scratchpad en cas de besoin.
- `npm run check` + build + test manuel Obsidian (pas de framework de test).
- Écart assumé vs claude.ai : la 2e phrase de l'encart Fable est reformulée
  pour le contexte plugin si nécessaire ; à défaut de source, l'URL du lien
  support peut être omise (lien retiré) plutôt qu'inventée.
