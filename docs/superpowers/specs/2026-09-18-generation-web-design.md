# Générer par un site (claude.ai) — design

**Date** : 2026-09-18 · **Statut** : design de l'interface validé à l'écran,
parcours validé en discussion, à planifier · **Périmètre** : le code partagé
de la page « Générer » (`src/dashboard/ai.ts`, `ai-client.ts`,
`ai-providers.ts`, `ui-select.ts`), le contrat d'hôte (`src/host/types.ts`) et
ses deux implémentations, le canal de copie du principal Electron
(`apps/windows/electron/canaux.ts`). Le greffon Obsidian n'est touché que par
le contrat : il ne rend plus qu'un quiz.

## 0. D'où ça vient

Ahmed veut générer aussi par claude.ai, chatgpt.com et perplexity.ai. Ces
sites n'ont ni CLI ni API ouverte par abonnement : ce qui change n'est pas la
liste des modèles, c'est la nature de la génération. Quelqu'un doit passer
par un navigateur.

Deux critères ont été posés le 18 septembre : **les conditions d'utilisation
des sites sont respectées** (donc aucun pilotage de leurs pages), et **le
parcours est le plus simple possible**. Trois pistes ont été dessinées ; la
retenue est « une marque, deux canaux » : le menu des fournisseurs garde une
ligne par marque (Claude, ChatGPT, Perplexity, Ollama) et le canal (le CLI
sur la machine, ou le site dans le navigateur) se choisit au second niveau.
Cette interface est déjà dans le code, en apparence seulement (voir §1). Ce
document décrit ce qui la fait FONCTIONNER pour claude.ai, et seulement lui :
les deux autres sites seront éprouvés un par un, comme claude.ai l'a été.

Ce qui a été mesuré sur claude.ai le 18 septembre, et qui gouverne le
parcours :

- `https://claude.ai/new?q=<texte>` **préremplit le champ** et **n'envoie
  rien** : c'est l'utilisateur qui clique. L'adresse est nettoyée en `/new`
  une fois la question posée.
- Claude affiche au-dessus du champ un **bandeau rouge** : « Soyez prudent
  avant d'exécuter cette invite. Un contenu malveillant pourrait inciter
  Claude à entreprendre des actions nuisibles ou à partager vos données. » Il
  ne bloque rien, mais il sera là à chaque génération.
- Le serveur accepte **64 Ko d'URL** (HTTP 200 jusqu'à 65 555 octets de
  requête, `414` à partir de 66 155). Encodé, du français accentué pèse
  1,53 fois sa longueur : **environ 43 000 caractères de texte** tiennent.
- Non mesuré : que le champ se remplisse vraiment à cette taille (et pas
  seulement que le serveur accepte l'adresse), et la borne de la **ligne de
  commande Windows** par laquelle `shell.openExternal` passe l'URL au
  navigateur (32 767 caractères pour `CreateProcess`). La borne effective est
  le minimum des deux : la première tâche du plan la mesure.

Et deux faits du code : le canal de copie du principal refuse au-delà de
8192 caractères (`canaux.ts`, `systemeCopierTexte`), et **aucune lecture du
presse-papier n'est exposée au rendu**, délibérément (`pont.ts`,
`copierTexte` : autoriser `clipboard-read` dans la fenêtre donnerait à la
page le droit de lire ce que l'utilisateur copie ailleurs). Ce document ne
revient pas sur cette règle : c'est le PRINCIPAL qui lira, sous les
conditions du §4, et le rendu ne recevra jamais que la réponse attendue.

**Le compte des gestes gouverne le reste** (demande d'Ahmed : le moins de
clics possible). Deux clics ne bougent pas sans piloter le site, ce qu'on
s'interdit : « Envoyer » sur claude.ai (le site n'envoie pas de lui-même,
et son bandeau rouge existe pour ça) et « Copier » la réponse. Tout ce qui
reste à gagner est après la copie : l'utilisateur ne doit ni revenir dans
l'application par lui-même, ni coller, ni confirmer. Le parcours cible est
donc **Ouvrir, Envoyer, Copier**, et l'application fait le reste. Deux
choses rendent ça possible, et elles viennent du fait que le prompt est le
nôtre : la réponse est demandée dans un **bloc de code** (sur claude.ai, un
bloc de code a son propre bouton Copier, un clic, toujours au même
endroit), et elle commence par un **jeton** tiré à l'ouverture, qui permet
au principal de la reconnaître sans rien lire d'autre. Le téléchargement
d'un fichier a été envisagé et écarté : même compte de clics au mieux, mais
il suppose que le site produise un artefact, ce que lui seul décide, et il
ouvrirait le périmètre du pont au dossier Téléchargements.

