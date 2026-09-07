// Pavois — Eprouvette RAPIDE : 4 trous camera (M2) + 4 trous Pi (M2.5) +
// 4 trous IMU BNO085 (M2.5), aux VRAIES positions relatives (entraxe camera
// 34mm confirme, pi_gap actuel), sur une plaque plate minimale (pas
// d'inclinaison, pas de nervure, pas de socle). Sert a valider en une fois le
// positionnement ET le montage reel des cartes ensemble (vis + inserts +
// entretoises), sans le volume/temps d'impression du support complet.
//
// Valeurs dupliquees depuis camera_mount_v2_pi25.scad (a garder synchro
// si ce fichier change) : entraxe camera, gap Pi, dimensions inserts.
//
// Impression : deja orientee comme le support final -> face optique (z=0)
// sur le plateau, bossages vers le haut, pas de support necessaire.

/* ===== Camera (M2), confirme 2026-07-27 ===== */
hole_spacing      = 34;
hole_xy           = hole_spacing / 2;
cam_insert_hole_d = 3.2;
cam_boss_d        = 7;
cam_boss_h        = 2;

/* ===== Pi 5 (M2.5), corrige 2026-07-28 (fiche fournisseur d3=4.0) ===== */
pi_insert_hole_d = 4.0;
pi_boss_d        = 9.5;
pi_boss_h        = 3;

pi_l          = 85;
pi_hole_dx    = 58;
pi_hole_dy    = 49;
pi_hole_inset = 3.5;
half_b        = 39/2;
pi_gap        = 48;      // TEST : +3cm au total par rapport aux fichiers de
                         // support (18mm) pour eprouver un ecart camera<->Pi
                         // plus grand ; l'IMU (en haut) ne bouge pas
pi_top_y      = -(half_b + pi_gap);
pi_hole_xs    = [pi_l/2 - pi_hole_inset, pi_l/2 - pi_hole_inset - pi_hole_dx];
pi_hole_ys    = [pi_top_y - pi_hole_inset, pi_top_y - pi_hole_inset - pi_hole_dy];

/* ===== IMU Adafruit BNO085 (M2.5), 4 trous, RECTANGLE 18.5 x 21 =====
   Motif 18.5mm (X) x 21mm (Y), memes valeurs que imu_bno085_holes_test.scad
   (a garder synchro), memes inserts M2.5 que le Pi. Place ENTRE la camera et
   le Pi (centre en X sur x=0, dans l'espace vertical camera<->Pi) -> son cadre
   sert de liaison entre les deux, plus besoin de bande separee. */
imu_dx  = 18.5;          // entraxe X corrige 19 -> 18.5 apres essai imprime
                         // (les 2 colonnes etaient 0.5mm trop ecartees)
imu_dy  = 21;            // entraxe Y : colonnes bien alignees, valeur validee
imu_hx  = imu_dx / 2;
imu_hy  = imu_dy / 2;
imu_insert_hole_d = 4.0;
imu_boss_d        = 9.5;
imu_boss_h        = 3;

frame_m          = 4;    // largeur du bord de matiere des cadres (partage module/IMU)
imu_side_overlap = 2;    // chevauchement cadre IMU <-> cadres camera/Pi pour coller
// cadre IMU centre en X, au milieu de l'espace vertical entre camera et Pi
cam_outer_bottom = -hole_xy - cam_boss_d/2 - frame_m;
pi_outer_top     = max(pi_hole_ys) + pi_boss_d/2 + frame_m;
imu_center_y = (cam_outer_bottom + pi_outer_top) / 2;
imu_cx      = 0;
imu_hole_xs = [imu_cx - imu_hx, imu_cx + imu_hx];
imu_hole_ys = [imu_center_y - imu_hy, imu_center_y + imu_hy];

plate_t = 4;
eps     = 0.1;
$fn     = 48;

// Chaque groupe de vis (camera / Pi / IMU) est un CADRE creux independant
// (juste un bord de matiere autour des bossages, centre evide). Le grand
// plateau plein a ete supprime pour economiser la matiere/temps d'impression :
// le cadre IMU est place ENTRE la camera et le Pi et s'etend verticalement
// jusqu'a toucher les deux -> il sert lui-meme de liaison, plus de bande
// separee. L'ensemble reste UNE seule piece pour juger l'espacement reel.
module holes_test() {
    m          = frame_m;   // largeur du bord de matiere des cadres
    wall_clear = 2;    // jeu entre le bord interieur evide et les bossages

