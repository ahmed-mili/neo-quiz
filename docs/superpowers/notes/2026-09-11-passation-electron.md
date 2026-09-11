# Passation — la tranche 3 est finie, la migration Electron est décidée

Écrit le 2026-09-11, pour la session qui reprendra le travail. À lire en entier
avant de toucher au code.

## Où en est le projet

**La tranche 3 est livrée, relue et poussée.** Dix tâches, dix revues, une
seule ronde de correction (la tâche 1). `origin/main` est à jour jusqu'à
`c38a363`.

Le cliquet `npm run check:host` est passé de **28 à 15**, la cible exacte du
plan. Treize fichiers ont quitté `RESTANTS`. L'application Windows sait
désormais **lire, réviser et éditer** un quiz : la page avec son bouton
« Editor », le menu d'une carte, « Nouveau quiz », la suppression.

Les quinze fichiers qui restent liés à Obsidian sont ceux que le plan
annonçait : les huit de la génération IA, les deux de la dictée, `share.ts`,
et quatre de socle (`dashboard.ts`, `types/dashboard-ctx.ts`,
`hotkey-format.ts`, `modal-base.ts`).

## Ce qui reste avant de coder quoi que ce soit

> [!] **Les vérifications à l'écran n'ont pas été faites.** Aucun script ne
> peut les faire. La liste est dans `task-10-report.md` et dans la note
> Obsidian `Projets/Neo Quiz.md`. Les trois qui comptent le plus :
>
> 1. **La croix ferme-t-elle la fenêtre** — la tâche 10 a dû ajouter la
>    permission `core:window:allow-destroy`, sans laquelle la fenêtre ne se
>    fermait plus jamais. Vérifié par lecture, jamais à l'écran.
> 2. **Taper dans une question puis fermer aussitôt** — la frappe doit être
>    dans la note à la réouverture. C'est le Critique réparé par la tâche 10.
> 3. **Ouvrir un quiz depuis un module, revenir** — on doit retomber DANS le
>    module, pas sur la grille.
>
> Ne pas commencer la migration avant : un bug découvert après coup serait
> impossible à attribuer.

## LA DÉCISION : migrer de Tauri vers Electron

Prise le 2026-09-11 après examen sous quatre critères. Le raisonnement complet
est dans la note Obsidian `Projets/Architecture multiplateforme.md` ; voici ce
qu'il faut en retenir pour exécuter.

**Ce n'est pas le choix le moins cher, c'est le choix assumé.** Rester sur
Tauri coûterait environ cinquante lignes de Rust pour la génération. Migrer
coûte environ **2 100 lignes** :

| À refaire | Lignes |
|---|---|
| `apps/windows/src/host` | 1 238 |
| `apps/windows/src-tauri` (Rust) | 71 |
| `scripts/check-windows-host.mjs`, dont 110 assertions | 798 |

`src/` (24 239 lignes) **ne bouge pas d'une ligne**. C'est exactement ce que le
contrat d'hôte a acheté, et c'est la preuve que l'architecture tient.

### Les trois raisons, dans l'ordre de poids

**1. Le moteur de rendu appartient au projet.** Tauri emploie par défaut le
WebView2 **du système**, mis à jour par Microsoft sur la machine de
l'utilisateur (doc Tauri : mode « downloaded bootstrapper » ; figer une version
coûte 180 Mo et transfère la responsabilité des correctifs de sécurité). Pour
une application dont le rendu EST le produit — LaTeX, MathJax, MathLive,
transitions CSS — une mise à jour du moteur peut casser l'affichage chez les
utilisateurs sans qu'on ait touché une ligne. Electron embarque son Chromium.

**2. Moins de frontières, moins d'endroits où les bugs vivent.** Chaque
capacité système traverse l'IPC de Tauri avec une commande Rust et une
permission déclarée. **Trois heurts en trois jours pendant la tranche 3** :

- le plugin shell ne tue que le process PARENT et refuse tout programme hors
  d'une allowlist — découvert en lisant son code source, pas en compilant ;
- `core:window:allow-destroy` manquait, et sans elle la fenêtre ne se fermait
  plus jamais ;
- `fs:allow-write-file` a dû être ajouté à la main pour que `writeBinary`
  fonctionne.

Trois fois du code juste, qui compile, et qui échoue à l'exécution.

**3. La pile la plus favorable au développement assisté.** Le pire mode de
défaillance pour un agent est celui qu'il ne peut pas voir : Tauri échoue à
l'EXÉCUTION là où TypeScript échoue à la COMPILATION. Un seul langage au lieu
de deux plus une configuration de capabilities.

