// Pavois — Eprouvette DEDIEE : 4 trous de fixation IMU Adafruit BNO085.
// Motif RECTANGULAIRE 18.5 x 21 mm (entraxe X = 18.5, entraxe Y = 21) : ce
// n'est PAS un carre (corrige le 2026-07-28), et l'entraxe X est passe de 19
// a 18.5 le 2026-07-31 apres essai imprime (colonnes trop ecartees de 0.5mm).
// Trous ~2.5mm (vis M2.5) -> insert
// M2.5, memes dimensions que les inserts Pi de camera_mount_v2_pi25.scad
// (alesage 4.0mm, bossage 9.5mm / 3mm de haut).
//
// Style "cadre" comme holes_test.scad : bord de matiere autour des bossages,
// centre evide -> juste un test d'entraxe + tenue d'insert, impression rapide.
// A confirmer par mesure au pied a coulisse de la carte reelle avant de figer
// le motif sur le support final.
//
// Impression : face (z=0) sur le plateau, bossages vers le haut, pas de
// support necessaire.

/* ===== Motif des trous IMU BNO085 ===== */
imu_dx = 18.5;            // entraxe X : corrige 19 -> 18.5, les 2 colonnes
                          // etaient 0.5 mm trop ecartees sur l'essai imprime
imu_dy = 21;              // entraxe Y : colonnes bien alignees, valeur validee
imu_hx = imu_dx / 2;
imu_hy = imu_dy / 2;

/* ===== Inserts M2.5 (identiques au Pi, pi25) ===== */
insert_hole_d = 4.0;      // alesage = d3 conseille fiche fournisseur
boss_d        = 9.5;
boss_h        = 3;

plate_t    = 4;
m          = 4;           // largeur du bord de matiere autour des bossages
wall_clear = 2;           // jeu entre le bord interieur evide et les bossages
eps        = 0.1;
$fn        = 48;

module imu_holes_test() {
    // rectangle exterieur (bord du cadre)
    ox0 = -imu_hx - boss_d/2 - m;  ox1 = imu_hx + boss_d/2 + m;
    oy0 = -imu_hy - boss_d/2 - m;  oy1 = imu_hy + boss_d/2 + m;
    // rectangle interieur (evidement central)
    ix0 = -imu_hx + boss_d/2 + wall_clear;  ix1 = imu_hx - boss_d/2 - wall_clear;
    iy0 = -imu_hy + boss_d/2 + wall_clear;  iy1 = imu_hy - boss_d/2 - wall_clear;

    difference() {
        union() {
            translate([ox0, oy0, 0])
                cube([ox1 - ox0, oy1 - oy0, plate_t]);
            for (sx = [-1, 1], sy = [-1, 1])
                translate([sx*imu_hx, sy*imu_hy, plate_t])
                    cylinder(d = boss_d, h = boss_h);
        }
        if (ix1 > ix0 && iy1 > iy0)
            translate([ix0, iy0, -eps])
                cube([ix1 - ix0, iy1 - iy0, plate_t + 2*eps]);
        for (sx = [-1, 1], sy = [-1, 1])
            translate([sx*imu_hx, sy*imu_hy, -eps])
                cylinder(d = insert_hole_d, h = plate_t + boss_h + 2*eps);
    }
}

imu_holes_test();
