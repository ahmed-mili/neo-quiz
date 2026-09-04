# Application Windows Neo Quiz — conception

**Date** : 2026-09-04
**Statut** : conception arrêtée, prête à découper en plans
**Chantier** : 2 de la feuille de route (`2026-09-02-roadmap-produit.md`)

## 1. Ce que ce document décide, et ce qu'il ne décide pas

Il décrit **comment le greffon Obsidian devient une application Windows autonome**,
sans réécrire ce qui marche. Il ne couvre pas l'application Android (chantier 3),
qui héritera de la même couche partagée, ni la réduction du greffon à un lecteur
(chantier 4), qui vient en dernier et seulement quand l'app assure la génération.

### Décisions déjà prises, hors de ce document

| Décision | Où | Date |
|---|---|---|
| Les quiz restent des `.md` dans un dossier | `content-model-md-files` | 2026-09-03 |
| Le produit s'appelle Neo Quiz, le format reste `quiz-blocks` | `CLAUDE.md` | 2026-09-04 |
| Un seul dépôt (`neo-quiz`), pas deux | conversation | 2026-09-04 |
| Windows d'abord, Android ensuite | conversation | 2026-09-04 |

### Décisions prises ICI

1. **Le journal de révision déménage** dans chaque dossier de quiz (§5).
2. **La génération IA n'est pas dans la première version utilisable** (§7).
3. **L'interface du tableau de bord est conservée et adaptée**, pas réécrite (§4).
4. **La pile est Tauri 2**, calquée sur Neo Calendar (§3).

## 2. Le point qui change tout : la surface d'Obsidian est minuscule

L'intuition dit « 26 000 lignes à porter, dont 14 000 de tableau de bord à jeter ».
La mesure dit autre chose. Fichiers important `from "obsidian"` :

| Zone | Fichiers concernés |
|---|---|
| `src/scheduler/` | **0 / 7** — pur par construction, vérifié mécaniquement |
| `src/engine/` | 4 / 24 |
| `src/editor/` | 4 / 6 |
| `src/dashboard/` | 32 / 42 |

Mais **ce qui est importé** tient en une poignée de symboles :

```
19 setIcon      11 Notice      10 Platform     8 TFile      5 App
 2 requestUrl    2 TFolder      2 Modal        2 ItemView   1 MarkdownRenderer
 1 setTooltip    1 prepareFuzzySearch          1 normalizePath
 1 loadPdfJs     1 getIconIds   1 TAbstractFile              1 Scope
```

Et sur les 32 fichiers du tableau de bord, **13 n'utilisent que `setIcon` et/ou
`Notice`** — le premier est un emballage autour de Lucide (que le projet impose déjà
partout), le second est un toast.

Deux craintes se dissipent à la mesure :

- **Le rendu du texte des quiz ne passe pas par Obsidian.** C'est
  `renderInlineText` (`engine/sanitizer.ts`), notre propre grammaire inline.
  `MarkdownRenderer` d'Obsidian est appelé **une seule fois** dans tout le dépôt,
  pour la réponse du chat IA (`dashboard/ai.ts:1123`) — et la génération IA est
  hors de la première version.
- **Les `![[images]]` et wikilinks** tiennent en deux appels :
  `metadataCache.getFirstLinkpathDest` (trouver un fichier par son nom) et
  `vault.adapter.getResourcePath` (en faire une URL affichable). Une dizaine de
  lignes chacun sur un vrai système de fichiers.

**Conséquence** : le travail n'est pas une réécriture, c'est une **couche d'hôte**.

## 3. Pile technique

Tauri 2, calqué sur Neo Calendar, qui a fait ce passage exact et tient 71 versions
mineures en production.

- **Windows** : Tauri 2 (`@tauri-apps/api` 2.x, `@tauri-apps/cli` 2.x), Vite, React.
- **Android** (chantier 3) : le même frontend Vite empaqueté dans une coquille
  native Gradle, **pas Tauri mobile**. Raison mesurée : le plugin officiel de
  notifications Tauri ne fait que de l'immédiat ; les notifications **planifiées**
  demandent `AlarmManager` en natif de toute façon. Neo Calendar a déjà ce code
  (`ReminderScheduler`, `ReminderReceiver`).

