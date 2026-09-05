# Tranche 2 — ce qu'il reste à éprouver à l'écran

**Date** : 2026-09-05
**Contexte** : les douze tâches de `2026-09-05-app-windows-tranche-2.md` sont
faites, revues et corrigées ; les contrôles automatiques passent (`npm run check`,
`check:host` à 41, `check:review-log`, `check:folders`, `check:rename-match`,
`check:review-store`, `check:windows-host`…). Mais **aucun agent n'a
d'affichage** : AUCUNE des douze tâches n'a été vue à l'écran. Cette note est
donc la liste complète — pas un extrait — de ce que ne prouve aucun script.

Lancer avec `npm run app:dev`, ou directement
`apps/windows/src-tauri/target/debug/neo-quiz.exe`. Le greffon se vérifie dans
Obsidian, sur les mêmes vaults.

---

## À ÉPROUVER À L'ÉCRAN

Par ordre de priorité.

1. **Le partage de l'historique.** Jouer un quiz dans l'app (répondre à au
   moins une question d'une note aussi présente dans un vault Obsidian ouvert
   sur le même dossier), puis ouvrir ce vault et regarder la carte « À
   réviser » du tableau de bord : elle doit avoir bougé. Faire l'inverse
   (répondre dans Obsidian, rouvrir l'app).
   *Bon* : la même question sort de « À réviser » des deux côtés.
   *Cassé* : les deux hôtes tiennent chacun leur moitié de l'historique — pour
   le diagnostiquer, ouvrir `<racine>/.neo-quiz/review-log.jsonl` et lire la
   clé de la dernière ligne. Elle doit valoir exactement `Cours/reseau.md::ip`
   (le chemin LOCAL au dossier, suivi de `::` et de l'identifiant de
   question) — **sans** préfixe de dossier (jamais `Efrei/Cours/reseau.md::ip`).
   Une clé préfixée écrite par l'un des deux hôtes rendrait ses révisions
   invisibles de l'autre, sans le moindre message.
2. **La migration sur un vrai vault.** Ouvrir dans l'app un vault qui a déjà
   un ancien journal (`.obsidian/quiz-blocks-results/review-log.jsonl` côté
   greffon, dans un vault où des quiz ont déjà été joués sous Obsidian).
   *Bon* : au démarrage, un compte de lignes migrées est annoncé (dans les
   logs de la fenêtre / la console de dev) ; `.neo-quiz/review-log.jsonl` est
   créé avec les lignes reprises ; un fichier `review-log.jsonl.migrated` est
   posé à côté de l'ancien ; et surtout **l'ancien fichier est toujours là**,
   inchangé, à son ancien emplacement.
   *Cassé* : pas de nouveau journal, un journal vide, ou l'ancien fichier
   renommé/disparu — la garde « écrire, relire pour confirmer, puis seulement
   renommer » aurait été contournée.
3. **Le surveillant de fichiers.** C'est la tâche 1, et elle n'a **jamais**
   été constatée à l'écran — seule sa capability (les permissions Tauri
   `fs:allow-stat`, `fs:allow-watch`, `fs:allow-write-text-file`, etc.) a été
   posée et vérifiée mécaniquement. Ouvrir l'app sur un dossier, la laisser
   tourner, puis modifier une note de ce dossier depuis Obsidian (ou depuis un
   éditeur externe) : renommer une question, ajouter un quiz, supprimer une
   note.
   *Bon* : la liste de l'app se met à jour SEULE, sans redémarrage ni clic.
   *Cassé* : rien ne bouge tant que l'app n'est pas relancée — avant la
   tâche 1, les permissions manquaient et rien ne remontait ; si ça reproduit
   après la tâche 1, c'est un défaut neuf.
4. **Les images d'un quiz**, dans l'app et dans un dossier composite (item 5).
   C'est le premier symptôme visible si la conversion `local()` / `contrat()`
   de l'hôte composite (`apps/windows/src/host/roots.ts`) se trompe de sens.
   *Bon* : l'image d'une question s'affiche, y compris référencée par un nom
   nu depuis un sous-dossier.
   *Cassé* : cadre vide ou icône brisée sur une question qui a une image sous
   Obsidian — regarder si le quiz est dans un dossier autre que le premier
   ouvert (item 5 en est la forme aggravée).
