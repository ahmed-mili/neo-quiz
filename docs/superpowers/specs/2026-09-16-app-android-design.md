# L'application Android de Neo Quiz — conception

Écrit le 2026-09-16, au lendemain de la clôture de l'installeur Windows. C'est
le **chantier 3** de `2026-09-02-roadmap-produit.md`, et le dernier verrou qui
le retenait — « seulement une fois que l'application assure réellement la
génération et l'édition » — est levé depuis le 13 septembre.

**Révisé le 2026-09-17**, après relecture adverse. Le document tenait trois
conclusions successives dont deux se contredisaient encore par endroits ; il
est réécrit d'un bloc. Ce qui est tombé, et pourquoi, vit en **§9** : rien de
la recherche relevée le 16 n'a été perdu, seules les conclusions ont bougé.

Ce document fige les décisions de pile, de périmètre, de fichiers et de
distribution. Il ne contient pas de plan d'implémentation : chacun des
sous-projets aura le sien.

## 1. Le périmètre, décidé

**L'application Android fait tout** : réviser, notifier, créer, éditer, et
générer des quiz par l'intermédiaire de l'ordinateur lié.

Ahmed l'a demandé deux fois, la seconde après avoir lu l'objection. Ce n'est
pas le périmètre que `2026-09-02-roadmap-produit.md` envisageait (« réviser,
notifier, et demander au PC quand il faut générer ») ; c'est une décision prise
en connaissance de son coût.

## 2. La pile, décidée

**Coquille Kotlin native + Jetpack Compose, et une WebView pour les écrans qui
manipulent des maths : le lecteur de quiz ET l'éditeur.**

### Le classement des piles, et ce qui le fait basculer

| rang | pile | exemples vérifiés |
|---|---|---|
| 1 | **Kotlin natif + Jetpack Compose** | Signal, Telegram (langages du dépôt, API GitHub) |
| 2 | Kotlin Multiplatform + Compose Multiplatform | — |
| 3 | Flutter | — |
| 4 | React Native | Bluesky (TypeScript dominant + `react-native`) |
| 5 | WebView / Capacitor | Logseq (`capacitor.config.ts` au dépôt), Obsidian (source tierce) |

Google écrit que Jetpack Compose est « the recommended modern toolkit for
building native UI » et que la plateforme est « Compose-first ». Le rang 1 est
bien le meilleur — **pour une interface qui devrait être native**. Le classement
complet, avec ses citations et ses sources, vit dans le vault :
`Projets/Piles Android.md`.

La règle qui le fait basculer vient de `Projets/Architecture multiplateforme.md` :

> Le contenu que l'application affiche ou édite est-il lui-même du web ?
> Oui → tout en web. Non → tout en Kotlin.

Neo Quiz répond **oui pour deux écrans et non pour tous les autres**. Les listes,
la navigation, les réglages, les notifications et le Storage Access Framework
n'affichent pas de web : ils restent natifs, et c'est là que le natif se sent.
Le lecteur et l'éditeur affichent du markdown, du LaTeX et du HTML mis en page :
la WebView n'y est pas une coquille autour de l'application, c'est le moteur de
rendu de la chose elle-même.

### Ce qui rend les deux écrans mathématiques non négociables

Relevé le 2026-09-16, et c'est ce qui décide :

- **Afficher du LaTeX.** La seule bibliothèque sérieuse, `huarangmeng/latex`
  (KMP), a 127 étoiles, 5 contributeurs, et date du 2026-01-02.
  `mouse0329/nezumiLaTeX` est morte (0 étoile, un commit). En face, MathJax a
  quinze ans. Pour des quiz de maths révisés avant des partiels, un rendu faux
  ne se découvre qu'au pire moment.
- **Éditer une formule.** `vkochenkov/EquationDisplayer` (17 étoiles, dernier
  commit 2024-06-23) et `Abdo-21/CExpr` (10 étoiles, 2024-10-14) sont
  abandonnées ; `mohamedrejeb/compose-rich-editor` (1 853 étoiles, actif) fait du
  texte riche et pas de maths. **MathLive n'a aucun équivalent Kotlin**, et six
  fichiers de `src/` en dépendent. Y renoncer contredirait le périmètre du §1.

### Ce que ça coûte, dit honnêtement

Le démarrage de la WebView, et le fait que, sur ces deux écrans, gestes et
animations ne soient pas ceux du système. C'est réel, et c'est réductible :
WebView **préchauffée** au démarrage de l'application (elle ne paie son coût
qu'une fois), balayage qui **reste natif** (le lecteur est déjà une piste
`translateX`, seule sa position traverse le pont), clavier qui ne se pose que
pour les réponses texte (`isMathQuestion` ne bascule sur MathLive que si la
question est marquée ou contient du `$…$`).

