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
  Il annonce le nombre de fichiers encore liés — **42** aujourd'hui. Il couvre les
  trois formes (`from`, `require`, `import()` différé) et toutes les extensions TS ;
  chacune de ces mailles a été une échappatoire vérifiée. Il est dans la CI : lancé à
  la main, c'est la discipline et non le contrôle qui tiendrait la frontière.
  Sa limite : les **extensions DOM** d'Obsidian (`createEl`, `empty`, `setText`…) ne
  sont trahies par aucun `import`. Le seul filet contre elles est
  `npx tsc --noEmit -p apps/windows/tsconfig.json`, d'où la règle qu'aucun fichier
  atteint par ce typecheck ne doit tirer `obsidian.d.ts` — un simple `import type`
  suffisait à le neutraliser.
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
  ne prouve rien — c'est arrivé deux fois ici.
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
- `npm run check:scheduler` — le noyau de l'ORDONNANCEUR (`src/scheduler/`) : horizon
  de rétention, journal, état dérivé, plan du jour. Sa première section vérifie
  MÉCANIQUEMENT la pureté du noyau (aucun `from "obsidian"`, `document`, `window`,
  `Date.now()`, `new Date()`, `Math.random()`) : c'est ce contrôle qui garantit que le
  même module tournera à l'identique dans les futures applications PC et Android. Le
  casser, c'est perdre la seule partie du code qu'on ne réécrira pas.
- `npm run check:review-store`, `check:engine-review`, `check:module-edit` — les trois
  câblages de l'ordonnanceur : l'adaptateur Obsidian, l'enregistrement des réponses par
  le moteur, la date d'examen par module.
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
