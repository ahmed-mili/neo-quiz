# L'application Android de Neo Quiz — conception

Écrit le 2026-09-16, au lendemain de la clôture de l'installeur Windows. C'est
le **chantier 3** de `2026-09-02-roadmap-produit.md`, et le dernier verrou qui
le retenait — « seulement une fois que l'application assure réellement la
génération et l'édition » — est levé depuis le 13 septembre.

Ce document fige les décisions de pile et de périmètre. Il ne contient pas de
plan d'implémentation : chacun des cinq sous-projets aura le sien.

> [!ATTENTION] CE DOCUMENT EST CORRIGÉ PAR SA §2bis
> Écrit tôt dans la soirée du 2026-09-16, il conclut « tout en web via
> Capacitor ». **Cette conclusion est abandonnée le soir même**, après une
> recherche qui manquait. Lire la §2bis avant le reste : le périmètre et
> l'accès aux fichiers restent valables, la pile change.

## 1. Le périmètre, décidé

**L'application Android fait tout** : réviser, notifier, créer, éditer, et
générer des quiz par l'intermédiaire de l'ordinateur lié.

Ahmed l'a demandé deux fois, la seconde après avoir lu l'objection ci-dessous.
Ce n'est pas le périmètre que `2026-09-02-roadmap-produit.md` envisageait
(« réviser, notifier, et demander au PC quand il faut générer ») ; c'est une
décision prise en connaissance de son coût.

## 2. La pile, et pourquoi elle n'est pas un choix de confort

**L'interface web existante, dans une WebView Android, via Capacitor.**

C'est le niveau le plus bas d'un classement que nous avons établi et vérifié.
Il faut le dire clairement, parce que le contraire serait plus flatteur :

| rang | pile | exemples vérifiés |
|---|---|---|
| 1 | Kotlin natif + Jetpack Compose | Signal, Telegram (langages du dépôt, API GitHub) |
| 2 | Kotlin Multiplatform + Compose Multiplatform | — |
| 3 | Flutter | — |
| 4 | React Native | Bluesky (TypeScript dominant + `react-native`) |
| 5 | **WebView / Capacitor** | **Logseq** (`capacitor.config.ts` au dépôt), Obsidian (source tierce) |

Google écrit que Jetpack Compose est « the recommended modern toolkit for
building native UI » et que la plateforme est « Compose-first ». Le rang 1 est
bien le meilleur — **pour une interface qui devrait être native**.

### Ce qui fait basculer le classement

La règle vient de la note `Projets/Architecture multiplateforme.md` du vault :

> Le contenu que l'application affiche ou édite est-il lui-même du web ?
> Oui → tout en web. Non → tout en Kotlin.

Neo Quiz affiche et édite du **markdown, du LaTeX et du HTML mis en page**. La
WebView n'est donc pas une coquille autour de l'application : c'est le moteur
de rendu de la chose elle-même. La même note condamne la WebView de Neo
Calendar — un agenda, des listes, des gestes — et la distingue explicitement de
ce cas-ci.

### Les trois paris que le natif exigerait, mesurés

1. **Réécrire ≈ 29 300 lignes.** `dashboard` 13 125, `engine` 8 314, `editor`
   2 031, `i18n` 1 957, racine 2 015, `types` 1 256, `review` 977,
   **`scheduler` 629**. Seul `src/host` (986) disparaîtrait.
2. **Confier le rendu mathématique à une bibliothèque de huit mois.** La plus
   sérieuse trouvée (`huarangmeng/latex`, KMP) : 127 étoiles, 5 contributeurs,
   créée le 2026-01-02. En face, MathJax a quinze ans. Pour des quiz de maths
   révisés avant des partiels, un rendu faux ne se découvre qu'au pire moment.
3. **Renoncer à éditer une formule au téléphone.** MathLive n'a aucun
   équivalent Kotlin. Six fichiers de `src/` en dépendent. Ce renoncement
   contredit directement le périmètre du §1.

### Ce que ça coûte, dit honnêtement

Le démarrage, le défilement, et le fait que gestes et animations ne soient pas
ceux du système. C'est réel, et c'est le prix du périmètre choisi.

### Ce qui protège d'une future migration

Pas la coquille — **le contrat `src/host/types.ts`**. Il a déjà fait ses preuves
sur exactement ce risque : pendant toute la migration Tauri → Electron,
`src/` n'a pas bougé d'une ligne. Si Capacitor devenait un problème, l'hôte
Android est une fine couche TypeScript au-dessus de ses plugins ; on la
réécrit sans toucher aux 31 290 lignes partagées.


## 2bis. La pile, CORRIGÉE le 2026-09-16 au soir

**Coquille Kotlin native + Jetpack Compose, et une WebView pour les deux seuls
écrans qui manipulent des maths : le lecteur de quiz ET l'éditeur.**

Ce que la §2 avait raté : elle posait le choix comme binaire — tout natif ou
tout web — alors que la WebView peut être **cantonnée**. Les trois paris du
natif intégral restent vrais, mais ils ne portent que sur les écrans
mathématiques. Pour tout le reste — listes, navigation, réglages,
notifications, Storage Access Framework — rien n'oblige à la WebView, et c'est
là que le natif se sent.

Ce qui a manqué à la §2, et qui a été relevé depuis : **aucun éditeur de
formules n'existe en Compose**. `vkochenkov/EquationDisplayer` (17 étoiles,
dernier commit 2024-06-23) et `Abdo-21/CExpr` (10 étoiles, 2024-10-14) sont
abandonnés ; `mohamedrejeb/compose-rich-editor` (1 853 étoiles, actif) fait du
texte riche et pas de maths. MathLive reste donc obligatoire — mais dans DEUX
écrans, pas dans toute l'application.