### Ce qui protège d'une future migration

Pas la coquille — **le contrat `src/host/types.ts`**. Il a déjà fait ses preuves
sur exactement ce risque : pendant toute la migration Tauri → Electron, `src/`
n'a pas bougé d'une ligne.

## 3. Où s'exécute le TypeScript — la décision que la pile impose

C'est le point que les deux premières rédactions avaient laissé sans réponse, et
il vaut d'être posé à l'envers de l'intuition :

> **AnkiDroid peut se permettre une coquille native parce que son noyau métier
> est en Rust, compilé dans l'APK. Le nôtre est en TypeScript, et le TypeScript
> n'a pas d'équivalent embarquable en Kotlin.**

Conséquence : un écran Compose « Révision du jour » **ne peut pas calculer ce
qu'il affiche**. Ce qui décide des questions dues, c'est `src/scheduler/` (629
lignes), alimenté par `src/review/` (977), `dashboard/scanner.ts` (336),
`src/quiz-utils.ts` (343) et `src/quiz-ids.ts` (97) — **2 382 lignes que le §8
compte comme partagées, donc non réécrites**. Trois issues existaient :

| | issue | ce qu'elle coûte |
|---|---|---|
| a | une WebView **invisible** porte tout le métier ; Compose peint | un second contrat, et le boot JS avant le premier chiffre affiché |
| b | Kotlin réimplémente ordonnanceur et scanner | le SECOND exemplaire écrivant dans le même journal, que toute cette conception existe pour éviter |
| c | les listes passent aussi en WebView | la coquille Compose ne sert plus à rien ; c'est le tout-web |

**Décision : (a).** Et l'écrire noir sur blanc, parce que c'est ce que la
relecture de demain oubliera :

> **Les écrans Compose sont des PEINTRES. Ils ne possèdent aucune règle
> métier.** Aucune date d'échéance, aucun intervalle, aucune clé d'identité,
> aucun format de journal n'est calculé en Kotlin. Un écran natif reçoit des
> données déjà décidées et les affiche.

(b) est explicitement interdit : la règle d'identité (`src/quiz-ids.ts`) diverge
au premier écart, et une clé qui diverge d'un hôte à l'autre rend une question
éternellement neuve — elle revient tous les jours sans jamais pouvoir sortir de
« À réviser ». Le fait qu'Android exécute LE MÊME code est la garantie, pas un
confort.

### Les notifications, cas qui tranche pour de bon

`AlarmManager` réveille l'application à 8 h, fenêtre fermée : il faut un nombre
de questions dues. Démarrer une WebView dans un `Service` est exactement le
genre de chose que HyperOS tue — et un défaut qui ne se voit que sur le
téléphone d'Ahmed, un matin, sans trace.

**Décision : le calendrier des notifications est PRÉCALCULÉ.** À chaque passage
en arrière-plan, la WebView écrit les **N prochains jours** (date → nombre dû,
titre du quiz le plus urgent) dans les préférences Kotlin. `AlarmManager` ne
fait que **lire** ce calendrier : aucune exécution de JavaScript en arrière-plan,
jamais. Le calendrier se périme si l'application n'est pas ouverte pendant N
jours ; c'est voulu, et N (7 jours) est un réglage du sous-projet B.

### Les deux ponts, et pourquoi ce n'est pas l'architecture de Windows

Sur Windows, l'interface ENTIÈRE est le code partagé : il y a **un** pont, et il
descend (le rendu demande un fichier au principal). Sur Android il y en a
**deux**, et le second n'a aucun précédent dans le dépôt :

1. **Pont hôte** (`src/host/types.ts` → Kotlin) : fichiers, chemins, liens,
   maths, plateforme. Même contrat que les deux autres hôtes, modèle
   `apps/windows/electron/pont.ts`.
2. **Pont d'application** (Compose ↔ WebView) : Compose demande « la révision du
   jour », « le catalogue », « ouvre le quiz X à la question 3 » ; la WebView
   répond, et signale en retour ce qui a changé (réponse enregistrée, quiz
   terminé, calendrier de notifications à réécrire).

Le pont 2 est la vraie nouveauté du chantier. Il est typé des deux côtés et
vérifié comme le reste : `check:android-pont` naîtra avec lui, sur le modèle de
`check:windows-host` (140 assertions). Tout cas neuf s'éprouve par
DISCRIMINANCE : casser la règle, voir rougir, restaurer.