**Pourquoi pas Electron** : Neo Calendar est déjà en Tauri, le partage de coquille
Android en dépend, et le poids d'installation n'est pas comparable.

### Structure du dépôt

```
neo-quiz/
  src/                  ← le code partagé par les trois hôtes
    scheduler/          ← noyau pur, ne bouge pas
    engine/             ← moteur de rendu
    editor/             ← conversion, écriture, formulaire
    dashboard/          ← l'interface, portée telle quelle
    host/               ← NOUVEAU : le contrat d'hôte (§4)
  apps/
    obsidian/           ← le greffon actuel, réduit à son point d'entrée
    windows/            ← Tauri 2
    android/            ← chantier 3
```

Le greffon **continue de fonctionner sans interruption** pendant tout le chantier.
Sa réduction en lecteur est le chantier 4, pas celui-ci.

## 4. La couche d'hôte

C'est l'idée centrale, et elle est déjà éprouvée dans ce dépôt : l'adaptateur de
l'ordonnanceur (`dashboard/review-store.ts`) absorbe tout ce qui est spécifique à
Obsidian pour que le noyau n'en voie rien. On généralise ce patron.

`src/host/` déclare un contrat que chaque hôte implémente :

| Capacité | Obsidian fournit | Windows fournit |
|---|---|---|
| Lire / écrire / lister un fichier | `vault.adapter` | `@tauri-apps/plugin-fs` |
| Surveiller les changements | `vault.on("create"/"modify"/"delete"/"rename")` | watcher Tauri |
| Résoudre un wikilink | `metadataCache.getFirstLinkpathDest` | recherche par nom dans l'arbre |
| URL d'une ressource | `vault.adapter.getResourcePath` | `convertFileSrc` |
| Icône | `setIcon` | Lucide en direct |
| Notification brève | `Notice` | toast maison |
| Boîte de dialogue | `Modal` | composant maison |
| Requête HTTP sans CORS | `requestUrl` | `@tauri-apps/plugin-http` |
| Réglages persistés | `loadData` / `saveData` | `@tauri-apps/plugin-store` |
| Plateforme | `Platform` | constante de build |

**Règle** : aucun fichier de `src/` hors `apps/` n'importe `from "obsidian"` à la
fin du chantier. Ce sera vérifié mécaniquement, comme la pureté du noyau l'est
déjà (`check:scheduler`) — c'est ce contrôle, et non la discipline, qui a tenu
l'ordonnanceur propre.

### Ce que l'interface garde, et ce qu'elle gagne

L'interface actuelle est conservée : barre latérale (Accueil / Mes quiz /
Générer / Réglages), grille de stats, sections repliables, cartes de quiz, page de
quiz unique. Le contrat visuel du 2026-07-28 continue de s'appliquer.

Ce qu'Obsidian fournissait gratuitement et qu'il faut écrire :

- **une fenêtre** : barre de titre, taille et position mémorisées, minimisation ;
- **la sélection des dossiers** : jusqu'à 10, ajoutés par un sélecteur natif,
  listés dans les réglages (§6) ;
- **une page de réglages** autonome — aujourd'hui c'est un `SettingTab` d'Obsidian ;
- **le thème** : le greffon hérite des variables CSS d'Obsidian
  (`--background-primary`, `--text-normal`…). L'app doit les définir elle-même,
  en reprenant les valeurs du thème sombre actuel.

## 5. Le journal de révision déménage

**Aujourd'hui** : `<vault>/.obsidian/plugins/quiz-blocks/review-log.jsonl`.
**Demain** : `<dossier de quiz>/.neo-quiz/review-log.jsonl`.

Trois raisons :

1. **Le greffon et l'app doivent partager le même historique.** Sinon réviser sur
   PC ne compte pas dans Obsidian, et inversement.
2. Un dossier de quiz **n'est pas forcément un vault Obsidian** : il n'a pas de
   `.obsidian/`.
3. Syncthing synchronise alors le journal **avec les notes qu'il décrit**, au lieu
   de dépendre de la synchronisation de `.obsidian/`.

### Migration

Au premier démarrage après la mise à jour, le greffon :

