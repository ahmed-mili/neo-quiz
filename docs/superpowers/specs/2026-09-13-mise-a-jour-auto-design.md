# Mise à jour automatique de l'application

**Date** : 2026-09-13
**Statut** : spec validée par Ahmed (« je valide si… le téléchargement se fait
tout seul, j'ai juste à cliquer, l'app se relance »), à suivre d'un plan
**Point de départ** : `main` = `0c63d87`, release stable `v2.5.0` publiée
avec `neo-quiz-setup-2.5.0.exe` et `neo-quiz-2.5.0.AppImage`.

## 1. La promesse

Exactement le comportement de Neo Calendar, dans l'application Neo Quiz :

1. L'application **vérifie seule** s'il existe une version plus récente : au
   lancement, au retour du focus sur la fenêtre, et toutes les quatre heures.
2. S'il y en a une, elle la **télécharge seule**, en arrière-plan, sans rien
   demander (téléchargement différentiel par les `.blockmap` sous Windows ;
   une AppImage n'a pas de `.blockmap`, Linux retélécharge le fichier entier).
3. Quand c'est prêt, un bouton apparaît dans le rail : « Redémarrer pour
   mettre à jour ». **Un clic.**
4. L'application se ferme, l'installeur tourne **en silence**, et
   l'application **se relance d'elle-même** sur la nouvelle version. Réglages
   et dossiers intacts (spec de la tranche 6, §2.4).
5. Sans clic, l'installation se fait à la prochaine fermeture de l'application.

Un réglage « Mises à jour automatiques » (activé par défaut) coupe tout :
ni vérification, ni téléchargement.

## 2. Les décisions

### 2.1 `electron-updater` sur GitHub Releases, et pourquoi

- C'est le pendant Electron du `latest.json` de Tauri : electron-builder, déjà
  utilisé, produit `latest.yml` (Windows) et `latest-linux.yml` (AppImage)
  avec la version et le sha512 de chaque paquet ; `release.yml` les attache à
  la release. Le client (`electron-updater`, même auteur) lit la dernière
  release du dépôt, compare, télécharge, vérifie le sha512, installe. Cibles
  NSIS et AppImage, les deux nôtres. Aucun serveur, aucun compte, gratuit.
- Écartés : `update.electronjs.org` (Squirrel.Windows obligatoire, pas NSIS) ;
  un vérificateur maison (la même chose en moins bien) ; Keygen et consorts
  (abonnements sans raison). Aucun achat unique n'existe pour ce besoin.
- **Sécurité, dite honnêtement** : intégrité par sha512 + HTTPS + le compte
  GitHub d'Ahmed (2FA). La vérification Authenticode d'electron-updater ne
  s'active que si l'application est signée (`win.publisherName`) ; le jour où
  SignPath signe, une ligne l'ajoute. La spec de la tranche 6 (§2.5) disait
  « exige une signature pour être sûr » : c'est la nuance ci-dessus, pas une
  interdiction.

### 2.2 Ce qui ne change pas

- `src/assets/manifest.json` reste la seule source de version : electron-updater
  compare `app.getVersion()` (le `package.json` du paquet, réécrit par
  `extraMetadata.version` depuis le manifeste) à `latest.yml`.
- `softprops/action-gh-release` reste le SEUL publieur. electron-builder,
  sous un tag et avec `GH_TOKEN`, publierait lui-même par défaut (politique
  `onTagOrDraft`) et créerait une release brouillon à côté : les scripts
  `pack:win` / `pack:linux` passent `--publish never` explicitement.
- Le rendu ne tire toujours pas Node : tout `electron-updater` vit dans le
  processus principal ; le rendu ne voit qu'un état poussé par le pont.

### 2.3 Chaque release stable est poussée à tout le monde

Conséquence à garder en tête : un tag `v*` sans suffixe atteint désormais
chaque installation dans les quatre heures. On ne tague plus « pour voir » ;
le mode répétition de `release.yml` existe pour ça. Une pré-version
(`-beta`) n'est PAS proposée aux installations stables (electron-updater
ignore les pré-versions par défaut, `allowPrerelease: false`).

### 2.4 L'épreuve exige deux releases

electron-updater ne se teste pas à vide : il lit la dernière release du
dépôt. L'épreuve à l'écran est donc : installer `v2.5.1` (première version
qui porte le mécanisme), puis publier `v2.5.2` (bump seul), voir le bouton
apparaître, cliquer, revenir en 2.5.2 avec les réglages. Deux tags, décidé
plutôt qu'un serveur local de test à maintenir.

## 3. Ce qui est construit

### 3.1 L'empaquetage et la publication

- `electron-builder.config.mjs` : `publish: { provider: "github", owner:
  "ahmed-mili", repo: "neo-quiz" }`. C'est cette clé qui fait générer
  `latest*.yml` dans `dist-installer/` et embarquer `resources/app-update.yml`
  dans le paquet.
- `apps/windows/package.json` : `pack:win` et `pack:linux` avec `--publish never`.
- `apps/windows/package.json` : dépendance `electron-updater` (version
  compatible avec electron-builder 26, lue de `npm view`, jamais devinée),
  bundlée par esbuild dans `main.cjs` comme `chokidar` (le paquet exclut
  `node_modules`).
- `release.yml` : les jobs `app-windows` et `app-linux` attachent en plus
  `latest.yml` / `latest-linux.yml` et `*.blockmap` à la release.
- `check:package` gagne : `publish.provider === "github"` avec le bon dépôt ;
  après un `pack:win`, `dist-installer/latest.yml` existe et sa `version`
  est celle du manifeste ; `win-unpacked/resources/app-update.yml` existe.

