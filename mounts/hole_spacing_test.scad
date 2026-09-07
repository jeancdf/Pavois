// ============================================================================
// Pavois — Eprouvette rapide de TEST D'ESPACEMENT des trous de fixation
// camera (CAM-OV5647). But : verifier l'entraxe REEL des 4 trous avant de
// refaire tourner le support complet (le modele principal suppose 33mm,
// jamais confirme -> probablement la cause du mauvais alignement constate).
//
// Forme : cadre carre au format exact de la carte (39x39), MILIEU EVIDE
// pour imprimer vite. Pose la vraie carte dessus (ou une vis dans un trou
// + carte par-dessus) pour voir quel entraxe s'aligne.
//
// 2 iterations imprimees COLLEES (un seul plateau, une seule impression) :
// entraxe actuel 33mm +1mm et +2mm -> 34 et 35mm. Change test_spacings[]
// si tu veux tester d'autres valeurs (ex: [32, 34] si tu soupconnes plus
// serre, ou ajoute une 3e valeur, ca s'aligne tout seul).
// ============================================================================

board_size    = 39;     // doit matcher le contour reel de la carte
frame_wall    = 5;      // largeur du cadre restant (le centre est evide)
frame_t       = 3;      // epaisseur -> impression rapide
hole_d        = 2.4;    // passage large (vis ou goupille M2 de test)

test_spacings = [34, 35];   // entraxes a tester en mm (33 = hypothese actuelle du support)

label_h    = 0.6;
label_size = 6;

$fn = 32;

module frame(spacing) {
    union() {
        difference() {
            cube([board_size, board_size, frame_t]);
            translate([frame_wall, frame_wall, -0.5])
                cube([board_size - 2*frame_wall, board_size - 2*frame_wall, frame_t + 1]);
            for (sx = [-1, 1], sy = [-1, 1])
                translate([board_size/2 + sx*spacing/2, board_size/2 + sy*spacing/2, -0.5])
                    cylinder(d = hole_d, h = frame_t + 1);
        }
        // numero grave en relief sur le bord bas, pour ne pas confondre les 2 pieces
        translate([board_size/2, frame_wall/2, frame_t])
            linear_extrude(label_h)
                text(str(spacing), size = label_size, halign = "center", valign = "center");
    }
}

// eprouvettes collees bord a bord (touch) -> une seule impression, pas de trajet a vide
for (i = [0 : len(test_spacings) - 1])
    translate([i * board_size, 0, 0])
        frame(test_spacings[i]);
