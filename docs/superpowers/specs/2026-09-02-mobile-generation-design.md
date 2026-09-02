# Générer un quiz depuis Android — conception

**Date** : 2026-09-02
**Statut** : conception validée, plan d'implémentation à écrire

## 1. Le problème

La génération IA du plugin lance des CLI locaux — Claude Code, Codex, Ollama —
par `child_process`. Sur Obsidian Android il n'y a pas de `child_process`, et
le code le sait : `src/dashboard/ai-client.ts:269` et `:420`,
`src/dashboard/ai-providers.ts:516`, `src/dashboard/ai.ts:858` et `:1450`
gardent tous ces chemins derrière `Platform.isDesktopApp`.

Ahmed veut lancer une génération depuis son téléphone pendant que son PC est
allumé.

## 2. Pourquoi ce n'est PAS un problème d'application

La demande initiale envisageait un APK. **Un APK ne résoudrait rien.** Le
blocage n'est pas l'enveloppe applicative, c'est que les CLI et les sessions
authentifiées qu'ils portent vivent sur le PC. Une application Android native
se heurterait au même mur, en ajoutant une interface à dupliquer, une
signature, une distribution et une seconde base de code à maintenir.

Le problème est un problème de **transport**. Et le transport existe déjà.

## 3. Ce qui existe, vérifié le 2026-09-02

| Fait | Vérification |
|---|---|
| Syncthing tourne sur le PC | deux processus `syncthing.exe` actifs |
| Le vault Efrei est un dossier partagé | `.stfolder` présent à sa racine |
| Le partage couvre **trois** appareils | en-tête de `.stignore` : « laptop, desktop, telephone » |
| `.obsidian/` n'est PAS exclu de la synchronisation | `.stignore` n'exclut que `workspace*.json`, `appearance.json`, `.trash`, `*.sync-conflict-*`, `_to_delete` |
| Le plugin tourne déjà sur Android | `isDesktopOnly: false` (`src/assets/manifest.json`) |
| Le moteur sait réagir à un fichier qui apparaît | `app.vault.on("create")` (`src/dashboard/scanner.ts:265`) — **mais voir §5.3** |
| Le plugin sait déjà écrire hors des notes | `RESULTS_DIR = ".obsidian/quiz-blocks-results"` via l'adaptateur (`src/engine/results-save.ts:66`, `:458`) |

**Le vault est donc déjà un canal bidirectionnel entre les trois appareils.**
Il ne manque que la pièce qui relie le composer au CLI à travers lui.

## 4. Approches écartées

- **APK / application native** — voir §2. Ne résout pas le transport, et
  duplique tout le reste.
- **Serveur HTTP local + Tailscale** — instantané, mais transforme le plugin en
  serveur (surface de sécurité), exige un port, une authentification, et casse
  dès que Tailscale est en défaut ou que le réseau change. Beaucoup de pièces
  mobiles pour gagner quelques secondes sur un canal qui existe déjà.
- **Service Node en tâche de fond sur le PC** — marcherait Obsidian fermé, mais
  c'est un second programme à installer, maintenir et déboguer, qui devrait
  réécrire une partie de ce que le plugin sait déjà faire. **Écarté pour ce
  lot, pas définitivement** : le canal conçu ici resterait valable si un tel
  service devait un jour remplacer le plugin comme travailleur.

## 5. Le canal

### Emplacement : `.quiz-blocks-jobs/` à la RACINE du vault

Pas dans `.obsidian/`, alors même que le plugin y écrit déjà ses résultats et
que ce dossier se synchronise aujourd'hui.

**Pourquoi.** Placer le canal dans `.obsidian/` ferait dépendre la survie de la
fonctionnalité d'une décision de synchronisation qui n'a rien à voir avec elle.
Exclure `.obsidian/` en bloc est une pratique courante pour éviter les conflits
d'état de greffons, et Ahmed y a déjà retiré quatre fichiers : il est
manifestement prêt à y tailler. Le jour où il exclurait le dossier entier, la
fonctionnalité mourrait **en silence** — les demandes partiraient, n'arriveraient
jamais, et le téléphone attendrait un résultat qui ne viendrait pas.

Un dossier commençant par un point à la racine offre le même confort — Obsidian
le masque de l'explorateur de fichiers — sans ce couplage. Son statut de
synchronisation est explicite et indépendant.

**Écriture** : par `vault.adapter`, jamais par `vault.create`, qui refuse les
chemins commençant par un point. Le précédent existe (`results-save.ts:458`).

### 5.3 Détection : interrogation régulière, PAS les événements du vault

**Correction du 2026-09-02, apportée pendant l'écriture du plan.** Le tableau
du §3 laissait entendre que `app.vault.on("create")` pourrait servir de
déclencheur. C'est faux ici : les événements du vault ne portent que sur les
fichiers INDEXÉS par Obsidian, et un dossier commençant par un point n'est pas
indexé. Aucun événement ne se déclencherait.

Les deux côtés interrogent donc le dossier à intervalle régulier, par
`adapter.list()`. Ce n'est pas un pis-aller : le plancher de latence est de
toute façon celui de Syncthing, devant lequel quelques secondes d'intervalle ne
pèsent rien. Et l'interrogation fonctionne indépendamment de la façon dont
Obsidian remarque — ou ne remarque pas — un fichier écrit par un autre
programme.

### Forme : un fichier par message, un seul auteur par fichier

C'est la contrainte structurante, et elle vient de Syncthing.

Un fichier de file d'attente partagé, que les deux côtés modifieraient,
produirait une copie de conflit à chaque aller-retour. Le `.stignore` d'Ahmed a
justement été écrit le 2026-08-26 pour tuer une vague de treize conflits : la
conception ne doit pas en réintroduire.

