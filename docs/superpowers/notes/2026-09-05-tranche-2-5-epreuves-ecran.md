# Tranche 2.5 — ce qu'il reste à éprouver à l'écran

**Date** : 2026-09-05
**Contexte** : les huit tâches de `2026-09-05-app-windows-tranche-2-5.md` sont
faites, revues et corrigées ; les contrôles automatiques passent (`npm run
check`, `check:host` à 33, `check:dashboard-dom`, `check:app`, `npm run
build`…). Mais **aucun agent n'a d'affichage** : AUCUNE des huit tâches n'a été
vue à l'écran côté APPLICATION — pas même la tâche 7, qui monte la coquille du
tableau de bord elle-même. Deux défauts purement visuels (la classe CSS du
rail, le routage de deux navigations) ont déjà été trouvés et corrigés en
LISANT le code et le CSS, jamais en les regardant tourner. Cette note est donc
la liste complète de ce qu'aucun script ne peut prouver.

Lancer avec `npm run app:dev`, ou l'exécutable déjà livré
(`neo-quiz.exe` / l'installeur NSIS du 2026-09-05 21h49). Le greffon se
vérifie dans Obsidian, sur le(s) même(s) vault(s) que l'app ouvre.

---

## À ÉPROUVER À L'ÉCRAN

Par ordre de priorité.

1. **Le rail s'affiche avec sa largeur et son fond.** C'est le point le plus
   risqué : le conteneur du rail porte la classe `qbd-sidebar` (88px, définie
   dans `src/assets/css/`) — le plan d'origine faisait porter `qbd-nav`, une
   classe qu'AUCUNE règle CSS ne cible, et l'implémenteur de la tâche 7 l'a
   corrigé sans que personne ne le voie tourner.
   *Bon* : un rail vertical de largeur fixe, fond distinct du contenu, logo en
   haut, les quatre entrées (Accueil / Mes quiz / Générer / Réglages) empilées
   avec icône + libellé alignés, l'entrée active surlignée.
   *Cassé* : un rail sans largeur ni fond (les entrées collées au bord, fond
   transparent sur le fond de la fenêtre), ou des entrées empilées sans mise en
   page (pas d'icône, pas d'alignement, texte brut).

2. **L'accueil ressemble au tableau de bord du greffon.** Ouvrir les deux côte
   à côte sur le MÊME vault/dossier (Obsidian + l'app pointée sur le même
   chemin) : héros « Reprendre » teinté par la couleur du module du dernier
   quiz joué (`--accent` posé en style inline, halo animé, barre de
   progression), les trois tuiles de stats, section « À réviser », section
   « À faire » avec ses badges « En cours · x % », section « Complétés »
   repliée par défaut.
   *Bon* : mêmes comptes, mêmes couleurs de module, mêmes quiz dans chaque
   section des deux côtés.
   *Cassé* : un écart de compte veut dire que les deux hôtes ne lisent pas le
   même catalogue ; une couleur de module différente veut dire que le réglage
   `quizzesModuleMapNote` de l'app (son propre `settings.json`, séparé du
   `data.json` du greffon) ne pointe pas vers la même note de correspondance
   que côté Obsidian — à vérifier avant de conclure à un bug si les deux n'ont
   jamais été alignés à la main.

3. **Pas de clignotement** quand une note est sauvegardée pendant que l'accueil
   est affiché. Modifier une note de quiz depuis un éditeur externe (ou
   Obsidian ouvert sur le même dossier) pendant que l'app affiche l'accueil.
   *Bon* : le contenu se met à jour sans reproduire l'animation d'entrée
   (`qbd-home-enter`) — pas de flash, pas de fondu qui rejoue.
   *Cassé* : la page rejoue son animation d'entrée à chaque sauvegarde. En
   code, `peindre()` (`apps/windows/src/ui/dashboard-shell.ts`) calcule
   `entering = vueCourante !== dernierePeinte` : un redessin déclenché par le
   scanner (`deps.scanner.onChange`) doit tomber sur `entering = false`,
   puisque `dernierePeinte` a déjà la valeur de `vueCourante`. Si ça clignote,
   c'est que ce calcul ne se comporte pas comme lu.

4. **La navigation.**
   - Rail : Accueil → Mes quiz → Accueil, plusieurs fois.
   - Drill-down d'un module dans « Mes quiz », retour par le fil d'Ariane, puis
     retour par le rail (cliquer « Accueil » alors qu'on est descendu dans un
     module).
   - Cliquer une carte de quiz (accueil ou « Mes quiz ») : ouvre le lecteur de
     quiz (pas de page « détail » dans l'app — c'est le repli volontaire posé
     en tâche 7, `navigate("detail", …)` → `onOpenQuiz`). Fermer le quiz :
     *Bon* : retour exactement sur la page où on était (Accueil **ou** Mes
     quiz, pas systématiquement Accueil) — `vueCourante` est un état de
     module, pas réinitialisé par le montage/démontage du quiz. *Cassé* : le
     retour d'un quiz atterrit toujours sur Accueil même si on était sur
     « Mes quiz ».
   - Ouvrir Réglages depuis le rail, revenir : même vérification (retour sur
     la page quittée, pas un reset).