## 1. Le registre : une marque, des canaux (déjà en place)

`ai-providers.ts` porte `MARQUES` : une marque a un nom, un logo et un ou
plusieurs `Canal` (`id`, `label`, `sub`, `type: "cli" | "web" | "serveur"`).
Le réglage `aiProvider` porte **l'identifiant du canal**, jamais celui de la
marque : c'est lui qui décide ce que fait le bouton d'envoi. Les trois canaux
web (`claude-web`, `chatgpt-web`, `perplexity-web`) sont aussi dans
`PROVIDERS`, avec un `defaultModel` vide : un site n'a pas de modèle à choisir.

Ce qui s'ajoute : un membre optionnel sur `Canal`,

```ts
/** Comment ouvrir le site avec la question déjà écrite. Absent : le canal
    n'est pas câblé, le bouton le dit (« aperçu du design »). */
web?: { nouvelle: string; parametre: string };
```

posé sur `claude-web` seul : `{ nouvelle: "https://claude.ai/new", parametre:
"q" }`. `chatgpt-web` et `perplexity-web` restent sans `web` tant qu'ils
n'ont pas été mesurés : le bouton « Ouvrir » continue d'afficher la notice
`ai.channel.notWiredYet` pour eux. Un helper `estCanalCable(canalId)` le dit.

L'interface (menu à deux niveaux, contrôle « Claude · claude.ai », bouton
« Ouvrir », chevron accent sur la marque en usage, coche sur le canal dans
le flyout) est celle validée à l'écran le 18 septembre ; elle ne bouge pas.

## 2. Le texte qui part

**Aujourd'hui** : `generateInner` (`ai-client.ts`) assemble un `systemPrompt`
(le format `quiz-blocks`, la règle de langue, les maths, le nombre de
questions, le type) et un `userPrompt` (la demande, avec le contenu des notes
jointes inliné par `startGeneration`), puis les donne au CLI ou à Ollama.
Pour Claude Code, le texte envoyé est `systemPrompt + "\n\n" + userPrompt`.

**Demain** : cet assemblage sort dans une fonction **pure et exportée**,

```ts
export function composerPrompts(prompt: string, options: GenerateOptions): { systemPrompt: string; userPrompt: string }
```