## 4. Les fichiers : Storage Access Framework

**Décidé : SAF.** L'utilisateur désigne son dossier une fois, et l'application
en garde l'accès. Les quiz restent des fichiers `.md` à lui, lisibles par
Obsidian mobile — c'est la promesse du projet, « des fichiers dans un dossier »,
tenue sur téléphone. Le repli « dossier propre à l'application » est écarté : les
quiz y deviendraient invisibles aux autres applications et disparaîtraient à la
désinstallation, ce qui imposerait d'inventer une synchronisation. Joplin, dont
le cas est le nôtre, embarque `react-native-saf-x` : le SAF est la réponse réelle
de cette famille d'applications, pas un pari.

Trois conséquences que la première rédaction n'avait pas tirées. Aucune n'est un
mur ; toutes changent le sous-projet A.

### 4.1 Le contrat raisonne en CHEMINS, le SAF rend des URI

`HostFile.path` est une chaîne, et le journal de révision **est indexé par
chemin**. Un `content://…/tree/…/document/…` encodé n'est ni lisible ni stable
entre deux octrois. L'hôte Android tient donc une **traduction** : le chemin
relatif à la racine choisie est la clé (comme sur les deux autres hôtes), et
l'URI n'existe qu'à l'intérieur de l'hôte, jamais dans `src/`. C'est le premier
objet que la sonde doit produire.

### 4.2 Le balayage se mesure AVANT de s'engager

`scanner.ts` appelle `host.fs.listMarkdown()` puis lit chaque note
(`readCached`). Sur le vault Personal d'Ahmed : **556 notes, 1 847 fichiers, 10
notes portant un bloc `quiz-blocks`**. Sur SAF, chaque lecture est un aller-retour
IPC vers le fournisseur de documents. Le piège classique est
`DocumentFile.listFiles()`, qui fait une requête par entrée ; la forme correcte
est `DocumentsContract.buildChildDocumentsUriUsingTree` avec **un curseur par
dossier**, colonnes en vrac.

Seuil posé d'avance, pour que la mesure décide au lieu d'être commentée : **si
un balayage complet du vault dépasse 5 secondes**, l'index persistant (§4.4)
n'est plus une optimisation mais le cœur du sous-projet A.

### 4.3 Il n'y a AUCUN événement de fichier, et ce n'est pas grave

Le SAF n'a pas d'équivalent de chokidar. `HostWatcher` existe pourtant au
contrat, et l'hôte Android le remplit **inerte** : `onChange` et `onRenameDir`
ne sont jamais appelés. C'est le comportement que le contrat prévoit déjà — « un
hôte qui ne sait pas distinguer un dossier renommé n'appelle jamais le rappel ;
il ne DEVINE pas ».

Ce qui sauve l'historique, c'est `src/review/rename-match.ts`, écrit pour
exactement ce cas : une note qui disparaît et une autre qui apparaît avec la
MÊME suite d'identifiants de questions sont la même note, sur preuve et non sur
ressemblance. Sa garde « les deux moitiés doivent être proches dans le temps »
est même plus facile à tenir ici qu'ailleurs : disparition et apparition sont
constatées dans le **même** rescan.

Un dossier renommé produit alors N appariements note à note au lieu d'un seul
déplacement par préfixe : l'historique est correct, le journal est simplement
plus bavard. C'est le prix accepté.

### 4.4 La fraîcheur vient d'un index persistant, pas d'un surveillant

L'hôte Android garde un index (chemin, `mtime`, taille, identifiants) et
**rebalaye au retour au premier plan**, en ne relisant que ce dont `mtime` ou la
taille a bougé. C'est la seule stratégie compatible avec l'absence
d'événements, et elle est aussi celle qui économise la batterie.

## 5. La distribution : décidée, parce qu'elle contraint le premier commit

La première rédaction la laissait « ouverte » (APK par le site ou Play Store).
Elle ne peut plus l'être : **deux valeurs immuables à vie se figent avant la
première ligne de Kotlin.**

- **Le nom de paquet** : `com.ahmed.neoquiz`, aligné sur l'`appId` de
  l'application Windows. Il est aussi immuable que lui — Google l'enregistre
  avec la clé de signature, et une application qui en change est une autre
  application, installée à côté.
- **La clé de signature** : un keystore généré **maintenant**, sauvegardé hors
  du dépôt (jamais commité). Perdue, elle interdit toute mise à jour de toute
  installation existante. C'est la même règle qu'« une version publiée ne se
  supprime plus », appliquée en amont.

