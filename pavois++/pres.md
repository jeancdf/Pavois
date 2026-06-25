# Présentation orale

Je vais vous présenter l’architecture du système, les formules mathématiques principales, et le rôle du code C++ dans le projet.

L’objectif du système est de partir d’images captées par une caméra, puis de détecter un objet aérien comme un avion ou un drone, et enfin d’envoyer cette information vers une interface web. L’idée générale est de transformer une image en information utile pour l’opérateur.

L’architecture est découpée en plusieurs étapes. D’abord, il y a la capture vidéo. Le programme C++ lit directement la caméra et récupère les images une par une. Ensuite, on convertit ces images en niveaux de gris, parce que pour détecter un mouvement, la luminosité est plus importante que la couleur. Puis on compare chaque image avec la précédente. Si un pixel change beaucoup, on considère qu’il y a un mouvement à cet endroit.

Après ça, on regroupe les pixels modifiés en zones, qu’on appelle des blobs. Le centre de ce blob devient la position approximative de l’objet dans l’image. À partir de là, on applique la géométrie de la caméra. Chaque pixel ne donne pas une distance, mais une direction. Donc on transforme cette position image en un rayon dans l’espace. Avec plusieurs caméras, on peut croiser plusieurs rayons pour estimer une position 3D de la cible.

La formule de base pour la détection de mouvement est très simple : on prend la différence absolue entre deux images, pixel par pixel. Si la différence est plus grande qu’un seuil, alors le pixel est marqué comme mobile. C’est cette opération qui permet de repérer un changement dans l’image.

Ensuite, pour la partie géométrique, on utilise le champ de vision et les paramètres de la caméra pour convertir un pixel en direction. Avec les angles de la caméra, qu’on appelle yaw, pitch et roll, on tourne cette direction dans le repère du monde réel. Le système utilise ensuite un repère commun, souvent ENU, c’est-à-dire Est, Nord, Haut, pour que toutes les caméras parlent le même langage.

Si on a une seule caméra, on obtient surtout une direction. Si on a deux caméras ou plus, on peut faire de la triangulation. L’idée est simple : chaque caméra voit la cible sous un angle différent, et on cherche le point où les rayons se rapprochent le plus. C’est ce qui permet d’estimer une vraie position 3D.

Le code C++ sert à faire tout ce travail rapidement et de manière propre. Il gère la caméra, la lecture des images, la détection de mouvement, puis l’envoi des résultats vers l’interface web. L’interface, elle, ne fait pas les calculs lourds. Elle sert à afficher les caméras, les détections, les pistes et les informations associées à l’objet observé.

En résumé, le système transforme une image en détection, une détection en rayon, et plusieurs rayons en position 3D. Le C++ sert au traitement rapide, les mathématiques servent à la conversion spatiale, et l’interface web sert à visualiser le résultat.
