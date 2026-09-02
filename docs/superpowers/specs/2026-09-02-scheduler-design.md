# L'ordonnanceur de révision — conception

**Date** : 2026-09-02
**Statut** : conception validée, plan d'implémentation à écrire
**Chantier** : 1 de `2026-09-02-roadmap-produit.md`
**Source de méthode** : `Personal/Productivité/Les meilleures méthodes d'apprentissage.md`

## 1. Le problème, et le périmètre exact

Le plugin sait poser des questions. Il ne sait pas décider **lesquelles poser
aujourd'hui**. La progression est enregistrée par quiz (`stats-store.ts` indexe
par chemin de note : `bestScore`, `attempts`, `lastPlayed`), jamais par question,
et rien ne modélise l'oubli.

Ce document conçoit l'ordonnanceur : étant donné l'historique des réponses et un
horizon de rétention, **quelles questions sont dues aujourd'hui, et dans quel
ordre les poser**.

**La contrainte qui commande tout le reste** : de la logique pure. Ni Obsidian, ni
écran, ni réseau, ni horloge. Le même module doit tourner à l'identique dans le
greffon aujourd'hui et dans les applications PC et Android demain. C'est ce qui
rend ce travail non jetable, et c'est pourquoi la frontière est imposée
mécaniquement (§3) plutôt que promise dans un commentaire.

**Dans le périmètre** : le noyau, le journal qui l'alimente, l'enregistrement des
réponses par le moteur, une surface de consultation minimale, et la saisie d'une
date d'examen.

**Hors périmètre** : la session « une seule chose » composée de questions venant
de plusieurs quiz (c'est la première chose que construira l'application PC) ; la
détection du régime d'expertise et la distinction déclaratif / procédural ; le
type de question « étape manquante ».

## 2. Ce que la note de méthode a tranché, et qui ne se rouvre pas

Rappelé ici pour que le plan d'implémentation n'ait pas à retourner à la note.

- **Échec vers un intervalle court, succès vers un intervalle plus long.** Jamais
  de sortie définitive du système après une réussite : une question qui sort
  après un succès sacrifie exactement ce que l'espacement sert à obtenir.
- **L'intervalle dépend de l'horizon visé** : de l'ordre de 20 à 40 % de
  l'horizon pour une échéance à une semaine, 5 à 10 % pour une échéance à un an
  (Cepeda et al. 2008). Il n'y a pas de règle unique, et la courbe a une crête :
  trop court et trop long sont tous deux sous-optimaux.
- **Aucune progression expansive imposée.** Karpicke & Roediger obtiennent le
  résultat inverse de l'intuition J1 / J7 / J14 : la séquence expansive gagne à
  très court terme et perd après deux jours. C'est l'espacement absolu total qui
  compte, pas la forme de la progression.
- **L'entrelacement décide de l'ORDRE seulement, jamais de ce qui est dû**, et
  uniquement entre familles confusables. Le modérateur est la similarité
  (Brunmair & Richter) : sur des listes de mots, l'entrelacement est
  *défavorable* (g = -0,39).
- **Ni SM-2 ni FSRS ne sont validés scientifiquement.** Ce sont des heuristiques
  d'ingénierie, à traiter comme telles.

## 3. La frontière : ce qui est pur, ce qui ne l'est pas

| Ce que c'est | Où | Survit au chantier 4 ? |
|---|---|---|
| Le noyau | `src/scheduler/` | **oui**, tel quel |
| L'adaptateur Obsidian (journal sur disque, renommages, catalogue) | `src/dashboard/review-store.ts` | non |
| La surface de consultation | accueil du dashboard | non |
| L'enregistrement des réponses | `src/engine/` (une interface, pas une dépendance) | oui |

L'adaptateur vit dans `dashboard/` **par choix** : c'est le dossier que le
chantier 4 supprime. L'arborescence reproduit la frontière de la feuille de
route, au lieu de la laisser à la mémoire de celui qui fera la suppression.

### La pureté est imposée, pas promise

Aucun fichier de `src/scheduler/` ne contient :

| Interdit | Pourquoi |
|---|---|
| `from "obsidian"` | le module doit se charger hors d'Obsidian |
| `document`, `window` | pas d'écran |
| `Date.now()`, `new Date()` | **l'heure est une entrée**, jamais une lecture : un ordonnanceur qui lit l'horloge est intestable et non reproductible |
| `Math.random()` | le déterminisme est la condition du test ; si du hasard devient utile, il entrera par une graine passée en paramètre |

