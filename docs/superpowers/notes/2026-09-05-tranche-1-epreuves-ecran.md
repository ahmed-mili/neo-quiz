# Tranche 1 — ce qu'il reste à éprouver à l'écran

**Date** : 2026-09-05
**Contexte** : les douze tâches de `2026-09-04-app-windows-tranche-1.md` sont
faites, revues et corrigées ; 17 contrôles automatiques passent. Mais **aucun
agent n'a d'affichage** : rien de ce qui suit n'est prouvé, et c'est
précisément ce qu'aucun script ne saura jamais voir.

Lancer avec `npm run app:dev`, ou directement
`apps/windows/src-tauri/target/debug/neo-quiz.exe`.

---

> **2026-09-05 — le point 1 est VÉRIFIÉ.** Ahmed a ouvert un quiz de son vault
> Efrei dans la fenêtre : il tourne. Le livrable de la tranche 1 — « jouer un
> quiz de ses notes sans Obsidian » — est donc atteint et constaté, pas
> seulement déduit des contrôles.
>
> Les points 2 à 14 restent à éprouver au fil de l'usage. Ils ne bloquent plus
> la tranche : ce sont désormais des vérifications de non-régression.

## À ÉPROUVER À L'ÉCRAN

Par ordre de priorité. `npm run app:dev`, dossier = un vrai vault.

1. **Un quiz se joue.** Cliquer une carte de la liste.
   *Bon* : l'en-tête (flèche · titre · compte · chemin) puis le quiz, qui
   répond aux clics et enchaîne les questions.
   *Cassé* : écran vide, ou le message « Impossible de lire … » — dans ce cas le
   message **nomme le fichier et la cause**, c'est le diagnostic.
2. **Le retour, puis la réouverture.** Flèche retour → la liste revient ;
   rouvrir le même quiz.
   *Bon* : le quiz **repart de zéro** (score, progression, chronomètre).
   *Cassé* : il reprend où il en était, ou la liste se redessine deux fois
   quand une note change (abonnement empilé).
3. **La fuite d'instances** — le point le plus coûteux à rater, invisible sinon.
   Ouvrir/fermer un quiz **dix fois**, puis redimensionner la fenêtre.
   *Bon* : une seule instance réagit (un `console.count` dans le
   `ResizeObserver` du moteur compte 1 par redimensionnement) ; la mémoire de
   l'inspecteur revient à son niveau.
   *Cassé* : dix réactions par redimensionnement, mémoire qui monte à chaque
   aller-retour. C'est exactement ce qu'on verrait si `__quizDestroy`
   n'était pas appelé.
4. **Les cinq types de question** : choix unique, choix multiples, texte,
   ordonnancement, appariement.
   *Bon* : chacun se saisit et se corrige comme sous Obsidian.
   *Cassé* : un type qui ne réagit pas, ou dont la correction ne s'affiche pas.
5. **Les transitions et la hauteur.** Passer d'une question courte à une
   question longue.
   *Bon* : la piste glisse, la hauteur suit sans saut ni contenu coupé.
   *Cassé* : slide qui saute, hauteur figée sur la question précédente
   (`ResizeObserver` non branché dans la fenêtre).
6. **Les images `![[image.png]]`.**
   *Bon* : l'image s'affiche.
   *Cassé* : cadre vide ou icône brisée → la portée du protocole d'asset n'est
   pas rouverte au démarrage (deux portées, cf. `allow_folder`).
7. **Les mathématiques `$…$`** et une question `type: math`.
   *Bon* : les formules sont rendues ; le champ MathLive s'ouvre et son clavier
   virtuel montre ses deux icônes Lucide.
   *Cassé* : le LaTeX brut reste à l'écran, ou le clavier montre des carrés
   (fontes non inlinées).
8. **Mode examen** (`mode: "exam"`).
   *Bon* : le chronomètre tourne, le toast de fin de temps s'affiche (toast de
   l'app, pas d'Obsidian).
   *Cassé* : pas de chronomètre, ou une `Notice` qui n'apparaît nulle part.
9. **Mode leçon.**
   *Bon* : les rôles `read` / `recall` / `test` s'enchaînent.
   *Cassé* : les cartes `read` manquent, ou l'auto-évaluation ne s'affiche pas.
10. **Une note à DEUX blocs `quiz-blocks`** (par exemple
    `Templates\Template Quiz Blocks.md`).
    *Bon* : seul le **premier** bloc est joué — même limite que le catalogue.
    *Cassé* : le second joué, ou une erreur : la page aurait divergé du scanner.
11. **Une note dont le bloc est volontairement cassé** (JSON5 invalide).
    *Bon* : le message nomme le fichier et la cause.
    *Cassé* : écran blanc muet.
12. **Le greffon, une dernière fois** : jouer un quiz, l'éditer, ouvrir le
    tableau de bord, générer un quiz par l'IA.
    *Bon* : exactement l'état d'avant la tranche.
    *Cassé* : n'importe quel écart — la tranche ne devait rien y changer.

---

## Deux épreuves de plus, qui ne viennent pas de la page de quiz

13. **Les DEUX portées de `allow_folder`** — l'épreuve la plus instructive, et
    celle qu'aucun script ne verra jamais. Retirer la ligne
    `asset_protocol_scope` de `apps/windows/src-tauri/src/lib.rs`, reconstruire,
    ouvrir un quiz à images.
    *Attendu* : les notes se lisent, la liste s'affiche, **et aucune image
    n'apparaît — sans le moindre message d'erreur**. C'est exactement le défaut
    que le commentaire de la commande décrit. Restaurer ensuite.

14. **La suppression d'un DOSSIER pendant que l'app tourne.** Supprimer un
    sous-dossier de quiz.
    *Bon* : ses quiz disparaissent du catalogue.
    *Cassé* : ils y restent jusqu'au redémarrage — le surveillant ne remonte
    alors pas un évènement par fichier contenu. Limite non vérifiée, mesurable
    en une minute.

## Ce que la tranche a changé DANS le greffon, et qui mérite un coup d'œil

- L'anneau juste/faux des onglets était invisible depuis toujours (deux
  variables CSS référencées sans repli et définies nulle part). Il devrait
  maintenant apparaître **dans Obsidian aussi**.
- Le toast d'échec de sauvegarde des résultats porte désormais la **vraie
  cause** (permissions, disque plein) au lieu d'un message générique parlant du
  « vault ».
- `resourceUrl` résout maintenant un chemin avant de le convertir, des deux
  côtés. Une image d'option référencée par un nom nu depuis un sous-dossier
  devrait s'afficher là où elle restait cassée. **C'est le seul changement de
  la tranche qui puisse modifier un rendu existant** : ni `check:markers` ni
  `audit-vaults` ne chargent une image.
- Une capacité a été RETIRÉE : le repli qui ouvrait une ressource dans un
  onglet Obsidian quand l'ouverture externe échouait. Il ne se déclenchait que
  si `app.openWithDefaultApp` était absent ET que le repli Electron échouait.
  Si une ressource ne s'ouvre plus, c'est là qu'il faut regarder.
