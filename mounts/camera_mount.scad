// Support caméra InnoMaker CAM-OV5647 pour Pavois
// A VERIFIER AVANT IMPRESSION : l'espacement des trous (board_hole_spacing) est une
// hypothese (33mm, format standard des cartes 39x39 M12) -- pas confirme par la doc
// InnoMaker. Mesurer au pied a coulisse sur la vraie carte avant impression finale.

// ===== Carte camera (mesures / doc InnoMaker) =====
board_size          = 39;    // carte carree 39x39mm (hors nappe FPC)
board_thickness     = 1.2;   // epaisseur PCB typique, a verifier
board_hole_d        = 2.2;   // diametre trou carte (doc: "4x D=2.20mm")
board_hole_inset    = 3;     // hypothese: trous a 3mm des bords -> espacement 33mm
board_hole_spacing  = board_size - 2*board_hole_inset;  // = 33mm si inset=3

lens_seat_d         = 22;    // doc: "Lens Seat Spacing: 22mm" -- diametre du support M12
lens_barrel_h        = 8;    // hauteur du support d'objectif au-dessus du PCB, a verifier

// ===== Reglages d'impression (a calibrer avec une eprouvette de tolerance) =====
print_tolerance     = 0.15;  // jeu a retirer/ajouter selon test d'impression reel
use_heatset_insert  = true;  // true = trou pour insert laiton M2.5, false = vis directe
insert_hole_d       = 3.9;   // diametre trou pour insert M2.5 standard (a verifier selon insert)
screw_clear_d       = 2.7;   // diametre passage vis M2.5 si pas d'insert

// ===== Plaque support =====
plate_margin        = 4;     // marge autour de la carte
plate_size          = board_size + 2*plate_margin;
plate_thickness     = 4;

lip_height          = 1.2;   // hauteur du rebord de calage (equerre)
lip_width           = 1.5;

tripod_hole_d       = 6.35;  // filetage 1/4"-20 standard trepied -- prevoir insert dedie
tripod_boss_d       = 14;
tripod_boss_h       = 6;

module base_plate() {
    difference() {
        cube([plate_size, plate_size, plate_thickness]);

        // Degagement pour la nappe FPC (bord "avant" de la carte)
        translate([plate_margin - 1, -0.1, plate_thickness - 2])
            cube([board_size + 2, plate_margin + 1, 2.1]);
    }
}

module locating_lip() {
    // Equerre de reference: cale la carte sur 2 bords perpendiculaires
    // (bord gauche + bord bas de la zone carte), independamment du jeu des trous
    translate([plate_margin, plate_margin, plate_thickness])
        cube([lip_width, board_size, lip_height]);
    translate([plate_margin, plate_margin, plate_thickness])
        cube([board_size, lip_width, lip_height]);
}

module mount_holes() {
    d = use_heatset_insert ? insert_hole_d : screw_clear_d;
    positions = [
        [plate_margin + board_hole_inset, plate_margin + board_hole_inset],
        [plate_margin + board_hole_inset + board_hole_spacing, plate_margin + board_hole_inset],
        [plate_margin + board_hole_inset, plate_margin + board_hole_inset + board_hole_spacing],
        [plate_margin + board_hole_inset + board_hole_spacing, plate_margin + board_hole_inset + board_hole_spacing],
    ];
    for (p = positions)
        translate([p[0], p[1], -0.1])
            cylinder(d = d + print_tolerance, h = plate_thickness + 0.2, $fn = 32);
}

module lens_collar() {
    // Collerette qui enserre le support d'objectif M12 -- c'est elle qui tient
    // l'axe optique droit, pas les trous de la carte.
    cx = plate_size / 2;
    cy = plate_size / 2;
    translate([cx, cy, plate_thickness])
        difference() {
            cylinder(d = lens_seat_d + 6, h = lens_barrel_h, $fn = 64);
            translate([0, 0, -0.1])
                cylinder(d = lens_seat_d + print_tolerance, h = lens_barrel_h + 0.2, $fn = 64);
        }
}

module tripod_boss() {
    // Filetage 1/4"-20 standard trepied sous la plaque
    translate([plate_size / 2, plate_size / 2, -tripod_boss_h])
        difference() {
            cylinder(d = tripod_boss_d, h = tripod_boss_h, $fn = 48);
            translate([0, 0, -0.1])
                cylinder(d = tripod_hole_d, h = tripod_boss_h + 0.2, $fn = 32);
        }
}

difference() {
    union() {
        base_plate();
        locating_lip();
        lens_collar();
        tripod_boss();
    }
    mount_holes();
}

// Notes d'impression :
// - Imprimer avec l'axe des trous VERTICAL (perpendiculaire au plateau) : les trous
//   sortent ronds et precis dans cette orientation, ovales/imprecis a plat.
// - PETG recommande (moins de fluage/retrait que PLA si le rig reste dehors au soleil).
// - Avant impression finale : imprimer une petite eprouvette avec plusieurs diametres
//   de trous (2.0 / 2.1 / 2.2 / 2.3 / 2.4mm) et tester l'insert/la vis pour trouver
//   le print_tolerance reel de cette imprimante, puis ajuster la variable ci-dessus.
// - Imprimer 2 exemplaires identiques (Cam0 + Cam1) pour le premier test Phase 1.