`scripts/check-scheduler.mjs` lit les fichiers et refuse ces symboles. Un
manquement échoue bruyamment, au lieu d'éroder la portabilité en silence.

## 4. Le modèle : trois entrées, aucun état conservé

Le noyau ne retient rien entre deux appels. Tout est dérivé, à chaque fois, de
trois entrées.

### 4.1 Le journal des révisions

Une ligne par réponse. C'est la **seule chose persistée** de tout le système.

```ts
interface ReviewEvent {
  t: "answer";
  /** Clé opaque de la question. Le noyau ne l'interprète JAMAIS. */
  q: string;
  /** Horodatage epoch ms. */
  at: number;
  grade: ReviewGrade;
  /** Rôle au moment de la réponse. Copié, jamais relu dans la note. */
  role?: QuestionRole;
}

type ReviewGrade =
  | "correct" | "wrong"                      // jugement objectif
  | "understood" | "partial" | "review"      // auto-évaluation (TextOnlyRating)
  | "skipped"                                // « Je ne sais pas » explicite
  | "seen";                                  // carte `read` : aucun verdict
```

Trois décisions y sont enfermées.

**`q` est opaque.** Le noyau ne sait pas ce qu'est un chemin de note. Le chantier
2 doit choisir où vivent les quiz d'un utilisateur sans Obsidian ; ce choix ne
doit rien pouvoir casser ici.

**`role` est copié dans l'événement.** Une question peut changer de rôle, et un
journal qui dépendrait des notes pour être interprété ne se transporterait pas.
Un journal auto-suffisant se fusionne entre deux appareils, ce dont le chantier 3
aura besoin.

**Les grades d'auto-évaluation réutilisent le vocabulaire existant**
(`TextOnlyRating`, `src/types/quiz.ts`). Valeurs persistées : jamais traduites.

### 4.2 Le catalogue

Ce qui existe **aujourd'hui**. Une question supprimée d'une note disparaît du
plan, même si le journal la contient.

```ts
interface ScheduledItem {
  q: string;
  /** Clé opaque du module : porte l'horizon, et borne l'entrelacement. */
  module: string;
  /** Clé opaque du quiz ou de la tranche d'origine. */
  source: string;
  /** Famille confusable, si le contenu la déclare. */
  topic?: string;
  role?: QuestionRole;
}
```

### 4.3 Les horizons

`Record<module, number | null>` : la date d'examen en epoch ms, ou `null`.

### 4.4 Le format du journal appartient au noyau

Le noyau possède la sérialisation et la relecture (JSONL, une ligne par
événement) ; l'adaptateur ne fait que lire et écrire des octets. C'est ce qui
maximise la part transportable.

**La relecture est tolérante** : une ligne illisible est ignorée et comptée, elle
n'interrompt jamais le parcours. Un fichier tronqué par une fermeture brutale
perd une révision, pas un semestre. C'est le principal avantage du JSONL sur un
objet JSON unique, et la raison de le préférer.

**Une seconde forme de ligne existe, le renommage** :

```ts
interface RenameEvent { t: "rename"; from: string; to: string; at: number; }
```

appliquée en séquence à la relecture, par préfixe (renommer un dossier déplace
toutes ses notes en une ligne, comme `stats-store.ts` le fait déjà par préfixe).

**Pourquoi une ligne plutôt qu'une réécriture** : le journal reste strictement en
ajout. Réécrire un fichier d'un mégaoctet au moment où Obsidian se ferme est
précisément la façon de le perdre ; un ajout de quatre-vingts octets ne court pas
ce risque. Et deux appareils qui fusionnent leurs journaux n'ont rien à
réconcilier.

## 5. L'intervalle : l'horizon plafonne, il n'ordonne pas

### 5.1 Le ratio

`ratio(H)` interpole logarithmiquement entre les deux ancrages de Cepeda :

| Horizon | Ratio | Plafond obtenu |
|---|---|---|
| 7 j | 0,300 | 2,1 j |
| 30 j | 0,217 | 6,5 j |
| 90 j | 0,155 | 13,9 j |
| 365 j | 0,075 | 27,4 j |

soit `ratio(H) = 0,4107 - 0,05690 × ln(H_jours)`.

Les deux constantes sont **calculées depuis `ratioAncres`** (§8), jamais écrites
en dur : sinon déplacer un ancrage ne changerait rien, et le paramètre serait un
décor.

