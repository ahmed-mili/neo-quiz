# Mise à jour automatique — les épreuves à l'écran

À cocher par Ahmed. Le mécanisme ne se teste qu'INSTALLÉ, sur deux releases
publiées : `v2.5.1` porte la mise à jour automatique, `v2.5.2` est la version
qu'elle doit trouver. Les deux existent sur la page des releases.

## A. La version qui se met à jour

- [ ] Télécharger `neo-quiz-setup-2.5.1.exe` depuis la release **v2.5.1** (PAS
      la dernière), l'installer (SmartScreen : Informations complémentaires,
      Exécuter quand même), sur le poste ou dans le bac à sable de la
      tranche 6.
- [ ] Lancer. Réglages, « À propos » : « Neo Quiz 2.5.1 ». Dans la minute, la
      ligne d'état passe de « Recherche d'une mise à jour… » à
      « Téléchargement de 2.5.2 : N % » puis « La version 2.5.2 est prête à
      être installée ». (Sinon : « Vérifier maintenant ».)
- [ ] Le rail affiche, au-dessus de « Réglages », « Redémarrer pour mettre à
      jour ». ÉCHEC : rien dans le rail alors que « À propos » dit « prête ».
- [ ] Ouvrir un dossier (ou vérifier qu'il est ouvert), pour l'épreuve
      suivante.

## B. Un clic

- [ ] Cliquer « Redémarrer pour mettre à jour ». L'application se ferme,
      AUCUN assistant d'installation n'apparaît, et l'application se relance
      d'elle-même (quelques secondes). ÉCHEC : un assistant NSIS visible, ou
      l'application qui ne revient pas.
- [ ] « À propos » : « Neo Quiz 2.5.2 », puis « Vous avez la dernière
      version ». Le dossier est toujours ouvert, les réglages intacts, un seul
      raccourci, une seule entrée dans Applications.

## C. Le réglage

- [ ] Décocher « Mises à jour automatiques ». La ligne dit « Les mises à jour
      automatiques sont coupées ». Fermer, relancer : la ligne est toujours
      coupée, aucun téléchargement.
- [ ] Recocher : la vérification repart seule.

## D. Sans clic (facultatif)

- [ ] Réinstaller `v2.5.1`, attendre « prête », puis FERMER l'application par
      la croix sans cliquer le bouton. Relancer : « Neo Quiz 2.5.2 »
      (installation à la fermeture, sans relance automatique).
