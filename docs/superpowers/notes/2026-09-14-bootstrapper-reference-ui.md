# Bootstrapper Windows — reprise visuelle de la référence

Cette branche remplace uniquement la présentation visible du bootstrapper.

- le chemin d'installation reste déterminé par le processus principal ; aucun bouton de modification n'est rendu ;
- la fenêtre reprend le rapport, les marges, la barre de titre, le fond, le panneau d'emplacement, le texte légal et le bouton principal de la référence fournie ;
- le bouton de réduction est réellement relié à `BrowserWindow.minimize()` ;
- « Envoyer des commentaires » ouvre la page GitHub de création d'issue déjà utilisée par la documentation ;
- la capacité totale et l'espace libre sont lus sur le volume cible avec `statfs` ;
- la troisième valeur affichée est volontairement la taille du téléchargement, pas une taille installée inventée : le dépôt ne publie aujourd'hui aucune mesure fiable de l'empreinte finale sur disque.

Ce qui se perd par rapport à l'ancien rendu visible : le choix manuel du dossier n'est plus proposé dans l'interface. Le canal historique reste présent dans le processus principal afin de ne pas mélanger ce changement visuel à la logique d'installation sensible.