appelée par `generateInner` (rien ne change pour les CLI : c'est le même
texte, déplacé) et par la page pour un canal web. Le nombre de questions, le
type et le contenu des notes jointes y sont déjà ; le dossier de destination
reste côté application (c'est là que le quiz est enregistré au retour, §5).

**Le texte d'un site** est celui de Claude Code sans images, plus une
consigne de FORME que seul un site reçoit, produite par une seconde fonction
pure :

```ts
/** Le texte complet qui part à un site : les deux prompts, puis la consigne
    de forme (bloc de code, jeton en première ligne). Le CLI ne la reçoit
    pas : il n'a pas de bouton Copier, et son parseur lit la sortie brute. */
export function texteWeb(prompts: { systemPrompt: string; userPrompt: string }, jeton: string): string
```

La consigne, en anglais comme le reste du prompt (elle s'adresse au modèle,
pas à l'utilisateur) : répondre par UN SEUL bloc de code ` ```json5 `, dont
la première ligne est le commentaire `// neo-quiz <jeton>`, suivi du tableau
et de rien d'autre ; aucun texte avant ni après le bloc. Le commentaire est
du JSON5 valide : `parseReponseQuiz` (§5) l'avale sans changement, et la
fence est déjà retirée par son expression régulière. La consigne REMPLACE
la dernière phrase du prompt système (« Reply ONLY with the JSON5 array,
with no explanation and no formatting ») pour un site ; elle est retirée du
texte par `texteWeb` pour ne pas dire une chose et son contraire.

**Le jeton** : dix caractères de `[a-z0-9]`, tirés par la page à chaque
ouverture (`crypto.getRandomValues`), portés par la phase d'attente. Il sert
à une seule chose : reconnaître LA réponse attendue dans le presse-papier
(§4). Un jeton neuf par ouverture : rouvrir le site en tire un autre, et
l'attente ne reconnaît que le dernier.

**Les images ne passent pas.** Ni une adresse ni un presse-papier texte ne
transportent une image. Si le composer en contient au moment d'ouvrir, rien
ne part : une notice le dit (`ai.channel.noImages`), le composer garde tout.
Même patron que le PDF refusé dans l'application (`ai.error.pdfUnsupportedInApp`).

## 3. L'ouverture

Une fonction pure, éprouvée par le contrôle du §8 :

```ts
export function preparerOuverture(texte: string, web: { nouvelle: string; parametre: string }, urlMax: number):
	| { mode: "url"; url: string }
	| { mode: "presse-papier"; url: string; texte: string }
```

`url = nouvelle + "?" + parametre + "=" + encodeURIComponent(texte)`. Si
`url.length <= urlMax`, mode `url` : le site s'ouvre avec la question déjà
écrite, il n'y a rien à coller. Sinon, mode `presse-papier` : le site s'ouvre
NU (`nouvelle`), le texte est copié, et l'écran d'attente (§4) dit de le
coller. `URL_MAX` est une constante de `ai-providers.ts`, fixée par la mesure
de la tâche 1, avec le chiffre mesuré en commentaire.

**Ouvrir** : une méthode de plus sur le contrat `HostShell`,

```ts
/** Ouvre une adresse `https:` dans le navigateur de l'utilisateur. `false`
    si l'hôte a refusé. Jamais un chemin de fichier : c'est `openExternal`. */
openUrl(url: string): Promise<boolean>;
```

Sous l'application : `window.open(url, "_blank", "noopener")`, que le
principal intercepte (`setWindowOpenHandler`, `main.ts`) et remet à
`shell.openExternal` quand c'est du `https?:` — le filtre qui existe déjà
pour les liens d'un quiz partagé, aucun canal IPC de plus. Sous le greffon :
`window.open` aussi, Obsidian le remet au navigateur. Les deux contrôles
d'hôte (`check:obsidian-host`, `check:windows-host`) gagnent un cas, éprouvé
par discriminance. `openUrl` refuse tout ce qui n'est pas `https:` avant
d'appeler `window.open` : le filtre du principal le refuserait aussi, mais
une garde côté contrat donne un `false` net au lieu d'un avertissement dans
la console.

### 3 bis. Le contrat d'attente

Un membre OPTIONNEL du contrat d'hôte, à côté de `process` et `pdf` :

```ts
/** L'attente d'une réponse copiée, pendant une génération par un site. Le
    principal sonde le presse-papier et ne livre que le texte qui porte le
    jeton (voir la spec du 2026-09-18, §4). Absent sous le greffon : la page
    attend alors un collage manuel. */
export interface HostCollage {
	/** Démarre l'attente ; la fonction rendue l'arrête. Une nouvelle attente
	    remplace la précédente. `surTexte` est appelé AU PLUS une fois. */
	attendre(jeton: string, surTexte: (texte: string) => void): () => void;
}
```

Sous l'application, `apps/windows/src/host/collage.ts` l'implémente sur
`window.neo.collage` (`attendre(jeton)`, `arreter()`, `surTexte(rappel)`),
ajouté au `Pont` et au preload sur le patron de `miseAJour`. Le principal
tient l'attente dans `canaux.ts` avec le noyau pur du §4.

**Copier** : `deps.copyText` existe déjà (le modal d'installation copie une
commande). Sa borne côté principal passe de 8192 à **524 288 caractères**
(512 Ko) : toujours une borne, mais qui laisse passer un prompt système de
6 Ko et deux notes de cours. Le commentaire de `canaux.ts` est réécrit pour
dire pourquoi. Si l'hôte n'a pas de `copyText` ou s'il rend `false`, rien ne
s'ouvre : `phase = "error"` avec `ai.channel.copyFailed`, et la demande
revient au composer. Ouvrir le site sans avoir copié laisserait l'utilisateur
devant un champ vide sans savoir pourquoi.

## 4. La phase « web » : la page attend un collage

`Phase` gagne une valeur, `"web"`. `startGeneration` reste le seul chemin
d'envoi ; au moment où il tient `msg` (le composer vidé, la demande en
bulle), il regarde le canal :

- canal CLI ou Ollama : ce qui existe, inchangé ;
- canal web câblé : `composerPrompts`, `preparerOuverture`, ouverture (et
  copie s'il le faut), puis `phase = "web"` et rendu ;
- canal web non câblé : la notice `notWiredYet`, et le message retourne au
  composer (`restoreComposerMessage`), comme une annulation.

**Le rendu de la phase « web »** reprend la maquette validée : la bulle
« envoyé » en haut (comme en `loading`), puis à la place du loader une
carte :

- titre « Copie la réponse de claude.ai » (le nom du site vient du canal),
  et une ligne qui dit ce qui va se passer : « dès qu'elle est copiée, le
  quiz se crée ici tout seul » ;
- **un callout au style exact du bandeau de claude.ai** (fond rouge sombre,
  bordure rouge, icône d'alerte à gauche, texte rouge clair), demandé par
  Ahmed le 2026-09-18 pour que l'utilisateur reconnaisse le bandeau quand il
  le verra. Trois à quatre phrases, pas plus : il va s'afficher ; il apparaît
  parce que la question arrive par un lien et non par le clavier, et
  claude.ai le montre pour toute invite venue d'un lien ; ici le lien vient
  de Neo Quiz et la question est la sienne ; envoie comme d'habitude. En
  mode presse-papier, une ligne dit d'abord que le texte est copié et qu'il
  faut le coller là-bas ;
- deux boutons fantômes : « Rouvrir claude.ai » (rejoue l'ouverture avec
  un jeton neuf) et « Annuler » (retour à `idle`, la demande revient dans
  le composer, comme l'annulation d'une génération).

Le composer reste en bas, vide, comme pendant une génération. Pas de zone
de collage : le collage manuel reste possible (ci-dessous) mais n'est plus
le chemin nominal, et un champ qui l'appelle ferait croire qu'il est
obligatoire.

**La veille, par le principal.** À l'entrée de la phase, la page appelle
`host.collage.attendre(jeton, surTexte)` (contrat, §3 bis) ; l'hôte Windows
le remet au principal, qui **sonde le presse-papier toutes les 500 ms**
(`clipboard.readText()`) tant que l'attente dure. Règles, toutes dans un
noyau PUR (`apps/windows/electron/attente-collage.ts`, éprouvé par
`check:electron-collage`) :

- le jeton doit faire au moins huit caractères de `[a-z0-9]`, sinon
  l'attente est REFUSÉE : un jeton vide ferait reconnaître n'importe quoi ;
- un texte est livré si et seulement s'il **contient le jeton** ; tout
  autre contenu est oublié sur place, sans journal, sans transmission ;
- une seule livraison : dès qu'un texte est livré, l'attente s'arrête ;
- l'attente s'arrête aussi sur `arreter()` (Annuler, Esc, `dispose`, un
  nouveau `attendre` qui la remplace) et **après trente minutes**, pour ne
  jamais laisser une sonde tourner sans que personne n'attende ;
- deux attentes ne coexistent pas : une nouvelle remplace l'ancienne.

À la livraison, le principal pousse le texte au rendu (`webContents.send`,
même patron que `miseAJour.surEtat`) et **fait clignoter la fenêtre dans la
barre des tâches** (`flashFrame(true)`, éteint au prochain `focus`), sans
la ramener de force : Windows refuse le vol de focus, et un utilisateur
qui lit encore la réponse ne veut pas être interrompu. Sous le greffon,
`host.collage` est absent : la page attend alors un collage manuel, et la
carte le dit (« colle la réponse ici avec Ctrl+V »).

**Le collage manuel reste** comme second chemin (la fenêtre déjà sous les
yeux, ou un hôte sans veille) : un écouteur `paste` sur `document`
(capture), posé à l'entrée de la phase et retiré à sa sortie et dans
`dispose`. Il ne traite que le texte (`clipboardData.getData("text/plain")`)
et **ignore un collage dont la cible est le composer** : y coller, c'est
écrire une nouvelle demande, pas répondre. Il n'exige pas le jeton (un
collage est un geste volontaire, il vaut consentement). Esc annule, comme
pendant une génération.

## 5. Le retour : du texte collé au quiz enregistré

`parseQuizResponse` (`ai-client.ts`) sort de la closure et devient une
fonction **exportée** `parseReponseQuiz(texte): unknown[]`, sans changer une
ligne de son corps : elle sait déjà retirer une fence ```` ```json ````,
réparer les backslashes du LaTeX, distinguer un quiz mal formé (l'erreur du
parseur, avec sa position) d'une réponse qui n'est pas un quiz
(`nonQuizResponseError`, qui montre ce que le modèle a dit). `generateInner`
continue de l'appeler.

Le texte arrive par l'un des deux chemins du §4 (la veille du principal,
ou un collage manuel) et suit ensuite **un seul chemin**, `recevoirReponse
(texte)`, qui arrête l'attente, puis : `generatedQuestions =
parseReponseQuiz(texte)`, et **la même suite que la génération** :
`generationId++`, `phase = "result"`, `saveGeneratedQuiz()`. `lastUsage`
reste `null` : un site ne publie rien, et on n'estime jamais un compteur
absent.

Échec : `phase = "error"`, `errorMessage` = le message du parseur, et
**l'action de l'écran d'erreur est « Rouvrir claude.ai »**, pas
« Réessayer » : réessayer relancerait une génération que l'application n'a
jamais faite. Un nouvel état `errorAction: "reopen" | null` le porte, à côté
de `errorLogin` ; « Rouvrir » remet la page en phase `web` avec la même
ouverture. Le message d'échec garde ce que le parseur a dit : « la réponse
n'est pas un quiz : <aperçu> » est plus utile qu'une paraphrase.

## 6. Ce qui ne change pas

Les CLI, Ollama, leurs statuts, leurs modèles et efforts, le modal
d'installation, la connexion, le journal d'usage : rien. L'écran d'options
(nombre, type, dossier) reste ; ses deux premières valeurs entrent dans le
texte par `composerPrompts`, comme aujourd'hui, la troisième sert à
l'enregistrement. Le sanitizer, l'écriture du bloc (`detail-io.ts`) : rien.

## 7. Sécurité

`openUrl` passe par le filtre existant du principal (`https?:` seulement,
remis au navigateur, jamais une navigation de la fenêtre) : aucun canal
IPC pour ouvrir. Le texte de la question, notes comprises, part au site
**par le navigateur de l'utilisateur, dans son onglet, avec son compte** :
c'est le but, et c'est lui qui clique pour envoyer. Le presse-papier n'est
écrit que sur un clic, avec ce que l'utilisateur vient de composer. La
borne de copie reste une borne.

La lecture du presse-papier est le point neuf, et voici pourquoi elle ne
rouvre pas ce que le pont a fermé : le RENDU ne lit toujours rien
(`clipboard-read` reste refusé à la page) ; c'est le principal qui lit,
seulement pendant une attente que l'utilisateur a ouverte lui-même en
cliquant « Ouvrir », bornée dans le temps et arrêtée au premier résultat ;
et ce qu'il lit ne quitte jamais le principal tant qu'il ne porte pas le
jeton de CETTE attente, un secret de dix caractères que seul le prompt
envoyé porte. Un rendu compromis peut ouvrir une attente, mais n'obtient
que ce que l'utilisateur copie en réponse à ce prompt-là. Le contenu
non reconnu n'est ni journalisé ni conservé : `readText` à chaque tour,
comparaison, oubli.

## 8. Contrôles

- `npm run check:web-channel` (nouveau, sur le modèle de
  `check-ai-providers.mjs`, chargeant le CODE RÉEL) :
  - `preparerOuverture` : sous la borne → `url`, avec le texte encodé ;
    au-dessus → `presse-papier`, `url` nue, `texte` intact ; la borne
    exacte (égalité) → `url` ;
  - `parseReponseQuiz` : un tableau nu ; un tableau dans une fence
    ```` ```json ```` avec de la prose avant et après ; du LaTeX à
    backslash simple réparé ; une phrase sans quiz → erreur `notQuiz` ; un
    quiz mal formé → l'erreur du parseur ;
  - `composerPrompts` : pour `count: 7`, `type: "Choix unique"`, `source:
    "text"`, le `systemPrompt` porte « exactly 7 » et « single-choice », le
    `userPrompt` commence par « Generate a quiz based on the following
    text » — les mêmes chaînes que le CLI reçoit, puisque c'est la même
    fonction ;
  - `texteWeb` : le texte contient le jeton dans `// neo-quiz <jeton>`,
    demande un bloc ```` ```json5 ````, et ne contient PLUS « no
    explanation and no formatting » ;
  - `estCanalCable` : vrai pour `claude-web`, faux pour `chatgpt-web`.
  Chaque cas s'éprouve par discriminance : casser la règle, voir rougir.
- `npm run check:electron-collage` (nouveau, sur le modèle de
  `check-electron-index.mjs`) : le noyau pur de l'attente avec un faux
  presse-papier et un faux temps : jeton trop court refusé ; texte sans
  jeton jamais livré, même répété ; texte avec jeton livré UNE fois puis
  attente arrêtée (la sonde ne relit plus) ; `arreter()` coupe ; trente
  minutes coupent ; une seconde attente remplace la première (le texte de
  la première n'est plus livré).
- `check:obsidian-host`, `check:windows-host` : le cas `openUrl` (refuse
  `http:` et `file:`, accepte `https:`).
- `check:ai-providers` : reste vert (le registre gagne un membre optionnel).
- Le test manuel dans l'application, sur la vraie claude.ai : une demande
  courte (mode `url`), une demande avec deux notes (mode `presse-papier` si
  elle dépasse), un collage de réponse, un collage de prose (l'erreur et son
  bouton « Rouvrir »), Esc pendant l'attente.

## 9. Ce qui accompagne le code

- i18n, dans les deux dictionnaires : le titre de la carte (« Copie la
  réponse de {site} ») et sa ligne « le quiz se crée ici tout seul », sa
  variante sans veille (« colle la réponse ici avec Ctrl+V »), le callout
  sur le bandeau rouge, l'aide « texte copié, colle-le là-bas », les boutons
  « Rouvrir {site} » et « Annuler », la notice `noImages`, l'erreur
  `copyFailed`, l'action d'erreur « Rouvrir {site} ».
- `CHANGELOG.md`, sous `[Unreleased]`, `### Added` : « Générer par claude.ai,
  depuis le menu des fournisseurs : le site s'ouvre avec la question déjà
  écrite, la réponse se colle dans l'application. »
- La note du vault (`Objectifs & Idées.md`, callout de la version en cours) :
  une tranche « Générer par un site », les tâches du plan, par un agent
  haiku au moment du plan.

## 10. Hors périmètre, nommé

- **chatgpt.com et perplexity.ai** : le registre les porte, le menu les
  montre, le bouton dit « aperçu ». Chacun se câble après sa propre mesure
  (préremplissage, envoi automatique ou non, borne), en posant son membre
  `web`.
- **Les images par un site** : refusées, pas contournées.
- **La détection d'un fichier téléchargé** : envisagée, écartée pour
  cette version (§0) ; elle pourrait rejoindre la même attente plus tard.
- **Le modèle par l'URL** (`?model=`) : non prouvé ; le site garde son
  modèle par défaut, et le contrôle du milieu ne propose pas de modèle.
