# Tranche 6 — les épreuves à l'écran

À cocher par Ahmed. Rien ici ne se vérifie par un script : c'est de
l'installation, du clic, du moment. Chaque ligne dit ce qu'on regarde et ce
qui compte comme échec.

## Avant de commencer (une fois)

- [ ] Activer Windows Sandbox, en administrateur, puis redémarrer :
      `Enable-WindowsOptionalFeature -Online -FeatureName Containers-DisposableClientVM`
- [ ] `npm --prefix apps/windows run pack:win` : `apps/windows/dist-installer/`
      contient `neo-quiz-setup-2.5.0-beta.exe`
- [ ] Pour l'épreuve de mise à jour, un SECOND installeur d'une version
      supérieure : `node scripts/set-version.mjs 2.5.1-beta`, `pack:win`,
      puis `git checkout src/assets/manifest.json` (le bump n'est PAS commité).
      Les deux `.exe` cohabitent dans `dist-installer/`.

## A. L'installation

- [ ] Double-clic sur `apps/windows/sandbox/neo-quiz.wsb` : le bac à sable
      s'ouvre avec `installeur` et `vault` sur son bureau.
- [ ] Lancer `neo-quiz-setup-2.5.0-beta.exe`. SmartScreen s'affiche
      (« Windows a protégé votre ordinateur ») : « Informations
      complémentaires », « Exécuter quand même ». C'est attendu, non signé
      (spec §2.1). ÉCHEC si l'installeur ne démarre pas du tout après ça.
- [ ] L'assistant propose un dossier ; en changer (par exemple
      `C:\NeoQuizTest`). L'installation se termine, un raccourci « Neo Quiz »
      est sur le bureau et dans le menu Démarrer.

## B. Le premier lancement, sans rien

- [ ] Lancer Neo Quiz. La fenêtre s'ouvre sur l'écran « aucun dossier », la
      liste des vaults Obsidian est ABSENTE (pas d'Obsidian dans le bac à
      sable). ÉCHEC : écran blanc, erreur au démarrage.
- [ ] Réglages, en bas : « Neo Quiz 2.5.0-beta ». Le lien ouvre le dépôt
      dans Edge, pas dans la fenêtre.
- [ ] Page « Générer » : les trois fournisseurs sont détectés ABSENTS
      (Claude et Codex « non installé » avec leur commande d'installation
      pour Windows, Ollama « hors ligne »). Aucune Notice d'erreur qui
      revient en boucle.

## C. Un dossier, une révision

- [ ] Réglages, « Ajouter un dossier », choisir `Desktop\vault`. Accueil : les
      deux quiz (Cybersécurité, Réseaux) apparaissent.
- [ ] Ouvrir Réseaux, « Start », répondre aux deux questions (le LaTeX
      $2^{10}$ est rendu). Retour : la carte « À réviser » a bougé.
- [ ] Sur le poste, `apps/windows/sandbox/vault/.neo-quiz/review-log.jsonl`
      existe et contient les lignes de cette révision.

## D. Une génération Ollama (une des deux voies)

- [ ] Voie 1 : installer Ollama DANS le bac à sable (ollama.com/download,
      réseau actif), `ollama pull` d'un petit modèle. Voie 2 : sur le poste,
      Ollama lancé avec `OLLAMA_HOST=0.0.0.0`, et dans le bac à sable
      Réglages, `aiOllamaUrl` = `http://<IP LAN du poste>:11434` — une
      adresse RFC 1918 est admise SANS confirmation native (garde de la clé
      `ai`) ; ÉCHEC si une confirmation s'affiche.
- [ ] Générer, fournisseur Ollama, demande courte avec `@Réseaux.md`. Le
      quiz s'enregistre dans `vault/Generated/` et sa page s'ouvre sur
      « Lancer ».

## E. La mise à jour par-dessus

- [ ] Fermer Neo Quiz. Relancer `neo-quiz-setup-2.5.0-beta.exe` (LA MÊME
      version) par-dessus : l'assistant réinstalle sans erreur. Relancer :
      le dossier `vault` est toujours ouvert, « À propos » inchangé.
- [ ] Fermer. Lancer `neo-quiz-setup-2.5.1-beta.exe`. Relancer : « Neo Quiz
      2.5.1-beta », le dossier `vault` est toujours ouvert, la date d'examen
      ou l'URL Ollama saisie plus haut est toujours là. Un SEUL raccourci
      sur le bureau, une SEULE entrée « Neo Quiz » dans Paramètres,
      Applications. ÉCHEC : deux entrées, réglages perdus.

## F. La désinstallation

- [ ] Paramètres, Applications, Neo Quiz, Désinstaller. Le dossier
      d'installation est vide ; `vault/` et `vault/.neo-quiz/` sont intacts
      sur le poste.

## G. L'AppImage, sous WSL

- [ ] Une fois : `wsl --install` (Ubuntu), redémarrer.
- [ ] Télécharger l'artefact `neo-quiz-linux-appimage` du dernier run CI
      (`gh run download --name neo-quiz-linux-appimage`), le copier dans
      WSL (`/home/<user>/`), `chmod +x neo-quiz-2.5.0-beta.AppImage`.
- [ ] `./neo-quiz-2.5.0-beta.AppImage`. Sans FUSE, relancer avec
      `--appimage-extract-and-run`. Si Chromium refuse son bac à sable SUID
      (AppArmor d'Ubuntu 24.04), ajouter `--no-sandbox`. La fenêtre s'ouvre
      (WSLg). Ouvrir un dossier (`/mnt/c/dev/neo-quiz/apps/windows/sandbox/vault`) :
      les deux quiz apparaissent.
