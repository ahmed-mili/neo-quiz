# Le parcours fournisseur IA : installer, connecter, choisir un modèle — design

**Date** : 2026-09-19 · **Statut** : design validé en discussion, à
planifier · **Périmètre** : le processus principal Electron (`apps/windows/
electron/process.ts`, `canaux.ts`), le code partagé de la page « Générer »
(`src/dashboard/ai.ts`, `ai-providers.ts`, `ai-client.ts`, `ai-install-modal.ts`,
`ui-select.ts`), les réglages IA (`ai-settings-host.ts`), les dictionnaires
`src/i18n/{en,fr}/ai.ts` et `app.ts`, le CSS `dashboard-ai.css`. Le greffon
Obsidian n'est pas touché : il ne rend plus qu'un quiz.

## 0. D'où ça vient

Le 18 septembre au soir, après la publication de la 1.6.0, Ahmed a éprouvé le
parcours complet d'un nouvel utilisateur dans sa VM et a noté neuf défauts
dans le callout `[!bug]` de la note du chantier (« Objectifs & Idées »). Les
captures sont dans le vault (`Pièces jointes/Pasted image 20260918*.png`).
Le fil conducteur est la règle qu'il a posée ce soir-là :

> Plus jamais un utilisateur ne doit ne pas réussir à générer de quiz parce
> qu'il n'est pas connecté : il vient juste d'installer, on doit anticiper
> qu'il n'est pas connecté.

Ce document reprend les neuf points, groupés par mécanisme, avec ce que
l'enquête du 19 septembre a établi sur chacun.

## 1. Ce qui a été établi

### 1.1 Pourquoi `claude` est introuvable dans le terminal (capture 1)

L'application détecte Claude Code par un PATH **étendu** : `environnementEnfant`
(`process.ts`) ajoute au PATH du système `~/.local/bin` (où `install.ps1`
pose `claude.exe`), `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`,
`%APPDATA%\npm`, et une dizaine d'autres dossiers de gestionnaires. Le script
PowerShell du terminal, lui, ne recharge que le PATH **du registre**
(`RECHARGER_PATH`). Quand l'installateur de Claude Code n'a pas écrit
`~/.local/bin` dans le PATH utilisateur (ce qui s'est produit dans la VM),
l'application dit « installé » pendant que le terminal dit « terme non
reconnu ». Deux lectures du même disque, qui divergent sans qu'aucun contrôle
ne le voie.

Le second défaut de la capture est indépendant : `Write-Host "Claude Code est
connecté…"` est la ligne qui SUIT `claude auth login`, sans condition. Elle
s'affiche après l'échec.

### 1.2 Pourquoi l'attente survit au changement de fournisseur (capture 3)

`onPick` du menu des marques sauve `aiProvider` et redessine. La phase reste
`connexion`, `loginPoll` continue de sonder l'ancien outil. Rien ne relie le
choix d'un fournisseur à l'attente en cours.

### 1.3 Pourquoi la connexion n'est jamais anticipée

Les sondes `checkClaudeLogin` (`claude auth status`, JSON `loggedIn`) et
`checkCodexLogin` (`codex login status`, code de sortie) existent, mais ne
sont appelées que depuis la carte d'ERREUR, après une génération refusée.
Pour Ollama, le code dit « pas de compte » (`scriptConnexion` rend `null`) :
or les sept modèles cloud de la sélection par défaut exigent un compte
(`ollama signin`), et un utilisateur qui vient d'installer Ollama voit son
premier envoi échouer sur `ai.err.ollamaSignin`, qui lui dit de taper une
commande.

Mesuré le 19 septembre sur le démon local (Ollama 0.34.2) :

- `POST /api/me` répond **200** `{ "plan": "free" | "pro" | …, "name", "email",
  … }` quand le démon est connecté à un compte, et **401**
  `{ "error": "unauthorized", "signin_url": "https://ollama.com/connect?…" }`
  sinon. L'URL porte la clé publique du démon : l'ouvrir dans le navigateur et
  approuver connecte le démon, sans aucune commande. C'est le mécanisme de
  `ollama signin`, exposé par HTTP. (Source : `WhoamiHandler`,
  `server/routes.go` du dépôt ollama/ollama.)
- Seul `plan` est lu. `email`, `name`, `avatarurl` ne sont ni conservés, ni
  journalisés, ni rendus à l'appelant, comme pour `claude auth status`.

### 1.4 Ollama : ce qu'on peut savoir du prix d'un modèle (captures 4 à 7)

Ahmed veut, sur un compte gratuit, voir les modèles payants marqués comme
claude.ai marque les siens : badge **Pro** et lien **Mettre à niveau** sur
la ligne. Ce qui existe, mesuré le 19 septembre :

- **Aucune source publique ne liste les modèles « starter »** du plan
  gratuit. `ollama.com/pricing` dit « includes access to starter models »
  sans les nommer ; la liste (capture 5 : gemma4:31b, gpt-oss:120b,
  gpt-oss:20b, nemotron-3-nano:30b, nemotron-3-super, nemotron-3-ultra) n'est
  visible que sur la page des réglages, derrière la connexion.
- `GET /api/experimental/model-recommendations` (sur le démon, qui met en
  cache `https://ollama.com/api/experimental/model-recommendations`) porte
  `required_plan: "free" | "pro"` pour **cinq modèles** seulement. C'est ce
  que l'application Ollama elle-même utilise (`requiredPlan` dans son bundle,
  « Pro plan required »).