Et le fait qui a changé sous le projet : Google exige désormais une
**vérification d'identité du développeur** pour installer une application sur un
appareil Android certifié, **y compris hors Play Store**. Application le
30 septembre 2026 (Brésil, Indonésie, Singapour, Thaïlande ; sept magasins dont
Xiaomi GetApps), extension mondiale annoncée **courant 2027**. Le sideload
survit, mais pour un développeur vérifié : nom légal, adresse, téléphone, plus
l'enregistrement du nom de paquet et de la clé.

**Décision : APK distribué par le site pour v1, pas de Play Store.** Le public
est la promo de B2 d'Ahmed, pas le grand public ; un compte personnel Play
impose en plus un test fermé de douze testeurs pendant quatorze jours avant
toute production. La vérification développeur s'ouvre quand la date mondiale se
précise, pas avant — mais le nom de paquet et le keystore, eux, se figent au
premier jour.

## 6. Le découpage : une sonde, puis cinq sous-projets

« Tout » n'est pas un périmètre exécutable. Chaque sous-projet aura sa spec et
son plan, livrés l'un après l'autre.

| | sous-projet | pourquoi à cette place |
|---|---|---|
| **A0** | **la sonde** : SAF → chemins, balayage chronométré, une ligne ajoutée au journal | rien ne s'engage avant que ces trois faits soient mesurés ; quelques heures, jetable |
| A | coquille, hôte Android, pont Compose ↔ WebView, lire et **réviser** un quiz | rien ne se teste avant que l'application lise un fichier |
| B | **notifications planifiées** (calendrier précalculé, §3) | ce qu'un téléphone apporte et qu'un PC n'a pas |
| C | **créer et éditer** au pouce | la page quiz existe, son ergonomie tactile non |
| D | **générer** par le PC lié | transport entre deux machines, protocole déjà conçu (`2026-09-02-mobile-generation-design.md`) |
| E | **distribution** : APK signé, mises à jour | le nom de paquet et le keystore sont figés dès A0 (§5) |

L'ordre suit la règle de la feuille de route : construire d'abord ce dont on est
sûr qu'il ne sera pas jeté.

### Ce que la sonde A0 doit rendre, et rien d'autre

1. Un dossier de vault désigné par SAF, et sa **traduction URI ↔ chemin relatif**
   qui survit à un redémarrage (permission persistée).
2. Le **temps** d'un balayage complet du vault Personal réel (556 notes), par
   curseur et non par `DocumentFile.listFiles()`, chiffre écrit dans la spec du
   sous-projet A.
3. Une ligne ajoutée à `<racine>/.neo-quiz/review-log.jsonl` depuis le téléphone,
   **relue ensuite par l'application Windows** sans que rien ne s'en aperçoive.

Pas de Compose, pas de pont typé, pas d'hôte complet : un projet Gradle jetable.
Ce qu'elle mesure décide de la forme du sous-projet A.

**La chaîne d'outils est déjà en place**, relevé le 2026-09-17 sur la machine
d'Ahmed : Temurin JDK 21.0.12, Android Studio, SDK avec `android-35`, `android-36`
et `android-37.0`, build-tools 34/35/36, `adb` 1.0.41 fonctionnel
(`%LOCALAPPDATA%\Android\Sdk`, `ANDROID_HOME` non défini). Il ne manque que le
téléphone branché ou appairé sans fil. Rien n'est à installer pour commencer la
sonde.

## 7. L'architecture

```
apps/android/
  app/                    ← projet Gradle, Kotlin + Compose
    …/MainActivity.kt         la coquille, la navigation
    …/saf/                    SAF : permission persistée, URI ↔ chemin, index
    …/pont/                   les DEUX ponts (hôte, et application ↔ WebView)
    …/notifications/          AlarmManager, lecture du calendrier précalculé
  web/                    ← ce qui est servi à la WebView
    host/                     implémente src/host/types.ts par-dessus le pont
    boot/                     le métier hors écran (scheduler, review, scanner)
    ui/                       lecteur et éditeur, depuis src/engine et src/editor
```

`src/` **ne bouge pas**. C'est la contrainte qu'a tenue la migration Electron, et
`npm run check:host` la garde mécaniquement : aucun fichier de `src/` n'importe
depuis `apps/`, ni Obsidian, ni Node.

`web/` consomme `src/` **par chemin relatif**, comme `apps/windows` : jamais une
copie, qui divergerait sans un mot. Les fichiers construits sont empaquetés dans
les `assets/` de l'APK et servis par `WebViewAssetLoader` sur une origine
`https://` locale — pas `file://`, qui casse les origines et le stockage.

## 8. Le budget, mesuré à nouveau le 2026-09-17

