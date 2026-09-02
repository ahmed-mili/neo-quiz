# Feuille de route produit — du greffon aux applications

**Date** : 2026-09-02
**Statut** : cap arrêté, chantier 1 prêt à spécifier

## 1. La décision

Le projet devient **deux applications** — PC et Android — et le greffon Obsidian
est **réduit à un lecteur** qui joue les quiz dans les notes de cours.

### Le public

**La promo de B2 d'Ahmed**, pas le grand public. Fait vérifié auprès de lui le
2026-09-02 : ses camarades ont déjà Claude Code, Codex ou Ollama installés.

Cette précision commande tout le reste. Elle a été établie contre mon avis
initial — je raisonnais « étudiant lambda », pour qui un CLI est un mur
infranchissable. Sur une promo cyber et dev, c'est l'outil de travail
quotidien.

### Ce que ce public élimine

**Toute l'infrastructure.** Chacun génère avec son propre abonnement, sur sa
propre machine : pas de serveur, pas de clés à héberger, pas
d'authentification, pas de quota à faire respecter, pas de facture qui grandit
avec le succès. C'était de loin la partie la plus lourde d'une application
partagée, et elle disparaît.

### Pourquoi une application, et pas le greffon enrichi

**Un greffon Obsidian ne peut pas envoyer de notification système sur mobile.**
Il n'existe aucune API pour ça ; les `Notice` sont internes et ne vivent que
tant que l'application est ouverte.

C'est un mur, pas une difficulté. Et il est décisif : sans rappel, une révision
espacée ne tient pas. L'utilisateur devrait penser à ouvrir l'application,
c'est-à-dire faire lui-même le travail que l'ordonnanceur existe pour faire.

Les autres gains sont réels mais n'auraient pas suffi à justifier le
changement : sur PC, une génération qui survit à la fermeture de la fenêtre et
s'annule proprement, là où un greffon meurt avec sa vue ; sur Android,
l'affranchissement des contraintes d'affichage d'Obsidian mobile.

### Ce qu'on ne renonce pas à garder

Jouer le quiz **au bas du chapitre, dans la note de cours**. C'est le
différenciateur du projet — sans lui, il ne reste qu'une application de quiz de
plus, face à des concurrents qui ont dix ans d'avance. Le greffon lecteur le
préserve.

## 2. Ce qui se réutilise, mesuré

| Partie | Lignes | Devenir |
|---|---|---|
| Moteur (`src/engine/`, `engine.ts`) | 8 271 | **Réutilisé.** Sur 23 fichiers, **5 seulement** importent l'API Obsidian ; le reste est du DOM et de la logique. |
| Tableau de bord (`src/dashboard/`) | 13 924 | Retiré du greffon. La conception se transpose dans l'app, le code non. |
| Éditeur (`src/editor/`) | 2 134 | Retiré du greffon. |
| Types, i18n, utilitaires | ~1 100 | Réutilisés. |

Le greffon lecteur pèserait environ **9 600 lignes contre 26 000 aujourd'hui**,
soit **63 % de code en moins**.

Cette maigreur est le point important : le coût d'entretien d'un logiciel suit
sa surface. Un lecteur n'a ni fournisseurs IA à suivre, ni modèles qui
apparaissent et disparaissent, ni CLI dont l'authentification expire. Il ne
rouille pas, parce qu'il n'a rien à quoi rouiller. C'est ce qui rend viable de
garder deux produits, là où deux produits complets condamneraient l'un des
deux.

## 3. Les quatre chantiers, dans l'ordre

### Chantier 1 — L'ordonnanceur *(à faire maintenant)*

Étant donné l'historique des réponses et un horizon de rétention, décider
**quelles questions sont dues aujourd'hui** et dans quel ordre les poser.

**Pourquoi en premier, alors que ce n'est pas l'application.** Trois raisons
qui tiennent ensemble :

1. **C'est ce qui n'existe pas.** Le moteur existe, la boucle existe et Ahmed
   l'a validée le 2026-09-02. La pièce manquante est celle qui décide quoi
   montrer et quand.
2. **C'est le seul code qu'on ne jettera pas.** De la logique pure, sans
   Obsidian, sans écran, sans réseau : le même module tournera à l'identique
   dans le greffon aujourd'hui et dans les deux applications demain.
3. **Il doit être réglé sur des semaines de vraies révisions.** La note de
   méthode l'énonce sans détour : la fonction d'ordonnancement, la taille de
   tranche et le seuil de bascule entre exemple résolu et problème autonome
   sont des paramètres empiriques, pas des résultats de recherche. Le régler
   dans le greffon pendant que l'application se construit fait gagner ces
   semaines au lieu de les perdre.

**Ce que la note de méthode a déjà tranché**, et qu'il ne faut pas rouvrir :
échec vers un intervalle court, succès vers un intervalle plus long, jamais de
sortie définitive du système après une réussite ; l'intervalle dépend de
l'horizon visé (20 à 40 % pour une échéance à une semaine, 5 à 10 % pour une
échéance à un an) ; pas de progression expansive imposée ; l'entrelacement ne
décide que de l'ORDRE, jamais de ce qui est dû, et il ne s'applique qu'aux
familles confusables.

**Reste ouvert** : comment obtenir l'horizon de rétention (date de partiel
saisie, déduite du calendrier, ou défaut), et comment lisser la charge
quotidienne.

### Chantier 2 — L'application PC

L'enveloppe qui porte le moteur, l'ordonnanceur et la génération par CLI.

**La question à trancher avant toute ligne de code** : *où vivent les quiz d'un
utilisateur qui n'a pas Obsidian ?* Dans le greffon ils vivent dans des notes.
Dans l'application, il faut un modèle de contenu — fichiers, base locale — et
ce choix décide de l'import, du partage entre camarades et de la
synchronisation. Rien ne doit être écrit avant.

Deuxième décision : la pile technique. Elle conditionne le chantier 3, qui doit
partager le maximum avec celui-ci.

### Chantier 3 — L'application Android

Réviser, notifier, et **demander au PC** quand il faut générer.

Le mur ne bouge pas : un téléphone ne peut lancer aucun CLI. Le transport est
déjà conçu — voir `2026-09-02-mobile-generation-design.md`, dont le protocole
reste valable entre deux applications comme il l'était entre deux greffons.

### Chantier 4 — Le greffon réduit au lecteur

Retirer 16 602 lignes. **En dernier, et seulement une fois que l'application
assure réellement la génération et l'édition** — sinon on supprime une capacité
avant que son remplaçant existe.

## 4. Ce qui n'est pas décidé, et ne doit pas l'être par défaut

- **Le modèle de contenu de l'application** (chantier 2). La question la plus
  structurante de tout le projet.
- **La pile technique** des deux applications.
- **La distribution** aux camarades : lien, fichier, dépôt.
- **Le partage de quiz entre étudiants.** Le public visé a les mêmes cours, les
  mêmes PDF et les mêmes partiels : un quiz fait par l'un sert tel quel aux
  autres. C'est peut-être plus précieux que l'application elle-même, et ce
  n'est aujourd'hui qu'une remarque, pas une décision.

## 5. Ce que ce document ne prétend pas être

Ce n'est pas un plan d'implémentation. Le chantier 1 en mérite un ; les
chantiers 2 à 4 ont besoin d'une conception avant, et celle-ci dépend de
décisions qui ne sont pas prises.

L'ordre lui-même est la seule chose que ce document verrouille — et il tient à
une raison simple : construire d'abord ce dont on est sûr qu'il ne sera pas
jeté.