- Un modèle hors plan répond **402** :
  `this model is not included in your free usage, add usage credits to pay as
  you go: https://ollama.com/settings or upgrade for included usage:
  https://ollama.com/upgrade`. `ai-client.ts` ne le reconnaît pas (il cherche
  « subscription » ou « upgrade for access ») : l'utilisateur voit
  `ai.err.ollamaHttp` générique.
- Un appel `/api/chat` **sans message** rend `done_reason: "load"` sans
  vérifier le plan : il n'existe pas de sonde gratuite.

Décision d'Ahmed (19 septembre) : **`required_plan` + 402 appris**, pas de
sonde en arrière-plan (une vingtaine de requêtes sur le slot de concurrence
unique du compte gratuit), pas de liste embarquée (ce serait « des modèles
codés en dur », que le projet interdit ; elle pourrirait sans erreur).

### 1.5 Le catalogue cloud dynamique est mort

`fetchOllamaCloudCatalog` cherche `x-test-search-response-title` dans le HTML
de `ollama.com/search?c=cloud`. Ce marqueur n'y est plus : la fonction
n'extrait aucune famille et rend le repli embarqué, sans erreur, depuis une
date inconnue. `https://ollama.com/api/tags` rend le même catalogue en JSON
(`{ models: [{ name: "glm-5.3", modified_at, size }, …] }`, vingt modèles le
19 septembre). Ce n'est pas un des neuf points d'Ahmed, mais il touche le
même module et la même règle (les modèles ne sont jamais codés en dur) : il
entre dans ce chantier.

### 1.6 Le presse-papier (question d'Ahmed)

Le processus principal appelle `clipboard.readText()` d'Electron toutes les
500 ms **pendant l'attente seulement** (`attente-collage.ts`, câblé dans
`canaux.ts`). Windows n'a aucune permission pour cela : toute application de
bureau lit le presse-papier librement ; seule une page web dans un navigateur
doit demander. Ce qui rend la lecture acceptable est écrit dans le noyau pur :
un texte n'est LIVRÉ que s'il porte le jeton de l'attente en cours, le reste
est comparé puis oublié sans journal, et la sonde s'arrête d'elle-même à
trente minutes. Rien à changer ; la réponse est consignée ici.

## 2. Le terminal : une fenêtre, qui dit vrai et se ferme seule

Décision d'Ahmed : terminal **visible**, installation et connexion
enchaînées, fermeture automatique sur succès. (L'installation cachée a été
écartée : une sonde du 17 septembre a montré qu'un lanceur masqué ne rouvre
pas de fenêtre visible ensuite, et l'utilisateur ne verrait pas un
installateur qui échoue.)

### 2.1 Les dossiers des CLI, une seule liste

La liste des dossiers que `environnementEnfant` ajoute au PATH devient une
fonction pure exportée, `dossiersCli(env)`, que `environnementEnfant` appelle
et que les deux scripts PowerShell recopient : après l'installation,
`$env:Path` reçoit le PATH utilisateur + machine du registre PUIS ces
dossiers. Ce que l'application voit, le terminal le voit.

### 2.2 Un gabarit pour les deux scripts

`scriptInstallation` et `scriptConnexion` composent le même squelette :