La première rédaction annonçait « Android écrit l'équivalent [4 799 lignes], pas
davantage ». **C'est faux aujourd'hui, deux fois.**

| | mesure du 2026-09-17 |
|---|---|
| `src/` partagé | **31 303** lignes TS, dont `dashboard` 13 136, `engine` 8 314, `editor` 2 031, `i18n` 1 952, `types` 1 263, `host` 986, `review` 977, `scheduler` 629 |
| `apps/windows` | **10 240** lignes TS (5 122 principal Electron, 5 118 rendu dont 2 388 pour son hôte) + 930 CSS |

Première correction : le propre de l'application Windows a plus que doublé
depuis la mesure citée (installeur, mise à jour automatique, menu, fond).
Seconde, et c'est la vraie : **une coquille Compose ne réutilise rien des 13 136
lignes de `src/dashboard`**, là où le rendu Electron les réutilise toutes. Les
écrans natifs d'Android s'écrivent à partir de zéro, en Kotlin, dans un langage
et un système de mise en page que le dépôt n'a jamais employés.

L'ordre de grandeur honnête est donc **deux à trois fois** la mesure citée, plus
une chaîne d'outils absente du dépôt : JDK, SDK Android, Gradle, un travail de CI
neuf, un keystore. C'est le prix du rang 1 sur tout ce qui se sent, et il est
assumé — mais il est écrit ici pour ne pas être redécouvert à mi-chantier.

## 9. Ce que ce document a corrigé

Trois conclusions se sont succédé en deux jours. Les garder visibles coûte vingt
lignes et évite de refaire le trajet.

**Le 2026-09-16 au soir, première rédaction : « tout en web via Capacitor ».**
Fondée sur la règle « le contenu est-il du web ? », appliquée à l'application
entière. Tombée parce qu'elle posait le choix comme binaire : la WebView peut
être cantonnée, et les trois paris du natif intégral (réécrire 29 300 lignes,
confier les maths à une bibliothèque de huit mois, renoncer à éditer une
formule) ne portent que sur les écrans mathématiques.

**Le 2026-09-16, plus tard : « coquille Kotlin + WebView pour deux écrans »,
justifiée par l'architecture d'AnkiDroid.** La pile tient, l'analogie non : le
noyau d'AnkiDroid est en Rust, compilé dans l'APK. C'est ce qui lui permet une
coquille native. Le nôtre est en TypeScript. Cette rédaction laissait donc le
métier sans domicile sur les écrans natifs, et son argument « une seule
implémentation de la logique » n'était vrai qu'à condition d'une décision qu'elle
ne prenait pas.

**Le 2026-09-17 : la pile est confirmée, et la décision manquante est prise** —
§3, les écrans Compose sont des peintres, une WebView invisible porte le métier,
les notifications lisent un calendrier précalculé. S'y ajoutent trois points que
personne n'avait ouverts : ce que la sonde doit mesurer (§4.2), l'absence
d'événements de fichiers et ce qui la rattrape (§4.3), et la distribution qui
n'est plus libre (§5).

## 10. Ce qui reste ouvert, et ce que cette conception ne garantit pas

- **L'ergonomie tactile du moteur.** La piste `translateX` et le `ResizeObserver`
  existent ; le geste de balayage sur téléphone n'a jamais été pensé. Se
  tranchera au sous-projet A, à l'écran.
- **Les chaînes des écrans Compose.** Les dictionnaires (`src/i18n/`) sont du
  TypeScript, et leur garantie est une **erreur de compilation** quand une
  traduction manque. Un `strings.xml` recopié tuerait cette garantie. Deux
  pistes : générer `strings.xml` depuis les dictionnaires à la construction, ou
  faire descendre les libellés par le pont. À trancher au sous-projet A, pas
  avant : le nombre d'écrans natifs décidera.
- **Le transport du sous-projet D.** Le protocole est conçu, son transport
  concret ne l'est pas.
- **Le ressenti.** Une WebView préchauffée sur deux écrans reste une WebView. Le
  pari est que, pour un contenu qui **est** du web et sur les deux seuls écrans
  où le natif n'a rien à offrir, ce qu'on perd en ressenti coûte moins cher que
  d'entretenir deux implémentations de la même logique de révision, couplées par
  un format de fichier qu'elles devraient produire à l'octet près, pour toujours.

Si ce pari se révélait faux à l'usage, le repli est **dans le bon sens** : ces
deux écrans peuvent passer en Compose plus tard, le jour où une bibliothèque de
maths mûrit. L'inverse — repartir du tout-Kotlin vers le partagé — coûterait la
réécriture entière.
