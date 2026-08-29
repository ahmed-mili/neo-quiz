# Archive — fournisseur Kimi Code

**Retiré le 2026-08-29**, sur demande d'Ahmed, avec la consigne explicite de
pouvoir le remettre.

## Où est le code

L'archive, c'est **le commit de retrait lui-même** : `ac7e63a`
(`feat(ia): retrait du fournisseur Kimi Code`). Rien n'a été recopié ailleurs —
une copie dans un dossier `archive/` se serait mise à diverger du reste du
plugin au premier refactor, et aurait menti au moment de la restauration.

```sh
git show ac7e63a              # tout ce qui a été retiré, fichier par fichier
git show ac7e63a^:src/dashboard/ai-providers.ts   # un fichier dans son état d'avant
```

## Pour le remettre

```sh
git revert --no-commit ac7e63a
```

Le revert **ne suffira pas tel quel** : trois choses ont bougé autour, et il
faut les rejouer à la main après avoir résolu les conflits.

1. **La branche « aucun modèle disponible »** des réglages (`plugin.ts`) a été
   retirée et son bloc désindenté, parce que Kimi était le seul fournisseur dont
   la liste de modèles pouvait être vide (les autres retombent toujours sur un
   repli embarqué). Le revert la réintroduit ; vérifier l'indentation.
2. **`ai.status.loginRequired`** (EN + FR) n'avait plus d'appelant après le
   retrait. La clé revient avec le revert.
3. **La migration de réglages** ajoutée dans `loadSettings` remet à vide un
   `aiProvider` valant `"kimi-code"`. Elle doit être **supprimée** au moment de
   la restauration, sinon elle éjecte l'utilisateur du fournisseur qu'on vient
   de lui rendre.

Puis : `npm run check`, `npm run build`, et un essai réel dans Obsidian.

## Ce que faisait l'intégration

- CLI `kimi` (Kimi Code CLI, Moonshot AI), **aucune clé API** — la session du
  CLI connecté par `/login`, comme Claude Code et Codex.
- **Modèles 100 % dynamiques** : `kimi provider list --json` publie les alias du
  compte (ex. `kimi-code/kimi-for-coding`, avec le `/`). Tant que le compte
  n'était pas connecté, la liste restait vide — d'où un état d'UI « Connexion
  requise » propre à ce fournisseur.
- **Deux différences assumées** avec les autres CLI, vérifiées sur le CLI 0.26.0 :
  `-p, --prompt` exige un ARGUMENT (le CLI ne lit pas stdin), d'où `execFile` +
  bascule sur un fichier au-delà de 20 000 caractères (la ligne de commande
  Windows plafonne à 32 767) ; et `--output-format stream-json` ne publie **aucun
  compteur de tokens**, donc l'écran d'usage annonçait que ce fournisseur n'en
  fournit pas plutôt que d'estimer.
- **Aucun niveau d'effort** : le CLI en expose par modèle et a un `/effort` dans
  son TUI, mais `kimi -p` n'a aucun flag pour les passer. Un sélecteur d'effort
  aurait été un mensonge d'UI.
- Chemins d'installation ajoutés au PATH des process enfants :
  `<KIMI_INSTALL_DIR>/bin`, défaut `~/.kimi-code` (même piège que Codex : les
  installateurs modifient le PATH du registre / du rc, qu'un Obsidian déjà lancé
  ne voit jamais).

## Ce qui sera à re-vérifier avant de le remettre

Ces faits datent de 2026-07-16 et **ne sont pas maintenus** tant que le
fournisseur est retiré :

- les URL d'installation (`code.kimi.com/kimi-code/install.{ps1,sh}`) ;
- la page d'abonnement (`kimi.com/membership/pricing`) et la doc
  (`moonshotai.github.io/kimi-code/`) ;
- la forme de `kimi provider list --json` ;
- le format de `kimi --version` (« 0.26.0 » nu à l'époque) ;
- si `kimi -p` accepte enfin stdin et/ou un flag d'effort — les deux
  contournements ci-dessus disparaîtraient.
