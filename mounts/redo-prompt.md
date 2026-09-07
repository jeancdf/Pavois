Je travaille sur Pavois, un projet de détection de drone par triangulation optique multi-caméras (2+ caméras qui voient le même objet en mouvement, les rayons se croisent dans une grille de voxels 3D pour localiser le drone). Le dossier du projet est `Documents/Side-Project/Pavois`.

Je dois concevoir et imprimer en 3D un support pour une caméra InnoMaker CAM-OV5647 (https://github.com/INNO-MAKER/CAM-OV5647), 2 exemplaires identiques pour commencer (Phase 1 du projet : test optique à 2 caméras).

**Pourquoi la précision mécanique compte ici** : le logiciel calcule la position 3D du drone à partir de la position et de l'orientation (yaw/pitch/roll) connues de chaque caméra. Si le support a du jeu, la caméra bouge légèrement dans le temps ou entre deux montages, et toute l'orientation mesurée devient fausse — ça casse le calcul de triangulation. Le support doit donc tenir la caméra de façon **rigide et répétable**, pas juste "à peu près en place".

**Specs physiques de la carte caméra** (depuis la doc InnoMaker) :
- Carte carrée 39×39 mm (hors nappe FPC)
- 4 trous de fixation, diamètre 2,20 mm
- Espacement des trous : ~33 mm (trous à 3 mm des bords) — **cette partie est correcte, à garder telle quelle**
- Support d'objectif M12, "Lens Seat Spacing" = 22 mm (probablement le diamètre du support d'objectif cylindrique qui dépasse de la carte)
- Objectif 2,8 mm f/2.2, grand-angle ~72° horizontal, forte distorsion barillet (< -17%)

**Ce qui a déjà été tenté et rejeté** : un premier essai en OpenSCAD proposait une plaque avec équerre de calage sur 2 bords de la carte, une collerette autour du support d'objectif, des trous prévus pour inserts laiton chauffants, et une base filetage trépied 1/4"-20. Ce design ne convient pas (à l'exception du placement des trous de fixation, qui reste bon). Ne pars pas de cette géométrie — reconsidère l'approche à partir de zéro pour la partie fixation/rigidité/orientation, en gardant l'objectif de zéro jeu mécanique.

**Contraintes/préférences connues** :
- Modélisation en OpenSCAD (paramétrique, code), pas un outil de dessin à la souris
- J'ai un imprimante 3D FDM (marque/modèle non précisé — à demander si utile), donc prévoir que les trous imprimés ne sont jamais exacts (le plastique bave dans le trou) — le design final devra inclure ou recommander un test de tolérance avant impression finale
- Support pour 2 caméras identiques, orientées de façon connue et mesurable (le projet utilise une convention yaw=0/pitch=90 pour une caméra qui regarde à l'horizontale)
- Usage prévu pour l'instant : test de banc, sur trépied ou support fixe, pas de contrainte de discrétion/étanchéité

Aide-moi à repartir de zéro sur ce support, en clarifiant d'abord avec moi ce qui n'allait pas dans la version précédente et ce que je veux vraiment comme méthode de fixation, avant de regénérer du code OpenSCAD.