C'est l'architecture d'AnkiDroid, notre jumeau fonctionnel (Kotlin dominant,
70 fichiers touchant `WebView`, HTML pour les cartes), élargie à l'éditeur.

**Le reste de ce document tient** : le périmètre (§1), le Storage Access
Framework (§3), le découpage en cinq sous-projets (§4), et le contrat d'hôte
comme assurance (§2, dernier paragraphe). Seule la §5 change de forme : la
coquille est Gradle et Kotlin, pas Capacitor, et l'hôte Android parle à la
WebView par un pont typé, sur le modèle de `apps/windows/electron/pont.ts`.

Le classement des piles Android, avec les citations et leurs sources, vit dans
le vault : `Projets/Piles Android.md`.

## 3. Les fichiers, décidé

**Storage Access Framework.** L'utilisateur désigne son dossier une fois, et
l'application en garde l'accès. Les quiz restent des fichiers `.md` à lui,
lisibles par Obsidian mobile — c'est la promesse du projet, « des fichiers dans
un dossier », tenue sur téléphone.

Le stockage cloisonné d'Android interdit l'alternative naïve (lire un dossier
arbitraire). Le repli « dossier propre à l'application » a été écarté : les
quiz y deviendraient invisibles aux autres applications et disparaîtraient à la
désinstallation, ce qui imposerait d'inventer une synchronisation.

Joplin, application de notes comparable, embarque `react-native-saf-x` : le SAF
est la réponse réelle de cette famille d'applications, pas un pari.

## 4. Le découpage en cinq sous-projets

« Tout » n'est pas un périmètre exécutable : c'est cinq sous-systèmes
indépendants. Chacun aura sa spec et son plan, livrés l'un après l'autre.

| | sous-projet | pourquoi à cette place |
|---|---|---|
| A | coquille, hôte Android, SAF, lire et **réviser** un quiz | rien ne se teste avant que l'application lise un fichier |
| B | **notifications planifiées** | ce qu'un téléphone apporte et qu'un PC n'a pas |
| C | **créer et éditer** au pouce | la page quiz existe, son ergonomie tactile non |
| D | **générer** par le PC lié | un transport entre deux machines, déjà conçu dans `2026-09-02-mobile-generation-design.md` |
| E | **distribution** | APK signé, mises à jour |

L'ordre suit la règle de la feuille de route : construire d'abord ce dont on
est sûr qu'il ne sera pas jeté.

## 5. L'architecture

```
apps/android/
  src/
    host/       ← implémente src/host/types.ts par-dessus les plugins Capacitor
    ui/         ← coquille tactile (pas le rail de bureau)
  android/      ← projet Gradle généré par Capacitor
    …/Notifications.kt   ← le seul Kotlin : AlarmManager (sous-projet B)
```

`src/` **ne bouge pas**. C'est la contrainte qu'a tenue la migration Electron,
et `npm run check:host` la garde mécaniquement : aucun fichier de `src/`
n'importe depuis `apps/`.

Mesures qui cadrent l'effort : `src/` fait 31 290 lignes partagées ; ce qui est
propre à l'application Windows n'en fait que 4 799, dont 2 255 pour son hôte
Electron et 2 031 pour sa coquille de bureau. Android écrit l'équivalent, pas
davantage.

L'hôte Android implémentera le même contrat que les deux autres, donc
`check:android-host` naîtra sur le modèle de `check:windows-host` (140
assertions) et `check:obsidian-host`. Tout cas neuf s'éprouve par
DISCRIMINANCE.

## 6. Le sous-projet A, en détail

Une application qui s'installe, demande **une fois** un dossier par le SAF, y
trouve les notes contenant des blocs ` ```quiz-blocks `, en ouvre un, le joue,
et écrit dans le **même** journal `<racine>/.neo-quiz/review-log.jsonl` que les
deux autres hôtes.

Conséquence voulue : **l'historique de révision est partagé sans une ligne de
synchronisation à écrire**. Le journal est en ajout seul et tolère deux
écrivains ; l'état n'est jamais persisté, il est dérivé. C'est ce que
`2026-09-02-scheduler-design.md` a acheté.

La règle d'identité (`src/quiz-ids.ts`) est partagée telle quelle : une clé qui
divergerait d'un hôte à l'autre rendrait une question éternellement neuve. Le
fait qu'Android exécute LE MÊME code est ce qui garantit qu'elle ne diverge
pas — et c'est le premier argument contre une réimplémentation Kotlin.

## 7. Ce qui reste ouvert

- **L'ergonomie tactile du moteur.** La piste `translateX` et le
  `ResizeObserver` existent ; le geste de balayage sur téléphone n'a jamais été
  pensé. Se tranchera au sous-projet A, à l'écran.
- **La distribution.** APK par le site, ou Play Store. Le second impose un
  compte développeur, une fiche, et une révision à chaque version.
- **Le lien PC ↔ téléphone** du sous-projet D : le protocole est conçu, son
  transport concret ne l'est pas.

## 8. Ce que cette conception ne garantit pas

Qu'une WebView donne un ressenti d'application Android. Elle n'en donnera pas.
Le pari est que, pour un contenu qui **est** du web, ce que l'on perd en
ressenti coûte moins cher que d'entretenir deux implémentations de la même
logique de révision, couplées par un format de fichier qu'elles devraient
produire à l'octet près, pour toujours.

Si ce pari se révélait faux à l'usage, le chemin de repli est celui
d'AnkiDroid — notre jumeau fonctionnel, qui a choisi l'inverse : coquille
Kotlin native, WebView cantonnée au rendu des cartes. Il coûte l'édition de
formules au téléphone, et il reste ouvert tant que le contrat d'hôte tient.