```
$host.UI.RawUI.WindowTitle = '<titre>'
<ligne d'installation>                 # scriptInstallation seulement
<recharger le PATH : registre + dossiersCli>
<commande de connexion>                # claude auth login | codex login
if ($LASTEXITCODE -eq 0) {
    Write-Host '<messageSucces>' -ForegroundColor Green
    Start-Sleep -Seconds 2
} else {
    Write-Host '<messageEchec>' -ForegroundColor Red
    Read-Host | Out-Null                 # la fenêtre reste jusqu'à Entrée
}
```

- **Plus de `-NoExit`** dans `argumentsTerminal` : c'est le script qui décide
  de rester (échec) ou de finir (succès, la fenêtre se ferme à la fin du
  script).
- **Plus de REPL `claude`** après l'installation : `claude auth login` dans les
  deux scripts. La raison du REPL (« la recette d'installation y enchaîne »)
  ne tenait pas ; la sous-commande fait le travail et rend un code de
  sortie, le REPL non.
- L'installation qui échoue : la ligne d'installation est suivie d'un test de
  `$LASTEXITCODE` ; échec → message rouge, `Read-Host`, fin. On n'enchaîne
  pas la connexion sur un outil qui n'est pas là. Pour que ce code de sortie
  EXISTE, l'installateur de Claude tourne dans un **sous-processus** :
  `install.ps1` fait `exit 1` sur chaque échec, et un `exit` dans un `irm |
  iex` lancé dans la session ferme la fenêtre entière, sans un mot. La forme
  lancée devient donc `powershell -ExecutionPolicy Bypass -c "irm
  https://claude.ai/install.ps1 | iex"` — la même forme que la ligne
  officielle de Codex, celle qui a marché dans la VM là où la forme nue
  mourait. C'est un ÉCART entre la ligne affichée et la ligne lancée, du
  même genre que les deux drapeaux d'Ollama : écrit dans
  `commandeInstallationLancee`, justifié sur place, éprouvé par
  `check:electron-process`. La ligne AFFICHÉE reste la ligne courte de la
  documentation, parce que celui qui la tape voit lui-même la fenêtre.
- Deux messages d'échec nouveaux, traduits (`app.installCli.failed`,
  `app.connectCli.failed`) : « L'installation de {name} a échoué. Fermez cette
  fenêtre et réessayez depuis Neo Quiz, ou suivez les étapes manuelles. » /
  « La connexion à {name} a échoué. Fermez cette fenêtre et réessayez depuis
  Neo Quiz. » Les messages de succès existants perdent « Vous pouvez fermer
  cette fenêtre » (elle se ferme) : « {name} est connecté. Retour dans Neo
  Quiz… ».
- **Ollama n'a plus de script de connexion du tout** (§3.4) ; son script
  d'installation garde sa forme (installation, message, fin) et se ferme
  aussi seul.

### 2.3 Ce que `check:electron-process` éprouve

Pour chaque outil : la ligne d'installation reste celle du modal (inchangé) ;
le script contient chaque dossier de `dossiersCli` ; la commande de connexion
est `claude auth login` / `codex login` (jamais `claude` nu) ; le message de
succès est sous une condition sur `$LASTEXITCODE` et le message d'échec dans
l'autre branche ; `argumentsTerminal` ne contient plus `-NoExit`. Éprouvé par
discriminance : retirer la condition fait rougir.

## 3. La connexion anticipée

### 3.1 Où la sonde est appelée

`sondeConnexion(tool)` (Claude, Codex) et la nouvelle `checkOllamaCompte(url)`
(§3.4) sont appelées :

1. au **choix du fournisseur** (`onPick`, et au premier rendu si un
   fournisseur est déjà réglé) ;
2. à la **détection d'une installation** dans le modal (§3.3) ;
3. au **retour de focus de la fenêtre**, avec les statuts CLI
   (`__focusRecheck` existant) — c'est ce qui fait disparaître le hint quand
   l'utilisateur revient du navigateur.

Elles ne sont appelées que pour un canal `cli` (Claude Code, Codex) ou pour
Ollama quand le modèle courant est cloud (`isOllamaCloudModel`) : un modèle
local n'a pas besoin de compte, et le hint n'a rien à dire. Un site (canal
`web`) n'a pas de sonde.

Le résultat est mis en cache par outil avec le même TTL que les statuts CLI
(`CLAUDE_CODE_TTL`), `force` au retour de focus et au choix du fournisseur.

