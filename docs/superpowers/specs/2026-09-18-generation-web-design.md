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
presse-papier n'est exposée**, délibérément (`pont.ts`, `copierTexte` :
autoriser `clipboard-read` dans la fenêtre donnerait à la page le droit de
lire ce que l'utilisateur copie ailleurs). Le retour se fait donc par un
`paste`, jamais par une relecture programmée.

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
texte, déplacé) et par la page pour un canal web. **Le texte d'un site est
exactement celui de Claude Code sans images** : `systemPrompt + "\n\n" +
userPrompt`. Le nombre de questions, le type et le contenu des notes jointes
y sont déjà ; le dossier de destination reste côté application (c'est là
que le quiz est enregistré au retour, §5). Rien de plus à faire entrer dans
le texte.

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

- titre « Colle la réponse de claude.ai » (le nom du site vient du canal) ;
- une zone de collage : un `<textarea>` au placeholder « Colle ici, ou
  Ctrl+V n'importe où sur la page », qui prend le focus à l'entrée de la
  phase ;
- une ligne d'aide qui prévient du bandeau rouge de claude.ai (« claude.ai
  affiche un avertissement sur les invites venues d'un lien : c'est normal,
  envoie ») et, en mode presse-papier, dit que le texte est copié et qu'il
  faut le coller là-bas d'abord ;
- deux boutons fantômes : « Rouvrir claude.ai » (rejoue l'ouverture, même
  texte) et « Annuler » (retour à `idle`, la demande revient dans le
  composer, comme l'annulation d'une génération).

Le composer reste en bas, vide, comme pendant une génération.

**Le collage** : un écouteur `paste` sur `document` (capture), posé à
l'entrée de la phase et retiré à sa sortie et dans `dispose`. Il ne traite
que le texte (`clipboardData.getData("text/plain")`) et **ignore un collage
dont la cible est le composer** : y coller, c'est écrire une nouvelle
demande, pas répondre. Tout autre collage (le textarea de la carte, ou la
page elle-même quand aucun champ n'a le focus) est la réponse. Esc annule,
comme pendant une génération.

## 5. Le retour : du texte collé au quiz enregistré

`parseQuizResponse` (`ai-client.ts`) sort de la closure et devient une
fonction **exportée** `parseReponseQuiz(texte): unknown[]`, sans changer une
ligne de son corps : elle sait déjà retirer une fence ```` ```json ````,
réparer les backslashes du LaTeX, distinguer un quiz mal formé (l'erreur du
parseur, avec sa position) d'une réponse qui n'est pas un quiz
(`nonQuizResponseError`, qui montre ce que le modèle a dit). `generateInner`
continue de l'appeler.

Réussite : `generatedQuestions = parseReponseQuiz(texte)`, puis **la même
suite que la génération** : `generationId++`, `phase = "result"`,
`saveGeneratedQuiz()`. `lastUsage` reste `null` : un site ne publie rien, et
on n'estime jamais un compteur absent.

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

Aucun canal IPC nouveau. `openUrl` passe par le filtre existant du principal
(`https?:` seulement, remis au navigateur, jamais une navigation de la
fenêtre). Le texte de la question, notes comprises, part au site **par le
navigateur de l'utilisateur, dans son onglet, avec son compte** : c'est le
but, et c'est lui qui clique pour envoyer. Le presse-papier n'est écrit que
sur un clic, avec ce que l'utilisateur vient de composer, et jamais lu par
l'application : le `paste` ne voit que ce qu'il colle volontairement. La
borne de copie reste une borne.

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
  - `estCanalCable` : vrai pour `claude-web`, faux pour `chatgpt-web`.
  Chaque cas s'éprouve par discriminance : casser la règle, voir rougir.
- `check:obsidian-host`, `check:windows-host` : le cas `openUrl` (refuse
  `http:` et `file:`, accepte `https:`).
- `check:ai-providers` : reste vert (le registre gagne un membre optionnel).
- Le test manuel dans l'application, sur la vraie claude.ai : une demande
  courte (mode `url`), une demande avec deux notes (mode `presse-papier` si
  elle dépasse), un collage de réponse, un collage de prose (l'erreur et son
  bouton « Rouvrir »), Esc pendant l'attente.

## 9. Ce qui accompagne le code

- i18n, dans les deux dictionnaires : le titre et le placeholder de la carte,
  l'aide sur le bandeau rouge, l'aide « texte copié », les boutons
  « Rouvrir {site} » et « Annuler », la notice `noImages`, l'action
  d'erreur.
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
- **La relecture automatique du presse-papier au retour** : refusée par le
  pont, pour de bonnes raisons ; le `paste` fait le travail.
- **Le modèle par l'URL** (`?model=`) : non prouvé ; le site garde son
  modèle par défaut, et le contrôle du milieu ne propose pas de modèle.