**H est borné à [7 j, 365 j] pour le calcul du ratio seulement.** Hors de cet
intervalle, on n'extrapole pas : Cepeda donne deux points, la fonction ne prétend
rien savoir au-delà. Sans ce bornage la formule devient absurde (le ratio
s'annule vers 1364 jours, puis devient négatif), et un horizon de trois ans
donnerait un plafond *plus court* qu'un horizon d'un an.

Avec le bornage, `plafond(H) = ratio(clamp(H)) × H` est strictement croissant sur
tout le domaine : sur [7, 365] sa dérivée vaut `ratio(H) - 0,05690`, positive
puisque `ratio ≥ 0,075` ; au-delà elle est linéaire. C'est vérifiable, et c'est
vérifié (§12).

### 5.2 La règle

```
plafond   = ratio(clamp(H, 7 j, 365 j)) × H    où H = temps RESTANT jusqu'à l'examen
succès    → interval × facteur, borné au plafond
partiel   → interval × facteurPartiel, borné au plafond
échec     → intervalleEchec, borné au plafond et au plancher
dueAt     = dernier événement porteur de signal + interval
```

Une question **sans aucun événement porteur de signal est due immédiatement** :
elle n'a pas d'échéance, elle entre par le quota de neufs (§7.2).
`intervalleInitial` est l'intervalle qu'elle reçoit **après son premier succès**,
pas avant.

### 5.3 Trois conséquences qui n'ont demandé aucune règle

**Un examen qui approche resserre les révisions**, parce que H est le temps
*restant*. À sept jours du partiel le plafond est de 2,1 jours ; à deux jours il
est de 14 heures. Aucune logique de bachotage n'est écrite nulle part.

**Un examen passé retombe sur l'horizon par défaut**, donc sur le régime
« retenir durablement ». La note interdit la sortie du système après une
réussite ; ici elle est structurellement impossible, et aucune intervention de
l'utilisateur n'est requise après son partiel.

**L'urgence n'a pas besoin d'un terme de priorité à elle.** La priorité est le
retard relatif, `(now - dueAt) / interval`. Comme un module à examen proche a des
intervalles courts, son retard relatif grimpe mécaniquement plus vite. Un terme
d'urgence supplémentaire aurait compté deux fois la même chose.

### 5.4 Le garde-fou de la double révision

**Un succès ne fait croître l'intervalle que si l'item était dû**, à la marge
d'anticipation près (`now ≥ dueAt - marge × interval`). Sinon l'intervalle est
conservé.

Sans cette règle, rejouer deux fois le même quiz dans l'heure doublerait deux
fois l'intervalle pour cinq minutes d'espacement réel : le compteur de
répétitions remplacerait l'espacement, qui est le seul mécanisme que la
littérature valide. La marge sert ainsi deux fois, ici et au lissage (§7), ce qui
évite un second seuil à régler.

## 6. Ce qui compte comme signal

| Situation | Effet sur l'intervalle |
|---|---|
| `correct`, `understood` | succès plein |
| `partial` | succès amorti (`facteurPartiel`) |
| `wrong`, `review` | échec |
| **tout événement de rôle `pre`** | **aucun** |
| `seen` (carte `read`) | aucun |
| `skipped` | aucun |

**Pourquoi un `pre` raté ne raccourcit rien.** Chez Richland, Kornell & Kao
(2009), c'est le groupe qui a *essayé de répondre et échoué* qui a le mieux
appris. L'échec y est le mécanisme, pas le symptôme d'un oubli. Le compter comme
un raté ferait revenir en boucle les questions que la méthode fait délibérément
rater.

**Pourquoi l'auto-évaluation compte** (décision d'Ahmed, 2026-09-02). Le rappel
libre est la forme de récupération la plus forte de la littérature (g ≈ 0,7-0,8
contre ≈ 0,3 pour la reconnaissance, Rowland 2014). L'écarter priverait
l'ordonnanceur de son meilleur signal. Son poids reste un paramètre nommé (§8),
donc réglable et rejouable.

**Les événements sans effet sont tout de même journalisés.** Le journal est un
journal : il enregistre ce qui s'est passé, la politique décide ce qu'on en fait.
C'est ce qui permettra, si l'usage le suggère, de compter un `pre` *réussi* comme
un signal de connaissance préalable, en recalculant tout l'historique déjà
accumulé.

## 7. Le plan du jour