### 3.2 Le hint « compte non connecté »

Pas connecté → le hint existant sous le composer (`renderHint`), type `warn`,
icône `log-in` :

- Claude : « Votre compte Claude n'est pas encore connecté. » + action
  « Se connecter » (les chaînes `ai.login.reason.claude` et `ai.login.button`
  existent) ;
- Codex : idem avec `ai.login.reason.codex` ;
- Ollama : nouvelle chaîne `ai.login.reason.ollama` : « Ollama n'est pas
  connecté à votre compte ; les modèles cloud en ont besoin. » + « Se
  connecter ».

Le bouton Envoyer **reste actif** : la sonde peut se tromper (CLI d'une
version qui ne répond pas au statut), et la carte d'erreur existante reste
le filet. Le hint prévient AVANT, il n'interdit pas.

Cliquer « Se connecter » depuis le hint fait exactement ce que le bouton de
la carte d'erreur fait (`demarrerConnexion`) : terminal (Claude, Codex) ou
navigateur (Ollama), puis la carte « En attente de la connexion » avec sa
sonde. Quand le compte est vu : coche, une seconde, puis retour à `idle`
(pas de relance : il n'y avait pas de demande envoyée). `providerHint[id]`
est remis à `null` et le hint disparaît.

### 3.3 Après « Installer automatiquement »

La fenêtre enchaîne déjà la connexion (§2.2). À la détection de
l'installation, le modal montre « {name} est installé » et son bouton
« Continuer » ; au clic (ou à la fermeture), la page appelle la sonde de
connexion : pas connecté → elle passe directement en phase `connexion`
(la carte d'attente existante, « Terminez la connexion dans la fenêtre de
terminal qui vient de s'ouvrir »), **sans que l'utilisateur ait à cliquer
« Se connecter »** — le terminal est déjà ouvert sur la connexion. Connecté
(l'utilisateur a été plus rapide que la détection) → rien, le composer.

Pour Ollama, il n'y a pas de connexion dans le terminal : la détection ouvre
le hint de §3.2 (le navigateur ne s'ouvre pas sans un clic ; on n'ouvre pas
un site que l'utilisateur n'a pas demandé).

### 3.4 Ollama : le compte par `/api/me`

`checkOllamaCompte(url)` dans `ai-providers.ts`, par `host.net.fetchJson`
(`POST <url>/api/me`, corps `{}`) :

- 200 + JSON avec `plan` chaîne → `{ connecte: true, plan }` ;
- 401 + JSON avec `signin_url` en `https://ollama.com/…` → `{ connecte:
  false, signinUrl }` ;
- tout le reste (démon arrêté, 200 sans JSON, 401 sans URL, autre hôte dans
  `signin_url`) → `{ connecte: false, signinUrl: null }` : le hint dit « pas
  connecté » sans bouton, avec l'instruction `ollama signin` (chaîne
  existante `ai.err.ollamaSignin`, reformulée sans « In a terminal »).

`demarrerConnexion("ollama")` ouvre `signinUrl` par `host.shell.openUrl` (le
principal remet tout `https` au navigateur), puis la carte d'attente sonde
`/api/me` toutes les `SONDE_CONNEXION_MS` jusqu'au 200. Le contrat d'hôte ne
change pas : `HostProcess.connecterCli` garde ses deux outils, Ollama n'y
passe plus (`scriptConnexion("ollama")` reste `null`, et la page ne l'appelle
plus).

`aiOllamaUrl` est déjà borné par `garde-ia.ts` (http(s), hôte admis) : le
`POST /api/me` va au même hôte que `/api/tags`, aucun droit de plus.

### 3.5 Changer de fournisseur pendant l'attente

`onPick` (menu des marques) et le clic sur un canal appellent
`annulerConnexion()` avant de sauver : `couperSondeConnexion()`, puis, si la
phase était `connexion`, retour à `idle` avec le message rendu au composer
(`restoreComposerMessage`, le même chemin qu'Annuler dans la carte web).
Annuler dans la carte fait pareil (aujourd'hui il retombe sur `error`, ce qui
n'a de sens que venant d'une erreur : venant du hint de §3.2, il n'y a pas
d'erreur à remontrer ; la carte mémorise d'où elle vient — `connexionOrigine:
"erreur" | "hint"` — et retombe sur `error` ou `idle`).

## 4. Ollama : catalogue, plan, prix, icônes

### 4.1 Le catalogue par `/api/tags`

`fetchOllamaCloudCatalog` lit `https://ollama.com/api/tags` et en tire les
familles (`name` sans le suffixe de tag) ; le reste de la fonction (tags
exacts embarqués prioritaires, ajout des familles strictement plus récentes,
`dedupeOllamaLatest`) ne change pas. Un corps qui n'est pas du JSON, ou sans
`models`, lève comme aujourd'hui (l'appelant garde le cache précédent ou le
repli). `check:ai-providers` éprouve la lecture sur un corps JSON fixé et le
rejet d'un corps HTML — c'est exactement le cas qui a tué la version
précédente en silence.

### 4.2 Le plan du compte et les modèles Pro

Nouveau dans `ai-providers.ts`, pur :

- `fetchOllamaPlansRequis(url)` : `GET <url>/api/experimental/
  model-recommendations` sur le démon → `Record<tag, "free" | "pro" | …>` des
  entrées qui portent `required_plan`. Best effort : échec → `{}`.
- `planRequisPour(tag, sources)` où `sources = { recommandations, appris }` :
  le plan requis d'un modèle, ou `null` si aucune source ne le sait.
- `modeleHorsPlan(planCompte, planRequis)` : vrai quand le plan requis est
  au-dessus du plan du compte. L'ordre `free < pro < max < team` est une
  constante locale ; un plan inconnu vaut « au-dessus de free » (un compte
  `free` voit alors le badge, un compte payant ne le voit pas).

Nouveau réglage persisté `aiOllamaPlansAppris: Record<string, string>` (tag →
plan requis), écrit par `ai-client.ts` quand un 402 arrive (§4.3), et
**vidé** quand `/api/me` rend un plan différent du dernier vu
(`aiOllamaPlanCompte`, autre réglage) : un compte passé à Pro ne garde pas
les badges de l'époque gratuite.

Dans le menu (`buildOllamaList` → `ModelOption`) : un modèle cloud hors plan
porte `badge: "Pro"` (la propriété existe, c'est celle de Fable) et une
nouvelle propriété `upgrade?: { label, url }` que `appendModelOption` rend à
droite de la ligne, avant l'icône, en lien (`qbd-model-option-upgrade`) qui
ouvre `https://ollama.com/upgrade` par `host.shell.openUrl` sans fermer le
menu ni sélectionner le modèle. **La ligne elle-même reste sélectionnable** :
le 402 est la seule vérité, et un utilisateur qui a acheté des crédits à
l'usage passe sans changer de plan.

Le trigger du composer (modèle courant) montre le même badge.

### 4.3 Le 402 reconnu et appris

`ai-client.ts`, appel Ollama : un statut **402**, ou un corps dont l'erreur
contient `not included in your` ou `upgrade for included usage`, devient
`userError(t("ai.err.ollamaPlan", { model }))` : « {model} n'est pas compris
dans votre compte Ollama gratuit. Ajoutez des crédits ou passez à un plan
supérieur, ou choisissez un modèle gratuit. » La carte d'erreur montre alors
« Mettre à niveau » (ouvre `ollama.com/upgrade`) à la place de
« Réessayer » — même mécanisme qu'`errorAction: "reopen"`, avec une valeur
`"upgrade"`. Avant de lever, le client écrit `aiOllamaPlansAppris[model] =
"pro"` par le `saveSettings` de l'hôte de réglages.

Les tests existants de « subscription » restent (autre message, autre
époque) ; `check:ai-providers` éprouve le 402 nu et le message mesuré.

### 4.4 Les icônes cloud alignées (capture 4)

`.qbd-model-option-body { flex: 1; min-width: 0; }` : sans lui, le corps ne
remplit pas la ligne et `margin-left: auto` de l'icône ne cale rien. La
coche (`.qbd-select-check`) passe après l'icône dans le DOM pour que la
colonne des nuages soit la même sur toutes les lignes, coche ou pas. À
vérifier à l'écran sur la liste par défaut (sept lignes, une cochée).

## 5. L'avertissement claude.ai : un modal au choix, plus dans la carte

- Le callout sort de `renderWeb` (la carte d'attente n'a plus que le titre,
  la ligne forte et les deux boutons).
- Choisir le canal `claude-web` dans le menu (et tout canal `web` dont le
  site affiche un tel bandeau — aujourd'hui claude.ai seul, la propriété
  `avertissement: true` sur le `Canal` le dit) ouvre un modal centré par
  `host.modals.open` (`qbd-web-warning-modal`) : titre « Avant d'ouvrir
  claude.ai », le texte existant `ai.web.callout` dans un callout aux
  couleurs **exactes** du bandeau de claude.ai, une case à cocher « Ne plus
  afficher », un bouton « Compris ». Le modal s'ouvre APRÈS que le réglage est
  sauvé (le canal est choisi, le modal informe).
- Les couleurs viennent de la capture d'Ahmed (`Pasted image
  20260918225705.png`), mesurées au pixel à l'implémentation
  (`senior-dev:reference-fidelity`) : fond, bordure, texte, icône. Elles sont
  posées en variables `--qbd-web-warn-bg`, `--qbd-web-warn-border`,
  `--qbd-web-warn-text` dans `dashboard-ai.css`, réservées à ce callout — ce
  n'est pas le rouge du thème, c'est celui de claude.ai, et c'est voulu (le
  callout doit être RECONNU là-bas).
- Nouveau réglage `aiWebAvertissementMasque: string[]` (les identifiants de
  canaux pour lesquels la case a été cochée). Un tableau et non un booléen :
  chatgpt.com et perplexity.ai auront peut-être le leur.
- Chaînes nouvelles : `ai.web.warnTitle`, `ai.web.warnDismiss` (« Ne plus
  afficher »), `ai.web.warnOk` (« Compris »).

## 6. Textes

- FR : « Le Codex CLI n'est pas installé » → « Codex CLI n'est pas
  installé » (titre du modal, hint, statut `ai.status.codexMissing` déjà
  sans article). Le bouton « Installer Codex CLI » ne change pas.
- EN : « The Codex CLI is not installed » → « Codex CLI is not installed »,
  même raison.
- `app.installCli.done` / `app.connectCli.done` : « Retour dans Neo Quiz… »
  à la place de « Vous pouvez fermer cette fenêtre… » (§2.2).

## 7. Ce que ce chantier ne fait pas

- Pas d'installation cachée, pas de connexion sans fenêtre pour Claude et
  Codex : `claude auth login` et `codex login` ont besoin d'un terminal pour
  montrer l'URL si le navigateur ne s'ouvre pas.
- Pas de sonde de prix en arrière-plan, pas de liste starter embarquée
  (§1.4).
- Pas de verrou sur un modèle Pro : le badge informe, le 402 tranche.
- chatgpt.com et perplexity.ai restent différés (T9 de la tranche
  précédente) ; le modal d'avertissement est prêt pour eux mais n'est posé
  que sur claude.ai.
- Le greffon Obsidian n'est pas touché.

## 8. Contrôles

- `npm run check:electron-process` : §2.3.
- `npm run check:ai-providers` : `/api/me` 200 avec plan, 401 avec
  `signin_url`, 401 sans URL, 200 sans JSON ; le catalogue JSON et le rejet du
  HTML ; `planRequisPour` et `modeleHorsPlan` sur les trois sources ; le 402.
- `npm run check`, `npm run check:app`, `npm run check:theme` (les trois
  variables du callout ont une valeur dans les deux thèmes).
- À l'écran, par Ahmed, dans la VM : le terminal qui se ferme seul après
  `claude auth login` ; l'échec qui laisse la fenêtre ouverte avec le message
  rouge ; le hint « pas connecté » au choix d'un fournisseur ; Ollama qui se
  connecte par le navigateur ; le badge Pro sur un compte gratuit après un
  402 ; le modal claude.ai et sa case.

## 9. Journal

- 2026-09-19 : neuf points du callout `[!bug]` repris ; enquête (`/api/me`,
  402, catalogue mort) ; deux décisions d'Ahmed (terminal visible qui se
  ferme seul ; `required_plan` + 402 appris) ; design validé en discussion.
- 2026-09-19 : plan exécuté, T1 d684d26 · T2 29ef690 + 96fbdde · T3 bbfaffd · T4 bd4e770 · T5 583df96 · T6 dc7397f · T7 (ce commit). Revues par sous-agent sur T1-T3, puis enchaînement sans revue à la demande d'Ahmed ; épreuve à l'écran dans la VM à venir.