**Et le point qui touche la méthode de ce dépôt** : une grosse part des 798
lignes de `check-windows-host.mjs` existe uniquement pour **doubler la
frontière IPC** (`window.__TAURI_INTERNALS__.invoke`). En Electron, l'hôte
appelle `fs` de Node — un contrôle le teste directement dans un dossier
temporaire, sans double à écrire ni à maintenir. **La discipline de contrôle
marche mieux sans Tauri.**

### Ce qu'on perd, et qui ne compte pas ici

Démarrage plus lent (Chromium doit booter), application de quelques centaines
de mégaoctets, bac à sable moins strict. Ahmed a explicitement écarté ces trois
points : RAM et taille lui sont indifférentes, et l'application lit ses propres
fichiers en local.

## L'ordre, qui n'est pas négociable

1. **Les vérifications à l'écran** de la tranche 3 (ci-dessus)
2. **Un plan de migration écrit**, tâche par tâche, sur le modèle des tranches
   précédentes — `superpowers:writing-plans`, puis exécution par sous-agents
3. **La migration**, contrôle réécrit compris
4. **Puis la génération** (tranche 4), où `child_process` et `taskkill /T`
   rendent inexistant le mur qui la rendait difficile

## Les pièges connus, à ne pas redécouvrir

- **`check:lesson` MEURT sur une exception** au lieu d'échouer proprement : une
  mort en route masque en silence tous les groupes suivants (onze cachés, une
  fois). Son faux hôte doit rester complet face à `src/host/types.ts` — il l'est
  aujourd'hui, vérifié membre par membre le 2026-09-11.
- **Juger un script sur son CODE DE SORTIE**, jamais sur la fin de sa sortie :
  `check:export` affiche « 42/42 cas passent » AVANT son erreur quand il rougit.
- **Un rouge sans assertion rouge ne prouve rien** : il prouve qu'on a cassé le
  script, pas qu'on a cassé la règle. Exiger le LIBELLÉ de l'assertion.
- **Un contrôle vert ne prouve rien tant qu'il n'a pas rougi.** Mesuré :
  `_htmlToText` rendu constant laisse `check:export` ET `check:md` à 0 — aucun
  contrôle n'éprouve le comportement de cette fonction.
- **Le contrat promet la fraîcheur après une écriture** (`src/host/types.ts`,
  « LA FRAÎCHEUR APRÈS UNE ÉCRITURE ») : après `write`, `process`, `writeBinary`
  ou `append`, `getFile` rend le `mtime` neuf. **L'hôte Electron devra tenir
  cette promesse**, et un cas de chaque côté l'éprouve déjà.
- **`flushSave()` et `dispose()` rendent une promesse** qui se résout quand
  l'écriture est TERMINÉE, et le chemin de fermeture l'attend. Ne pas casser ça
  en migrant : c'est ce qui empêche de perdre la dernière frappe.
- **Les plans de ce projet se sont révélés fautifs 31 fois.** Traiter tout
  extrait comme un ARGUMENT, jamais comme une autorité, et chercher les
  appelants par PLUSIEURS voies (import statique, `require`, `import()`
  dynamique, cast, script de contrôle).

## Les dettes ouvertes, à trier

- **`_htmlToText` n'a aucun contrôle mécanique** (employé par
  `detail-question.ts` et `editor/convert.ts`).
- **Les trois fichiers du formulaire ne sont EXÉCUTÉS par aucun contrôle** —
  `detail-question.ts`, `detail-exam.ts`, `detail-form-bridge.ts`. C'est ce trou
  qui a laissé un interrupteur mort six semaines (réparé en `9dfadee`). Une
  sonde jetable a prouvé qu'un contrôle est possible : entrée TS unique qui
  réexporte la fonction de rendu ET `installHost` (le singleton `host/current`
  n'est pas partagé entre deux entrées de `withSrcModule`), plus des bouchons
  `requestAnimationFrame`, `cancelAnimationFrame` et `getComputedStyle`
  par-dessus linkedom.
- **`EXCEPTIONS_APPS` est bornée par une liste, pas par un cliquet de taille.**
- **`audit-vaults.mjs` ne couvre plus grand-chose** : cinq notes à bloc dans
  tous les vaults, contre les « 39 quiz, 756 questions » qu'annonce
  `controles.md`. Le chiffre ment, le corpus a bougé (dossier B1 déplacé).
- **`.qb-btn-danger` ne définit que `:hover`** : « Supprimer » et « Annuler »
  sont identiques au repos, dans la fenêtre comme sous Obsidian.