Une seule fonction publique. Entrées : `now`, `dayStart`, le catalogue, le
journal, les horizons, les paramètres. Sortie : un plan.

```ts
interface Plan {
  today: string[];      // à poser aujourd'hui, dans l'ordre
  deferred: string[];   // dû mais reporté, par priorité décroissante
  forecast: number[];   // charge projetée, un entier par jour de la fenêtre
  stats: { due: number; new: number; ahead: number; spentToday: number };
}
```

### 7.1 Le budget déjà consommé se lit dans le journal

Le noyau ne persiste rien, donc il ne peut pas *retenir* combien de questions ont
été faites aujourd'hui. Il les **compte** : les événements dont `at ≥ dayStart`.
Rouvrir le dashboard après quarante questions ne redonne pas quarante questions.

`dayStart` est fourni par l'hôte, qui seul connaît le fuseau et l'heure de
bascule de journée. Le noyau ne manipule jamais de calendrier.

### 7.2 Quatre passes

1. **Sélectionner** le retard et le dû : `dueAt ≤ now`.
2. **Compléter** avec des questions jamais vues, **sous quota** (`partNeuf` du
   budget). Sans ce quota, une génération de quatre-vingts questions noierait
   toutes les révisions le jour même : c'est le mur des mille cartes vu depuis
   l'ordonnanceur.
3. **Lisser.** Projeter les échéances sur la fenêtre (14 jours), puis avancer
   vers aujourd'hui ce qui tombe sur les jours les plus chargés, jamais au-delà
   de `marge × interval`, et seulement tant que le budget du jour n'est pas
   atteint. Le surplus du jour est reporté par priorité décroissante.
4. **Ordonner** (§7.3).

**Le plan ne porte que sur aujourd'hui.** La projection sert à décider quoi
avancer, elle n'est jamais persistée : demain, le plan est recalculé depuis le
journal. Aucun planning à invalider, aucune désynchronisation possible.

### 7.3 L'ordre

**Les modules ne s'entremêlent pas.** Deux modules ne se confondent pas : les
mélanger ne produirait aucune discrimination et ne coûterait que du changement de
contexte. Les modules se succèdent, ordonnés par leur priorité maximale.

**À l'intérieur d'un module, les familles alternent en tourniquet** : par
`topic` s'il est déclaré, sinon par `source`, ce qui entrelace les tranches d'un
même chapitre. C'est le seul endroit où l'entrelacement intervient, conformément
à la note : il décide de l'ordre, jamais de ce qui est dû.

**Les questions neuves sont réparties dans la série**, une tous les
`1 / partNeuf` items, plutôt que reléguées à la fin : une session écourtée doit
progresser sur les deux fronts, sinon la couverture stagne indéfiniment.

**L'ordre est total et déterministe.** Les égalités de priorité sont départagées
par la clé `q`, en ordre lexicographique. Deux appels sur les mêmes entrées
donnent le même plan, sans quoi rien de tout cela ne serait testable.

## 8. Les paramètres

Un seul objet `SchedulerParams`. Le tableau donne pour chaque valeur **d'où elle
vient** et **ce qui la ferait changer**. Trois statuts :

- **ancré** : provient d'un résultat mesuré de la littérature ;
- **dérivé** : conséquence d'une contrainte de la méthode ;
- **arbitraire** : choisi pour partir de quelque part, et à régler à l'usage.

| Paramètre | Départ | Statut | Ce qui le ferait changer |
|---|---|---|---|
| `ratioAncres` | (7 j → 0,30), (365 j → 0,075) | **ancré** (Cepeda 2008) | une étude plus fine ; pas l'usage |
| `horizonDefaut` | 365 j | **dérivé** : l'ancrage bas est le régime « retenir durablement » | si les cours d'Ahmed ne se révisent jamais au-delà du semestre |
| `intervalleInitial` | 1 j | **arbitraire** (convention héritée de J1) | un taux d'échec élevé au deuxième passage |
| `facteurSucces` | 2,0 | **arbitraire** ; la forme de la progression n'a pas de statut privilégié (Karpicke), c'est le plafond qui fait le travail | un taux de rappel mesuré trop bas (allonger trop vite) ou une charge trop lourde (allonger trop lentement) |
| `facteurPartiel` | 1,2 | **arbitraire** | l'écart de rappel observé entre `partial` et `understood` |
| `intervalleEchec` | 1 j | **arbitraire** | des questions ratées qui se re-ratent au retour |
| `intervalleMin` | 4 h | **dérivé** : « corriger l'erreur près de la tentative, espacer la récupération suivante » interdit le re-test dans la séance | rien avant longtemps |
| `budgetJour` | 40 questions | **arbitraire** ; ≈ 20 min à 30 s la question, la durée de bloc du principe 7 | la charge réellement tenue une semaine durant |
| `partNeuf` | 0,25 | **arbitraire** | une couverture qui stagne (monter) ou un retard qui s'accumule (baisser) |
| `margeAnticipation` | 0,20 | **arbitraire** | des pics de charge qui subsistent malgré le lissage |
| `fenetreLissage` | 14 j | **arbitraire** | rien, sauf coût de calcul |