5. **Deux dossiers ouverts en même temps.** Ajouter un second dossier de quiz
   dans les réglages de l'app (jusqu'à dix, spec §6).
   *Bon* : les quiz des deux apparaissent dans une liste unique ; les images
   de chacun s'affichent dans SES propres quiz ; `.neo-quiz/review-log.jsonl`
   existe séparément sous chaque racine (deux journaux distincts) ; et surtout
   — c'est le défaut CRITIQUE trouvé et corrigé en revue de la tâche 6, mais
   jamais vu à l'écran — une image nommée pareil dans les deux dossiers (par
   exemple `schema.png` dans A et dans B) ne doit **jamais** se servir au
   mauvais quiz : une image du dossier A citée par nom nu depuis une note du
   dossier B doit rester cassée, pas résolue sur le mauvais fichier en
   silence.
   *Cassé* : catalogue incomplet, un seul journal partagé (les révisions d'un
   dossier comptent pour l'autre), ou une image qui vient du mauvais dossier.
6. **Un renommage depuis l'Explorateur Windows.** App ouverte sur un dossier,
   renommer une note `.md` depuis l'Explorateur, puis un sous-dossier entier.
   *Bon* : la liste se met à jour avec le nouveau nom, et **l'historique de
   révision suit** (la question renommée n'est pas « nouvelle » dans « À
   réviser »). C'est l'appariement par signature de `check:rename-match`,
   jamais vu tourner sur un vrai renommage.
   *Cassé* : la question repart de zéro (appariement manqué, coûte
   l'historique d'une seule note) — ou pire, une autre question hérite de
   l'historique renommé (appariement FAUX, invisible). Le second cas ne se
   détecte qu'en comparant à la main l'historique attendu.
7. **Une date d'examen à trois jours, puis effacée.** Dans les réglages de
   l'app, poser une date d'examen à J+3 pour le module d'un quiz.
   *Bon* : la carte « À réviser » grossit (l'horizon se resserre, plus de
   questions de ce module deviennent dues). Effacer la date : la carte
   *revient* à sa taille d'avant — pas à zéro, à l'état PRÉCÉDENT le
   resserrement (c'est la fonction pure `appliquerExamDate`, ajoutée en
   correction de la tâche 8/10, qui retire la clé plutôt que de la vider).
   *Cassé* : la carte ne bouge pas en posant la date, ou reste resserrée après
   l'avoir effacée.
8. **L'icône du sélecteur de date**, sur le champ de date d'examen. Ouvrir la
   page réglages en thème sombre (le seul thème de l'app).
   *Bon* : l'icône du calendrier natif (le petit picker de `<input
   type="date">`) est VISIBLE sur le fond sombre.
   *Cassé* : icône noire sur fond sombre, quasi invisible — c'est exactement
   le défaut que la déclaration `color-scheme: dark` à la racine du document
   (posée en correction de la tâche 10, commit `e407006`) doit corriger ;
   rien d'autre dans le dépôt ne peut le prouver, un contrôle mécanique ne
   voit pas une icône de rendu natif.
9. **Le titre de la carte « À réviser ».** Ouvrir la liste des quiz (la carte
   est en tête).
   *Bon* : le titre de la carte a la taille et l'espacement d'un titre de
   SECTION (comme « Mes quiz » dans le tableau de bord du greffon), sans
   marge parasite au-dessus ou en dessous.
   *Cassé* : un `<h3 class="qbd-quizzes-node-label">` porte une classe dont
   l'usage d'origine, dans le greffon, est un `<span>` — la règle CSS ne fixe
   aucun `margin`, donc ce `<h3>` peut hériter la marge par défaut du
   navigateur et décaler tout ce qui suit. Constat différé de la revue de la
   tâche 11, jamais vérifié à l'écran.
10. **L'icône de l'application**, dans la barre de titre de la fenêtre et dans
    la barre des tâches Windows.
    *Bon* : la nouvelle icône (recadrée sur sa masse visible, commit
    `5d05bcb`, antérieur à cette tranche) apparaît aux deux endroits.
    *Cassé* : ancienne icône ou icône générique — **avant de conclure à un
    défaut**, vider le cache d'icônes Windows ou redémarrer l'Explorateur, il
    est connu pour mettre un moment à rafraîchir un `.ico` déjà vu.
11. **Le greffon, une dernière fois.** Dans Obsidian, sur un vault déjà migré
    par l'app (ou l'inverse) : jouer un quiz, l'éditer, ouvrir le tableau de
    bord, générer un quiz par IA.
    *Bon* : exactement l'état d'avant la tranche — rien de ce que la tranche 2
    a touché (le journal, ses trois câblages, l'ordonnanceur) ne doit changer
    le comportement du greffon.
    *Cassé* : n'importe quel écart, en particulier autour de « À réviser » ou
    d'un renommage — c'est le point de contact le plus direct avec le code
    partagé retouché cette tranche.
12. **Un dossier retiré puis rajouté.** Retirer un des dossiers de quiz des
    réglages de l'app, puis le rajouter.
    *Bon* : l'historique de révision de ce dossier REVIENT intact — il vit
    dans `<dossier>/.neo-quiz/review-log.jsonl`, sur le disque, jamais dans
    les réglages de l'app.
    *Cassé* : les questions de ce dossier repartent de zéro après le
    rajout — signe que quelque chose dépend de l'ordre d'ouverture plutôt que
    du contenu du dossier.
13. **Un dossier sur un support absent** (une clé USB retirée, ou un chemin
    réseau déconnecté, configuré comme un des dossiers de quiz). Démarrer
    l'app avec ce support débranché.
    *Bon* : les AUTRES dossiers s'ouvrent quand même, avec un signalement
    clair pour celui qui manque (pas un écran blanc ni un crash).
    *Cassé* : l'app refuse de démarrer, ou les dossiers valides restent vides
    parce qu'une erreur sur l'un a empêché de traiter les autres.

---

## Ce que la tranche a changé DANS le greffon, et qui mérite un coup d'œil

- Le journal de révision a déménagé de `.obsidian/quiz-blocks-results/
  review-log.jsonl` vers `.neo-quiz/review-log.jsonl`, à la racine du vault
  — visible au point 2 ci-dessus. C'est le changement le plus profond de la
  tranche pour un vault existant : la première ouverture après mise à jour
  DOIT migrer, pas repartir d'un journal vide.
- `review-store.ts` (l'adaptateur qui absorbe les conflits Syncthing, le
  fuseau, les renommages) a quitté `dashboard/` pour `src/review/` : aucun
  changement de comportement attendu dans le greffon, seulement un
  déplacement de fichier — un bon candidat si un comportement de révision
  diverge de l'avant-tranche.
- La date d'examen par module existait déjà côté greffon (`ModuleOverride.
  examDate`) ; seule l'app la gagne cette tranche. Rien à revérifier côté
  greffon sur ce point précis, sinon par la boucle du point 11.
