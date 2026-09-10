# Les contrôles du dépôt — pourquoi chacun existe

**Date** : 2026-09-05

Ce document porte le DÉTAIL que `CLAUDE.md` ne peut plus tenir sans dépasser sa
taille cible. Sa règle d'hygiène le dit elle-même : « Ne jamais dupliquer ce que
d'autres fichiers exposent déjà. Pointer, pas dupliquer. »

Chaque entrée dit **le défaut réel que le contrôle empêche**. C'est cette raison,
pas la description du script, qui décide si on a le droit de le contourner — la
réponse étant toujours non.


- `npm run check` — typecheck (`tsc --noEmit`). Toujours lancer après une modif TS.
- `npm run check:host` — **le cliquet de la frontière d'hôte** : aucun fichier de `src/`
  n'importe Obsidian hors d'une liste `RESTANTS` qui ne peut que RÉTRÉCIR (une entrée
  qui n'importe plus rien fait échouer le contrôle, sinon la liste devient un tapis).
  Il annonce le nombre de fichiers encore liés — **33** aujourd'hui. Il couvre les
  trois formes (`from`, `require`, `import()` différé) et toutes les extensions TS ;
  chacune de ces mailles a été une échappatoire vérifiée. Il est dans la CI : lancé à
  la main, c'est la discipline et non le contrôle qui tiendrait la frontière.
  Sa limite : les **extensions DOM** d'Obsidian (`createEl`, `empty`, `setText`…) ne
  sont trahies par aucun `import`. Le seul filet contre elles est
  `npx tsc --noEmit -p apps/windows/tsconfig.json`, d'où la règle qu'aucun fichier
  atteint par ce typecheck ne doit tirer `obsidian.d.ts` — un simple `import type`
  suffisait à le neutraliser.
- `npm run check:dashboard-dom` — le trou que `check:host` ne peut pas fermer seul :
  il ne regarde les extensions DOM d'un fichier QUE tant que ce fichier reste hors
  de `RESTANTS`. Rien n'empêche qu'une tranche future remette
  `import { setIcon } from "obsidian"` dans une page du tableau de bord « pour
  aller vite » et l'ajoute du même geste à `RESTANTS` — ses extensions DOM
  redeviendraient alors invisibles au contrôle, sans qu'aucun message ne le
  signale. Ce script nomme, indépendamment de `RESTANTS`, les pages libérées
  POUR DE BON par la tranche 2.5 : sa liste ne peut que grandir, jamais rétrécir,
  et un retour d'obsidian dans l'une d'elles y échoue directement, sans dépendre
  de l'état de l'autre liste.
- `npm run check:theme` — exhaustivité du thème de l'app (`apps/windows/src/theme/
  host-vars.css`) : le greffon hérite des variables CSS d'Obsidian, l'app doit les
  définir. Une oubliée ne produit AUCUNE erreur — un texte invisible sur un fond de la
  même couleur. Symétrique, comme le cliquet : une variable devenue morte dans le thème
  doit en être retirée. Dans la CI aussi.
- `npm run check:obsidian-host` et `check:windows-host` — les deux implémentations du
  contrat `src/host/types.ts`, chargées avec une fausse `App` / un faux index. Une
  méthode d'hôte qui rend `null` en silence rendrait les images, le bouton ressource ou
  la sauvegarde inertes sans un mot. Chaque cas neuf doit être éprouvé par DISCRIMINANCE
  (casser la règle, voir rougir, restaurer) : un cas qui passe au vert quoi qu'on fasse
  ne prouve rien — c'est arrivé deux fois ici. `check:windows-host` couvre en plus les
  RACINES du dossier composite : `local()` et `contrat()` doivent se composer en
  identité (aller-retour sans perte), et une résolution de lien par nom ne doit jamais
  franchir la racine de la note qui cite — sans cette borne, une image du dossier A
  se servirait, en silence, à une note du dossier B.
- `npm run check:math-render` — la segmentation LaTeX partagée (`$$…$$` testé avant
  `$…$`, l'heuristique qui épargne « 5$ et 3$ ») : le code qu'aucun hôte ne réécrira,
  puisque c'est lui qui décide ce qui EST une formule. Il tourne sur un faux `HostMath`,
  ce qui prouve du même coup que plus rien n'appelle Obsidian — le bouchon de
  `load-src.mjs` jetterait bruyamment.
- `npm run check:app` — build Vite + typecheck de l'application Windows, sans compiler
  le Rust. C'est le contrôle qui attrape une rupture du code PARTAGÉ vue depuis l'autre
  hôte, là où `npm run check` ne voit que le greffon.
- `npm run check:md` et `npm run check:export` — deux jeux de cas ciblés,
  sur les deux logiques qu'une relecture n'arrive pas à juger : le rendu markdown des
  champs texte (`renderInlineText`, `stripInlineMarkdown`) et l'écriture d'un bloc
  quiz-blocks (`exportAll`). Ils chargent le CODE RÉEL via esbuild
  (`scripts/lib/load-src.mjs`), jamais une réplique. Ils existent parce que ces
  deux-là ont déjà régressé plusieurs fois en silence : `3*4*5` rendu en italique, un
  objet imbriqué écrit `[object Object]` (bloc illisible, sauvegarde refusée sans un
  mot). **Pas de framework de test au-delà** ; ne pas en ajouter pour du code qu'une
  lecture suffit à juger.
- `npm run check:quiz-io` — le CÂBLAGE de l'écriture d'un bloc
  (`src/dashboard/detail-io.ts`), qui n'avait rien entre les deux contrôles
  ci-dessus : `check:export` juge la FORME du bloc produit, `audit-vaults.mjs`
  l'aller-retour sur de vrais vaults, et personne ne regardait le geste qui
  pose ce bloc DANS la note. Les quatre défauts qu'il empêche sont tous
  arrivés, tous silencieux, et deux d'entre eux ont régressé la nuit même de
  leur correction (revue codex 2026-07-31) : un bloc écrit en LF dans une note
  CRLF, dont chaque frappe apparaît ensuite comme une réécriture entière dans
  un diff ou une synchro ; un témoin de compare-and-swap mémorisé sous une
  autre forme que ce qui a été écrit, qui fait passer la PREMIÈRE frappe et
  perd la SECONDE sans un mot ; une clôture réécrite en forme canonique, qui
  efface un ` ```quiz-blocks data-owner=alice ` ou l'indentation d'un bloc en
  liste, là où le compare-and-swap ne peut pas s'en apercevoir puisqu'il ne
  compare que le JSON5 ; et le pire, qui ne lève rien et n'affiche rien : un
  remplacement par CHAÎNE au lieu de par FONCTION, où `$1`, `$&` et
  l'apostrophe inversée sont des motifs SPÉCIAUX — un quiz de maths plein de
  `$…$` réinjecte alors la source du bloc à l'intérieur de lui-même. Il éprouve
  aussi le REJEU du rappel de `fs.process`, que le contrat autorise et dont
  dépend le drapeau `ecrit` remis à faux en tête : sans lui, la page annonce un
  succès sur une note qu'elle n'a pas écrite. Le compare-and-swap sur le BLOC
  est la seule garantie à la bonne granularité — le `mtime` parle de toute la
  NOTE, et deux pages ouvertes pouvaient le franchir toutes les deux.
- `npm run check:scheduler` — le noyau de l'ORDONNANCEUR (`src/scheduler/`) : horizon
  de rétention, journal, état dérivé, plan du jour. Sa première section vérifie
  MÉCANIQUEMENT la pureté du noyau (aucun `from "obsidian"`, `document`, `window`,
  `Date.now()`, `new Date()`, `Math.random()`) : c'est ce contrôle qui garantit que le
  même module tournera à l'identique dans les futures applications PC et Android. Le
  casser, c'est perdre la seule partie du code qu'on ne réécrira pas.
- `npm run check:review-store` — l'adaptateur de l'ordonnanceur (`src/review/
  review-store.ts`), éprouvé sur un faux HÔTE plutôt que sur une fausse `App`
  Obsidian depuis que l'application Windows écrit le même journal. Il couvre
  désormais le ROUTAGE entre plusieurs journaux, un par dossier. Le cas qui compte :
  la clé écrite sur disque est LOCALE (`Cours/ch1.md::q1`), jamais préfixée par le
  dossier. Une clé préfixée passerait tous les autres contrôles — le plan lui-même
  proposait un cas qui restait vert avec une clé préfixée — et rendrait l'historique
  de l'application invisible depuis Obsidian, sans qu'aucun message ne le dise.
- `npm run check:engine-review`, `check:module-edit` — les deux autres câblages de
  l'ordonnanceur : l'enregistrement des réponses par le moteur, la date d'examen par
  module.
- `npm run check:review-log` — l'emplacement et la MIGRATION du journal. Il éprouve
  ce qu'aucun disque ne produit sur commande : une écriture qui prétend réussir sans
  rien écrire. Sans la relecture qu'il garde, l'ancien journal serait rangé et les
  révisions n'existeraient plus nulle part — c'est exactement le bug que le code
  fourni verbatim par le plan contenait (une relecture de confirmation qui LEVAIT au
  lieu de dégrader proprement en `confirmed: false`).
- `npm run check:folders` — la conversion du réglage `folder` → `folders` et
  l'unicité des identifiants de dossier. Sans la première, une mise à jour renvoie
  l'utilisateur à l'écran « Choisissez un dossier » alors que son dossier est
  toujours là ; sans la seconde, deux dossiers homonymes confondent leurs chemins et
  l'historique de l'un compte pour l'autre.
- `npm run check:rename-match` — l'appariement des renommages que le surveillant ne
  sait pas nommer lui-même. Les deux défauts qu'il empêche ne sont pas symétriques :
  un appariement manqué coûte l'historique d'une note (au moins visible : elle
  reprend à zéro) ; un appariement FAUX transporte l'historique d'une note vers une
  autre, et ne se voit jamais. C'est ce second défaut, plus fin, qui a été trouvé ici
  a posteriori : une clé de signature non injective (`ids.join(" ")`) faisait
  collisionner `["ip","masque"]` et `["ip masque"]`.
- `npm run check:lesson` — la boucle d'apprentissage (rôles `pre`/`read`/`recall`/`test`,
  tranches, auto-évaluation). **Il doit aller jusqu'au bout** : ce script MEURT sur une
  exception au lieu d'échouer proprement, et une mort en cours de route masque en
  silence tous les groupes qui suivent (c'est arrivé, onze groupes cachés).
- `npm run report:multiblock` — ne vérifie rien, MESURE deux limites connues de
  l'ordonnanceur (notes à plusieurs blocs, notes quiz `source:`) pour qu'elles restent
  visibles au lieu de se redécouvrir. Sort toujours en 0.
- `npm run check:scanner` — charge le vrai `createScanner` et protège l'alignement des
  identifiants avec l'éditeur, les métadonnées légères et les suppressions du cache sur
  bloc absent, invalide ou vide. Il existe parce qu'une clé décalée perdrait l'historique
  de révision et qu'un autosave transitoirement invalide ne doit ni garder une ancienne
  entrée ni polluer la console.
- `npm run check:markers` — passe chaque champ TEXTE de chaque quiz des vaults par la
  vraie fonction de rendu et cherche le markdown qui n'a PAS été traduit (8570 champs
  au 2026-07-31, zéro fuite). Il éprouve la GRAMMAIRE, pas le CÂBLAGE : un champ que
  le moteur affiche sans appeler le rendu du tout y passe pour sain — c'est ce qui
  était arrivé au libellé d'emplacement d'un classement. Le seul filet contre ça est
  de lire le DOM RENDU dans Obsidian ; la commande est dans l'en-tête du script.