### 3.2 Le processus principal : `apps/windows/electron/mise-a-jour.ts`

- Un **noyau pur** `mise-a-jour-etat.ts` : l'état est un objet
  `{ phase: "inactif" | "verification" | "a-jour" | "telechargement" |
  "prete" | "erreur", version?: string, pourcent?: number, message?: string }`
  et une fonction `transition(etat, evenement)` qui applique les événements
  d'electron-updater (`checking-for-update`, `update-available`,
  `update-not-available`, `download-progress`, `update-downloaded`, `error`).
  Éprouvé par `npm run check:updater` sans Electron.
- Le câblage : `autoDownload = true`, `autoInstallOnAppQuit = true`,
  `allowPrerelease = false`, `logger` = la console du principal avec
  `LOG_PREFIX`. Vérification à `app.whenReady` (après la fenêtre, jamais
  avant), sur `browser-window-focus` avec un garde de 15 minutes, et par
  `setInterval` de 4 heures. Chaque changement d'état est POUSSÉ au rendu
  par `deps.envoyer(CANAUX.miseAJourEtat, etat)`, le même chemin que les
  événements disque. Une erreur (hors ligne, GitHub injoignable) vaut phase
  `erreur` avec message, journalisée, jamais une Notice : hors ligne est un
  état normal.
- `installer()` : `autoUpdater.quitAndInstall(true, true)` (silencieux, relance
  forcée). AVANT, le principal attend l'écriture différée du rendu par le même
  rappel que la fermeture de la fenêtre (`fenetre.surFermeture`) : une frappe
  en attente ne se perd pas dans une mise à jour.
- Le réglage : clé `updates` des réglages, `{ auto: boolean }`, défaut `true`,
  lue au démarrage ; `false` coupe vérification et minuteur ; un changement
  depuis la page Réglages est relayé par un canal `miseAJourReglage`.
- Pas de `dev-app-update.yml` : en développement (`app.isPackaged === false`)
  le module ne fait rien et le journalise une fois.

### 3.3 Le pont

`pont.ts` gagne un espace `miseAJour` :

```ts
miseAJour: {
	etat(): Promise<EtatMiseAJour>;
	surEtat(rappel: (etat: EtatMiseAJour) => void): () => void;
	verifier(): Promise<void>;
	installer(): Promise<void>;
	reglerAuto(auto: boolean): Promise<void>;
};
```

Canaux : `miseAJourEtatLire`, `miseAJourEtat` (poussé), `miseAJourVerifier`,
`miseAJourInstaller`, `miseAJourReglage`. Le préchargement suit le patron de
`surveiller` (abonnement par `ipcRenderer.on`, désabonnement rendu). Aucun
argument venu du rendu n'est un chemin ni une URL : le flux est fixé par
`app-update.yml`, embarqué au paquet. Le faux `window.neo` de
`scripts/check-windows-host.mjs` reçoit l'espace (inerte) pour que le
contrôle continue de charger les modules du rendu.

### 3.4 Le rendu

- `apps/windows/src/ui/mise-a-jour.ts` : s'abonne à `surEtat`, tient l'état
  courant, et expose `monterBoutonRail(navEl)` et `monterEtatApropos(section)`.
- Rail : dans `qbd-nav-footer`, au-dessus de « Réglages », un bouton
  `nq-maj-bouton` qui n'existe que lorsque `phase === "prete"` : icône
  `refresh-cw`, libellé `t("app.update.restart")` (« Redémarrer pour mettre
  à jour »). Clic : `pont().miseAJour.installer()`. Pendant `telechargement`,
  rien dans le rail : Neo Calendar affiche un badge, ici on attend d'avoir
  quelque chose à cliquer.
- Réglages, section « À propos » (tranche 6) : sous la version, une ligne
  d'état traduite (`a-jour` : « Vous avez la dernière version » ; `verification`,
  `telechargement` avec le pourcentage, `prete` avec le bouton, `erreur` avec
  « Impossible de vérifier ») et un bouton « Vérifier maintenant »
  (`verifier()`), et l'interrupteur « Mises à jour automatiques » : il vit
  dans « À propos » parce que c'est là que la version vit, pas dans
  « Outils IA ».
- Clés i18n EN/FR sous `app.update.*`, dans le dictionnaire qui porte déjà
  les `app.empty.*` (le plan nomme le fichier).

### 3.5 Les épreuves (Ahmed)

Dans `docs/superpowers/notes/2026-09-13-mise-a-jour-epreuves-ecran.md` :
installer `neo-quiz-setup-2.5.1.exe` sur le poste (ou dans le bac à sable) ;
« À propos » dit « Neo Quiz 2.5.1 », « Vous avez la dernière version » ;
Claude publie `v2.5.2` ; dans les minutes qui suivent (ou après « Vérifier
maintenant »), la ligne passe en téléchargement puis « prête », le bouton
apparaît dans le rail ; clic ; l'application se ferme et se relance seule ;
« Neo Quiz 2.5.2 », dossiers et réglages intacts ; couper le réglage, relancer,
aucune vérification dans le journal.

## 4. Contraintes reprises

Aucune chaîne visible en dur ; commentaires en français avec le pourquoi ;
scripts de contrôle par `process.exitCode` et code de sortie ; le rendu
n'importe rien qui tire Node ; `check:host` reste à 6 ; `appId`,
`executableName` et `deleteAppDataOnUninstall` ne bougent pas.