1. lit l'ancien journal s'il existe ;
2. écrit son contenu à la nouvelle place (création du dossier `.neo-quiz/`) ;
3. **relit le nouveau fichier pour confirmer** ;
4. renomme l'ancien en `review-log.jsonl.migrated` — **il ne le supprime pas**.

Le même ordre que l'absorption des conflits Syncthing, pour la même raison : on ne
détruit jamais une source avant d'avoir prouvé que la copie est lisible. Un ancien
journal conservé coûte quelques kilo-octets ; un semestre de révisions perdu ne se
rattrape pas.

**L'absorption des fichiers de conflit Syncthing** (`review-log.sync-conflict-*.jsonl`)
suit le journal à son nouvel emplacement, sans changement de logique.

## 6. Les dossiers de quiz

- **Jusqu'à 10**, ajoutés par le sélecteur natif de Windows, listés dans les
  réglages avec leur chemin et leur nombre de quiz.
- Le coût est celui du nombre de **fichiers**, pas de dossiers : les 4 vaults
  actuels totalisent 756 questions, dix dossiers en feraient environ 2 000 — sans
  effet mesurable sur l'ordonnanceur.
- **Un journal par dossier.** Le plan du jour est calculé sur le catalogue réuni
  de tous les dossiers, avec les événements de tous les journaux. Une réponse est
  écrite dans le journal du dossier auquel appartient sa question.
- La liste des dossiers vit dans les réglages de l'app, pas dans un dossier de
  quiz — c'est une préférence de la machine, pas du contenu.

Sur Android (chantier 3), chaque dossier demandera une autorisation distincte via
le Storage Access Framework : dix dossiers, dix passages par le sélecteur système
au premier lancement. À signaler dans l'interface le moment venu.

## 7. Découpage en tranches livrables

Le chantier ne se fait pas en un bloc. Chaque tranche produit une application qui
**se lance et sert à quelque chose**, ce qui permet de corriger le cap avec l'usage
réel plutôt qu'à la fin.

### Tranche 1 — L'app lit et joue

Une fenêtre, un dossier, la liste des quiz, la page d'un quiz, le moteur qui tourne.
La couche d'hôte minimale : fichiers, icônes, toasts, ressources.
**Livrable** : on peut jouer un quiz de ses notes sans Obsidian.

### Tranche 2 — L'app révise

Le journal à son nouvel emplacement, la migration, l'ordonnanceur branché, la carte
« À réviser », la date d'examen par module, plusieurs dossiers.
**Livrable** : l'app remplace Obsidian pour la révision quotidienne. C'est la
tranche qui justifie le produit.

### Tranche 3 — L'app édite

La page de quiz en mode édition, l'écriture des blocs, la création et la suppression
de quiz.
**Livrable** : plus besoin d'Obsidian pour modifier un quiz.

### Tranche 4 — L'app génère

Le lancement des CLI (Claude Code, Codex, Ollama), l'annulation, le composer, la
résolution des chemins joints.
**Livrable** : l'app fait tout ce que le greffon fait. C'est seulement ici que le
chantier 4 (réduire le greffon à un lecteur) devient possible.

**Hors périmètre de ce chantier** : les notifications (elles n'ont de sens que sur
Android), la distribution aux camarades, le partage de quiz entre étudiants.

## 8. Ce qui reste ouvert

- **L'empaquetage et la mise à jour** : Neo Calendar a un `AppUpdater` et un
  workflow de release ; il faudra décider si Neo Quiz le reprend ou publie
  simplement des binaires sur GitHub.
- **Le sort de `prepareFuzzySearch` et `loadPdfJs`**, tous deux utilisés une fois :
  à remplacer par une petite dépendance ou par du code maison, à trancher au
  moment où la tranche concernée les rencontre.
- **Le thème clair.** Le greffon suit le thème d'Obsidian ; l'app n'aura, en
  première version, que le thème sombre actuel.

## 9. Ce que ce document ne prétend pas être

Ce n'est pas un plan d'implémentation. Chaque tranche du §7 en mérite un, écrit au
moment de l'attaquer — un plan pour les quatre tranches à la fois vieillirait avant
d'être exécuté, et la tranche 1 apprendra des choses qui changeront la 2.
