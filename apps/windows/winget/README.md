# Manifeste winget

Copie versionnée du manifeste soumis à [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs)
pour le paquet `AhmedMili.NeoQuiz`. Un sous-dossier par version de
l'APPLICATION (`1.0.0/`, puis `1.0.1/`…, cf. CLAUDE.md — l'app a sa propre
version, `apps/windows/package.json`, indépendante du greffon Obsidian),
chacun avec les trois fichiers du schéma 1.12.0 : le manifeste de version,
celui de l'installeur, celui de la locale par défaut (`en-US`).

## Pourquoi

`winget install AhmedMili.NeoQuiz` évite l'avertissement SmartScreen : un fichier
téléchargé par winget n'a pas de « Mark of the Web », contrairement à un exe
téléchargé au navigateur. C'est la seule raison d'être de ce dossier — le
téléchargement direct depuis les releases GitHub reste toujours possible.

## Valider un manifeste

```
winget validate --manifest apps/windows/winget/<version>
```

## Soumettre une nouvelle version

Installer `wingetcreate` une seule fois :

```
winget install wingetcreate
```

**Première soumission** (ce dossier n'en contient encore aucun — à générer
après la première release `desktop-v1.0.0`, `wingetcreate` déjà installé, le CLA
`microsoft/winget-pkgs` déjà signé) : `wingetcreate` fork
`microsoft/winget-pkgs`, pousse une branche et ouvre la pull request. Une PR =
une version.

```
wingetcreate submit --token <PAT GitHub, scope public_repo> apps/windows/winget/1.0.0
```

L'URL de l'installeur, pour cette première soumission comme pour les
suivantes, vise le tag `desktop-v`, pas `v` (celui du greffon Obsidian) :

```
https://github.com/ahmed-mili/neo-quiz/releases/download/desktop-vX.Y.Z/neo-quiz-setup-X.Y.Z.exe
```

**Versions suivantes** : `wingetcreate update` recalcule lui-même le SHA-256 à
partir de l'URL de la release, pas besoin de le calculer à la main.

```
wingetcreate update AhmedMili.NeoQuiz --version X.Y.Z --urls https://github.com/ahmed-mili/neo-quiz/releases/download/desktop-vX.Y.Z/neo-quiz-setup-X.Y.Z.exe --submit --token <PAT GitHub, scope public_repo>
```

Le PAT doit avoir le scope `public_repo` (voir la doc `wingetcreate` pour la
procédure de création).

Le pipeline de validation de `winget-pkgs` installe le paquet en bac à sable
avant fusion ; la PR est ensuite fusionnée par un bot, en général sous
quelques jours.

## Publisher

`AppsAndFeaturesEntries` du manifeste installeur (`*.installer.yaml`) doit
porter `Publisher: Ahmed Mili`, comme le manifeste de locale.