5. **« Générer » est visiblement désactivé** dans le rail (classe
   `qbd-nav-item--disabled`), avec une infobulle native au survol (attribut
   `title`, texte « Bientôt disponible » / « Coming soon » selon la langue). Cliquer
   dessus ne doit RIEN faire. Séparément, sur l'accueil, le bouton
   « Generate a quiz » (CTA d'en-tête ou d'onboarding) doit lui aussi ne mener
   nulle part au clic — silencieusement, sans page vide ni erreur console : la
   coquille refuse elle-même la navigation vers « ai » (`naviguer()` dans
   `dashboard-shell.ts`), sans passer par `canOpen` qui ne gouverne que le
   rail.

6. **Les cartes n'ont pas de « ⋯ »**, il n'y a ni « + Nouveau dossier » ni
   sélecteur « Recent ▾ » au-dessus de la liste des quiz : c'est ATTENDU, ces
   éléments dépendent de modals et d'`ui-select.ts` (Obsidian), hors périmètre
   de cette tranche — tranche 2.6. Vérifier seulement que leur absence ne
   casse pas la mise en page (pas d'espace vide qui a l'air d'un bouton
   manquant, pas de rangée bancale à l'endroit où vivrait le sélecteur).

7. **Les cinq réglages de page persistent** entre deux lancements
   (`quizzesExpandedFolders`, `quizzesGrouping`, `quizzesModuleOverrides`,
   `quizzesModuleMapNote`, `quizzesArchivedFolders` — écrits dans le
   `settings.json` de l'app, séparé de celui du greffon). **Attention** :
   aujourd'hui seul le premier a une commande dans l'app pour le changer — les
   quatre autres sont lus mais n'ont encore AUCUN contrôle d'interface côté app
   (le sélecteur de regroupement, l'édition de module et le menu d'archivage
   sont tous des modals/`ui-select`, tranche 2.6). Le test réel et complet :
   replier/déplier un dossier sous « Mes quiz », **ou** replier/déplier
   « Complétés » sur l'accueil (même clé, préfixée `home:completed` vs le
   chemin du dossier), fermer l'app, la rouvrir : l'état doit avoir survécu.
   Ne pas chercher à éprouver les quatre autres clés depuis l'UI de l'app —
   il n'y a pas encore de quoi les changer.

8. **Le greffon, une dernière fois.** Dans Obsidian : tableau de bord, accueil,
   « Mes quiz », menus « ⋯ » (renommer/archiver un dossier, créer un quiz),
   génération IA — exactement l'état d'avant cette tranche. Cette tranche a
   beaucoup touché au code partagé (`nav.ts`, `home.ts`, `quizzes.ts`,
   `quizzes-render.ts`, `collapsible.ts`, `quiz-card.ts`, `module-card.ts`,
   `stats-store.ts`) : c'est le point de contact le plus direct avec ce que la
   tranche a retouché.

---

## Ce que la tranche a changé, et qui mérite un coup d'œil

- Trois modules purs sont nés du portage et n'existaient pas avant cette
  tranche : `src/dashboard/module-map-note.ts` (la lecture de la note de
  correspondance, tâche 2), `src/dashboard/folder-archive.ts` et
  `src/dashboard/module-icons.ts` (tâche 6, extraits pour que l'app puisse
  importer les pages sans tirer `ui-select.ts` ni `icon-picker.ts` dans son
  bundle). Les deux derniers sont nés d'un défaut de plan sérieux (dix-septième
  défaut, ruling 8 du journal) : trois tâches déjà commitées auraient empêché
  `vite build` de l'app de passer, sans qu'aucun contrôle mécanique d'alors ne
  puisse le dire — seule la tâche 7, en important réellement ces pages, l'a
  révélé.
- `src/dashboard/` n'est donc plus un dossier que le chantier 4 (réduction du
  greffon) pourra supprimer en bloc : `CLAUDE.md` le dit maintenant
  explicitement, en le mettant en regard de la spec de l'ordonnanceur (§3), qui
  affirmait encore l'inverse pour l'adaptateur (déjà sorti vers `src/review/`
  en tranche 2) sans jamais avoir été mise à jour sur le reste du dossier.
- Deux membres de `DashboardShellCtx` (`buildCardMenu?`/`buildModuleMenu?`
  devenus `openCardMenu?`/`openModuleMenu?`, `reviewStore?`) et plusieurs
  autres (`pickIcon?`, `createQuiz?`, `createFolder?`) sont optionnels et
  absents côté app : c'est délibéré (D5), pas un oubli — la tranche 2.6 les
  remplira tous d'un coup.
