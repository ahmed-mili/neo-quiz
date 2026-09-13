# Manifeste winget

Copie versionnée du manifeste soumis à [`microsoft/winget-pkgs`](https://github.com/microsoft/winget-pkgs)
pour le paquet `AhmedMili.NeoQuiz`. Un sous-dossier par version (`2.6.1/`, puis
`2.6.2/`…), chacun avec les trois fichiers du schéma 1.12.0 : le manifeste de
version, celui de l'installeur, celui de la locale par défaut (`en-US`).

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

**Première soumission** (ce dossier `2.6.1/`) : `wingetcreate` fork
`microsoft/winget-pkgs`, pousse une branche et ouvre la pull request. Une PR =
une version.

```
wingetcreate submit --token <PAT GitHub, scope public_repo> apps/windows/winget/2.6.1
```

**Versions suivantes** : `wingetcreate update` recalcule lui-même le SHA-256 à
partir de l'URL de la release, pas besoin de le calculer à la main.

```
wingetcreate update AhmedMili.NeoQuiz --version X.Y.Z --urls https://github.com/ahmed-mili/neo-quiz/releases/download/vX.Y.Z/neo-quiz-setup-X.Y.Z.exe --submit --token <PAT GitHub, scope public_repo>
```

Le PAT doit avoir le scope `public_repo` (voir la doc `wingetcreate` pour la
procédure de création).

Le pipeline de validation de `winget-pkgs` installe le paquet en bac à sable
avant fusion ; la PR est ensuite fusionnée par un bot, en général sous
quelques jours.

## Publisher, à partir de la version suivante

`2.6.1` n'écrit pas de `Publisher` dans le registre Windows (corrigé côté
installeur pour les versions suivantes). Dès que l'installeur l'écrit, ajouter
`Publisher: Ahmed Mili` dans `AppsAndFeaturesEntries` du manifeste installeur
(`*.installer.yaml`) — le champ `Publisher` du manifeste de locale, lui, est
déjà présent depuis `2.6.1`.