Trois fichiers, trois auteurs distincts, **aucun jamais réécrit par l'autre
côté** — donc aucun conflit possible :

| Fichier | Auteur | Rôle |
|---|---|---|
| `<id>.request.json` | le téléphone | la demande |
| `<id>.claim.json` | le PC travailleur | « je m'en occupe », avec le nom de la machine et l'heure |
| `<id>.result.json` | le PC travailleur | le tableau de questions, ou une erreur explicite |

`<id>` est un identifiant opaque généré par le téléphone, sans caractère
problématique pour un nom de fichier.

## 6. Quelle machine travaille : un réglage, pas une course

Le vault est partagé par un laptop ET un desktop. Les deux peuvent avoir
Obsidian ouvert en même temps.

**Le fichier de réservation ne suffirait pas à les départager** : à travers
Syncthing il n'est pas atomique, les deux machines pourraient le poser avant de
voir celui de l'autre, et généreraient toutes les deux. La conséquence ne serait
pas une corruption, mais un travail fait deux fois et du quota consommé pour
rien.

**Décision** : un réglage booléen désigne la machine travailleuse, par défaut
**faux**. Seule une machine où il est activé réclame les demandes.

Ce n'est pas seulement une parade à la course. Les CLI ne sont pas
nécessairement installés ni authentifiés sur les deux machines : le choix du
travailleur est une vraie décision d'Ahmed, pas un détail d'implémentation à
automatiser.

Le fichier de réservation reste utile, mais son rôle change : il ne sert plus
d'exclusion mutuelle, il sert d'**état** — il permet au téléphone d'afficher
« une machine a pris la demande » plutôt que « en attente d'une machine ».

## 7. Le flux

1. **Téléphone** — le composer existant. Sur mobile, le bouton de génération
   n'appelle plus le CLI : il écrit `<id>.request.json` (prompt, modèle
   souhaité, chemins de sources, langue) et passe en attente.
2. **Syncthing** porte le fichier.
3. **PC travailleur** — le plugin voit apparaître la demande, écrit sa
   réservation, puis génère **par le chemin existant, inchangé**.
4. **PC travailleur** — écrit le résultat, réussite ou erreur.
5. **Syncthing** ramène.
6. **Téléphone** — affiche le résultat dans la page « Générer », exactement
   comme si la génération avait eu lieu sur place.

**Point d'intégration** : `startGeneration` (`src/dashboard/ai.ts:1890`). C'est
là que la bifurcation mobile/desktop se fait, et nulle part ailleurs.

## 8. Ce qui est réutilisé tel quel

Le composer et son interface, le prompt système, la résolution des chemins de
sources (`src/dashboard/prompt-paths.ts`), le parseur, la page quiz.

**Le seul élément neuf est le facteur de transport.** C'est ce qui rend ce lot
petit, et c'est la raison pour laquelle il faut refuser toute tentation
d'améliorer la génération au passage.

## 9. Les échecs, tous traités

| Situation | Traitement |
|---|---|
| Obsidian fermé sur le PC au moment de la demande | le PC **balaie le dossier au démarrage**, pas seulement en écoute — la demande part à l'ouverture, elle n'est jamais perdue |
| Aucune machine travailleuse activée | le téléphone le dit explicitement au bout d'un délai, au lieu de tourner indéfiniment |
| La génération échoue (CLI absent, quota, modèle invalide) | le PC écrit un résultat d'ERREUR ; le téléphone l'affiche. Un échec ne doit jamais se traduire par une attente infinie |
| Le téléphone est éteint quand le résultat arrive | le résultat reste sur disque, il le trouve à la réouverture |
| Demande jamais traitée | nettoyage au-delà de 24 h, par la machine travailleuse |
| Syncthing à l'arrêt d'un côté | rien ne se perd ; tout repart quand la synchronisation reprend |

## 10. Hors périmètre

- **Les images depuis le téléphone.** Le composer les accepte sur desktop, mais
  les faire transiter obligerait à les encoder dans la demande, ce qui
  l'alourdirait énormément. Les fichiers **déjà dans le vault** fonctionnent :
  Syncthing les a déjà portés, et seul leur chemin voyage.
- **Le service en tâche de fond** (Obsidian fermé) — cf. §4.
- **L'annulation d'une demande en cours** depuis le téléphone.
- **Le suivi de progression en direct** : le téléphone sait « en attente »,
  « prise en charge », « terminée », et rien de plus fin.

## 11. Ce que la conception ne peut pas garantir

**La latence.** Le plancher est l'intervalle de synchronisation de Syncthing,
compté deux fois. Si l'attente déplaît à l'usage, le réglage est dans
Syncthing, pas dans le plugin. À mesurer sur le premier essai réel plutôt qu'à
estimer.

**La cohérence des `.stignore`.** Le fichier est local à chaque appareil et ne
se synchronise pas : c'est écrit dans son propre en-tête. Si le téléphone
excluait un jour `.quiz-blocks-jobs/`, les demandes ne partiraient jamais. Rien
dans le plugin ne peut le détecter à coup sûr — le mieux qu'il puisse faire est
de le nommer comme cause probable dans le message d'attente prolongée.

## 12. Vérification

- `npm run check`, plus les jeux de cas existants du projet.
- Le protocole — écriture, relecture, sélection d'une demande à traiter,
  nettoyage — doit être une **logique pure**, testable sans Obsidian ni
  Syncthing, sur le modèle des `scripts/check-*.mjs` qui chargent le code réel.
- `node scripts/audit-vaults.mjs` : le canal ne doit toucher aucun quiz.
- Essai réel de bout en bout, téléphone vers PC, par Ahmed — aucun script ne
  peut prouver qu'un fichier a franchi Syncthing.