**Le journal étant rejouable, changer une valeur recalcule tout l'historique
passé.** Le réglage se fera sur des données déjà accumulées, pas sur les six
semaines suivantes. C'est la raison d'être du choix « journal seul, état dérivé »
plutôt qu'un état résumé mis à jour au fil de l'eau.

## 9. Le câblage dans le greffon

### 9.1 Enregistrer

**Au verrouillage de chaque question, pas à l'écran de résultats.** Une session
abandonnée à mi-parcours contient de vraies réponses, et les sessions abandonnées
sont fréquentes.

Le moteur ne connaît qu'une interface, comme il ne connaît déjà `StatsStoreLike`
que par sa forme (`src/engine/state.ts:6`) :

```ts
type ReviewSink = { record(events: ReviewEvent[]): void };
```

`stats-store.ts` **n'est pas modifié** : la progression par quiz garde son rôle
d'affichage. Deux systèmes distincts, à ne pas fusionner ; le journal ne remplace
pas les stats, il répond à une autre question.

### 9.2 Persister

`.obsidian/plugins/quiz-blocks/review-log.jsonl`, écrit par
`DataAdapter.append` (`obsidian.d.ts:2069`).

**Pas dans `data.json`** : Obsidian réécrit le fichier de réglages en entier à
chaque `saveSettings()`. Un journal d'un mégaoctet réécrit toutes les 500 ms
pendant une session de révision serait mauvais, et `aiUsageLog` y est déjà borné
à 300 entrées pour cette raison. Volume attendu : ≈ 70 octets par ligne, soit
environ 1 Mo par année d'usage quotidien.

**La compaction n'est pas implémentée.** Elle ne deviendra nécessaire qu'après
plusieurs années, et elle sacrifiera la rejouabilité complète : l'arbitrage se
fera à ce moment-là, avec les données en main.

### 9.3 La clé de question

`chemin::id`. L'`id` est écrit par l'éditeur pour chaque question
(`src/editor/export.ts:107`) et figé dans `_sourceId` dès sa première
attribution. Une note écrite à la main sans `id` reçoit la clé que
`questionId()` lui donnerait : **une seule règle d'attribution**, partagée entre
lecture et écriture, plutôt que deux qui divergeraient.

Le couplage au chemin est assumé et confiné à l'adaptateur : le noyau ne voit que
des chaînes. Un renommage émet une ligne `rename` (§4.4), sur l'événement du
vault et non sur l'action de menu, pour couvrir les deux chemins de renommage
comme `stats-store.ts` le fait déjà.

**Limite connue** : si un bloc duplique une question (l'énoncé posé en `pre` puis
repris en `test`), l'ordonnanceur suit deux items. C'est une question de contenu,
pas de noyau, et la déduplication n'est pas de son ressort.

### 9.4 La date d'examen

Un champ dans le modal « Modifier dossier », stocké dans `ModuleOverride`
(`src/dashboard/quiz-modules.ts:33`), aux côtés du nom, de l'UE, de la couleur et
de l'icône. Aucune nouvelle surface.

### 9.5 La surface de consultation

Une carte sur l'accueil du dashboard : ce qui est dû, par module et par quiz, et
un lien qui ouvre le quiz concerné.

**Pas de session inter-quiz composée.** C'est la « session une seule chose »,
déjà hors périmètre, et la première chose que construira l'application PC. Les
données s'accumulent de toute façon dès qu'on joue n'importe quel quiz, puisque
l'enregistrement vit dans le moteur : le réglage des paramètres peut commencer
sans elle.

Aucune chaîne visible en dur : `t("dashboard.review.*")`, dictionnaires EN et FR.
Le noyau, lui, n'a **aucune** chaîne visible : il retourne des données.