- `node scripts/audit-vaults.mjs "<vault>" […]` — **avant une release**, ou après
  toute retouche de `convertParsedToInternal` / `exportAll` : fait l'aller-retour
  lecture → écriture → lecture sur TOUS les quiz de vrais vaults (39 quiz, 756
  questions au 2026-09-04). Deux garanties, pas une :
  1. le bloc réécrit **se relit** — sinon la sauvegarde échoue EN SILENCE chez
     l'utilisateur (la page refuse d'écrire un JSON5 invalide, et le travail reste
     en mémoire jusqu'à la fermeture d'Obsidian) ;
  2. **aucun champ ne disparaît**, comparé un à un. C'est ce deuxième contrôle qui
     a trouvé le pire défaut de la refonte : `textVariant: 'command'` n'était pas
     reconnu par l'éditeur, et éditer un quiz Cisco effaçait ses 23 invites de
     terminal. Les équivalences admises (`prompt` → `promptHtml`, `answer` fondu
     dans `acceptedAnswers`…) sont **justifiées une par une** dans le script ;
     n'y ajouter une exclusion qu'après avoir prouvé qu'il n'y a rien à perdre.
  Aucun fichier n'est modifié.
- Ces scripts appellent `process.exitCode`, **jamais `process.exit()`** : la pile doit
  se dérouler pour que `withSrcModule` retire son dossier temporaire.
- `npm run dev` — esbuild en watch : rebuild + redéploiement à chaque save (JS et CSS).
- `npm run build` — build production → `dist/` + déploiement dans les vaults.
- **Release** : bumper la version dans `src/assets/manifest.json`, créer un tag
  `git tag vX.Y.Z`, `git push` du tag → le workflow `release.yml` build et publie.
  (Ne pas utiliser `npm run release` : il pointe vers un `scripts\release.bat` absent.)

Vérification d'un changement = `npm run check`, plus `check:md` / `check:export` /
`check:markers` si le rendu ou l'écriture sont touchés, **puis** test manuel dans
Obsidian.