    // --- rectangles exterieurs (bords) de chaque cadre ---
    cam_ox0 = -hole_xy - cam_boss_d/2 - m;  cam_ox1 =  hole_xy + cam_boss_d/2 + m;
    cam_oy0 = -hole_xy - cam_boss_d/2 - m;  cam_oy1 =  hole_xy + cam_boss_d/2 + m;
    pi_ox0  = min(pi_hole_xs) - pi_boss_d/2 - m;  pi_ox1 = max(pi_hole_xs) + pi_boss_d/2 + m;
    pi_oy0  = min(pi_hole_ys) - pi_boss_d/2 - m;  pi_oy1 = max(pi_hole_ys) + pi_boss_d/2 + m;
    imu_ox0 = min(imu_hole_xs) - imu_boss_d/2 - m;  imu_ox1 = max(imu_hole_xs) + imu_boss_d/2 + m;
    // cadre IMU etendu en Y pour toucher/chevaucher camera (haut) et Pi (bas)
    imu_oy0 = pi_oy1  - imu_side_overlap;
    imu_oy1 = cam_oy0 + imu_side_overlap;

    // --- rectangles interieurs (evidements) ---
    cam_ix0 = -hole_xy + cam_boss_d/2 + wall_clear;
    cam_ix1 =  hole_xy - cam_boss_d/2 - wall_clear;
    cam_iy0 = -hole_xy + cam_boss_d/2 + wall_clear;
    cam_iy1 =  hole_xy - cam_boss_d/2 - wall_clear;

    pi_ix0 = min(pi_hole_xs) + pi_boss_d/2 + wall_clear;
    pi_ix1 = max(pi_hole_xs) - pi_boss_d/2 - wall_clear;
    pi_iy0 = min(pi_hole_ys) + pi_boss_d/2 + wall_clear;
    pi_iy1 = max(pi_hole_ys) - pi_boss_d/2 - wall_clear;

    // cadre IMU : rectangle 19x21 -> evidement central comme la camera
    imu_ix0 = min(imu_hole_xs) + imu_boss_d/2 + wall_clear;
    imu_ix1 = max(imu_hole_xs) - imu_boss_d/2 - wall_clear;
    imu_iy0 = min(imu_hole_ys) + imu_boss_d/2 + wall_clear;
    imu_iy1 = max(imu_hole_ys) - imu_boss_d/2 - wall_clear;

    difference() {
        union() {
            // bords exterieurs des 3 cadres (camera et IMU se chevauchent -> collent)
            translate([cam_ox0, cam_oy0, 0]) cube([cam_ox1 - cam_ox0, cam_oy1 - cam_oy0, plate_t]);
            translate([pi_ox0,  pi_oy0,  0]) cube([pi_ox1  - pi_ox0,  pi_oy1  - pi_oy0,  plate_t]);
            translate([imu_ox0, imu_oy0, 0]) cube([imu_ox1 - imu_ox0, imu_oy1 - imu_oy0, plate_t]);
            for (sx = [-1, 1], sy = [-1, 1])
                translate([sx*hole_xy, sy*hole_xy, plate_t])
                    cylinder(d = cam_boss_d, h = cam_boss_h);
            for (x = pi_hole_xs, y = pi_hole_ys)
                translate([x, y, plate_t])
                    cylinder(d = pi_boss_d, h = pi_boss_h);
            for (x = imu_hole_xs, y = imu_hole_ys)
                translate([x, y, plate_t])
                    cylinder(d = imu_boss_d, h = imu_boss_h);
        }
        // evidements centraux (cadres) — NE TOUCHENT PAS les bandes de liaison
        translate([cam_ix0, cam_iy0, -eps])
            cube([cam_ix1 - cam_ix0, cam_iy1 - cam_iy0, plate_t + 2*eps]);
        translate([pi_ix0, pi_iy0, -eps])
            cube([pi_ix1 - pi_ix0, pi_iy1 - pi_iy0, plate_t + 2*eps]);
        if (imu_ix1 > imu_ix0 && imu_iy1 > imu_iy0)
            translate([imu_ix0, imu_iy0, -eps])
                cube([imu_ix1 - imu_ix0, imu_iy1 - imu_iy0, plate_t + 2*eps]);
        // trous d'insert
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx*hole_xy, sy*hole_xy, -eps])
                cylinder(d = cam_insert_hole_d, h = plate_t + cam_boss_h + 2*eps);
        for (x = pi_hole_xs, y = pi_hole_ys)
            translate([x, y, -eps])
                cylinder(d = pi_insert_hole_d, h = plate_t + pi_boss_h + 2*eps);
        for (x = imu_hole_xs, y = imu_hole_ys)
            translate([x, y, -eps])
                cylinder(d = imu_insert_hole_d, h = plate_t + imu_boss_h + 2*eps);
    }
}

holes_test();