## 10. Décisions prises

1. **Approche « l'horizon plafonne »**, plutôt qu'une réplique de SM-2 (ignore
   l'horizon, ajoute un paramètre par carte qu'on ne saura jamais évaluer) ou un
   modèle de rétention façon FSRS (demande des paramètres qu'il faudrait
   inventer, habillés de mathématiques). La structure retenue (journal rejouable,
   planification isolée derrière une interface) permet de passer à un modèle de
   rétention plus tard **en recalculant tout l'historique**, sans qu'aucun autre
   module ne bouge.
2. **Journal seul, état dérivé à la volée** ; pas d'état résumé persisté, pas de
   cache.
3. **Horizon par module, saisi**, avec repli sur un horizon long. Pas de
   déduction depuis le vault : une date devinée changerait tous les intervalles
   d'un module en silence.
4. **Budget quotidien avec anticipation bornée**, plutôt qu'un report seul (qui
   crée la dette qui fait abandonner Anki) ou un bruit aléatoire seul (impuissant
   contre un pic qui vient du calendrier).
5. **L'auto-évaluation pilote les intervalles**, avec un poids paramétré.
6. **Un événement de rôle `pre` n'a jamais d'effet.**
7. **La pureté du noyau est vérifiée par un script**, pas seulement documentée.

## 11. Ce qui reste ouvert

Ce sont des réglages à mesurer à l'usage, pas des recherches à faire. La note de
méthode l'énonce : la fonction exacte de l'ordonnanceur et le taux de rappel visé
resteront empiriques quoi qu'on cherche.

- **Les huit paramètres marqués « arbitraire » au §8.** Aucun n'est défendable
  autrement que comme point de départ.
- **Le taux de rappel visé.** On ne l'a pas fixé, faute de pouvoir le mesurer
  avant d'avoir des données. Quand le journal en contiendra assez, il deviendra
  la métrique de réglage de `facteurSucces`.
- **Le `topic`.** Le noyau le consomme s'il existe ; rien ne le produit encore.
  L'ajouter au format et à la génération IA est un lot distinct, et l'alternance
  par `source` est une dégradation honnête en attendant.
- **Le régime d'expertise** (notion nouvelle / schéma en place / maîtrisée), qui
  choisit la boucle. Hors périmètre, et le seuil de bascule n'existe pas dans la
  littérature.
- **La compaction du journal** (§9.2).

## 12. Vérification

`scripts/check-scheduler.mjs`, chargeant le **code réel** via
`scripts/lib/load-src.mjs`. `process.exitCode`, jamais `process.exit()` : la pile
doit se dérouler pour que `withSrcModule` retire son dossier temporaire.

Ce script existe pour la même raison que `check:md` et `check:export` : c'est de
la logique qu'une relecture ne suffit pas à juger.

**Pureté**
- aucun symbole interdit dans `src/scheduler/**` (§3) ;
- deux appels sur les mêmes entrées donnent le même plan.

**Horizon**
- les deux ancrages de Cepeda sont respectés au ratio près ;
- `plafond(H)` est strictement croissant, y compris au-delà de 365 jours ;
- un examen **passé** retombe sur l'horizon par défaut.

**Intervalle**
- succès → croissance, jamais au-dessus du plafond ;
- échec → intervalle court, jamais sous le plancher ;
- une question réussie dix fois a **toujours** une échéance finie (pas de sortie
  du système) ;
- un succès **anticipé hors marge** ne fait pas croître l'intervalle (§5.4).

**Signaux**
- un `pre` raté ne raccourcit rien ; un `seen` ne fait rien ;
- `partial` amortit, `review` échoue.

**Plan**
- le budget est respecté, en tenant compte de ce qui a déjà été fait depuis
  `dayStart` ;
- le surplus est reporté, jamais perdu ;
- l'anticipation ne tire jamais au-delà de la marge ;
- le quota de neufs est respecté, et les neufs sont répartis, pas relégués ;
- deux modules ne s'entremêlent pas ; deux `topic` d'un même module alternent ;
- une question absente du catalogue n'apparaît pas, même présente au journal.

**Journal**
- une ligne corrompue est ignorée et comptée, le reste survit ;
- une ligne `rename` déplace la clé, y compris par préfixe de dossier ;
- rejouer le même journal avec un paramètre modifié change le plan (preuve que
  rien n'est figé dans un état persistant).

**Puis, hors script** : `npm run check`, et le test manuel dans Obsidian.
