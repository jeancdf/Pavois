// ============================================================================
// Pavois — Support camera InnoMaker CAM-OV5647 + Raspberry Pi 5, V2
//
// Geometrie : socle plat (pose libre / serre-joint), grande plaque PLATE
// inclinee a 80 degres PAR RAPPORT AU SOL, nervure centrale a l'arriere.
// => l'axe optique (perpendiculaire a la carte) vise ~10 degres au-dessus
//    de l'horizon. La camera regarde vers -Y dans ce modele.
// RIEN ne depasse en avant du plan de la face : le socle est coupe au ras
// du plan incline => la piece s'imprime A PLAT, face camera contre le
// plateau. La face de reference est donc moulee sur le plateau (planeite
// maximale) et tous les trous s'impriment verticaux (ronds).
//
// La camera est en HAUT de la plaque ; le Pi 5 est monte sur la MEME
// plaque, PARALLELE a la camera, juste EN DESSOUS d'elle, connecteurs
// MIPI/HDMI/USB-C vers le haut (nappe tres courte, ~40 mm de trajet).
// Le Pi ne peut pas entrer dans le champ : il est dans le plan de la
// carte camera, en retrait du plan de l'objectif.
//
// FIXATION PAR INSERTS LAITON CHAUFFANTS (pas d'ecrous) :
//   - Camera : 4 vis M2 traversant la carte, vissees dans des inserts M2
//     poses PAR L'ARRIERE de la plaque (bossages au dos pour la
//     profondeur). Vis M2 x 6 (ou 8). Aucune piece autour de l'objectif,
//     zone derriere la carte PLEINE et PLATE (aucun trou entre les 4).
//   - Pi 5 : 4 vis M2 + entretoises imprimees (part="spacers"),
//     vissees dans des inserts M2 (memes que la camera) poses PAR
//     L'ARRIERE. Vis M2 x 10 (ou 12).
//     (Le trou Pi officiel fait D=2.7mm : un M3 n'y passe PHYSIQUEMENT
//     pas, seul M2/M2.5 passe. Pas de M2.5 sous la main -> M2 partout,
//     un seul type d'insert/vis pour toute la piece.)
//   Pourquoi par l'arriere : la face avant (reference optique, moulee
//   sur le plateau) ne recoit jamais le fer -> pas de bourrelet de
//   plastique fondu autour des trous ; et la traction des vis ENFONCE
//   l'insert dans son logement au lieu de l'arracher.
//
// Cotes verifiees (2026-07) :
//   - CAM-OV5647 (doc InnoMaker) : carte 39x39, trous 4x D=2.20 mm.
//     Entraxe 34 mm CONFIRME par test physique (hole_spacing_test.scad,
//     eprouvette 34/35mm imprimee -> le 34 s'aligne sur la vraie carte).
//   - Pi 5 (plan officiel Raspberry Pi) : trous D=2.7 mm, entraxes
//     58 x 49 mm, a 3.5 mm des bords.
//
// PIECES A IMPRIMER (x2 supports pour la Phase 1) :
//   part = "coupon"  : eprouvette de tolerance, A IMPRIMER EN PREMIER
//                      (tester les vis ET poser de vrais inserts dedans)
//   part = "mount"   : le support, A PLAT, face camera sur le plateau
//   part = "spacers" : 4 entretoises Pi (a plat aussi)
// ============================================================================

part = "mount";   // "mount" | "coupon" | "spacers"

// true = le support est exporte deja couche a plat (face camera vers le
// plateau), pret a trancher ; false = pose debout, comme a l'usage.
print_flat = true;

/* ===== Carte camera (doc InnoMaker, verifie) ===== */
board_size   = 39;      // carte carree 39x39 mm
board_th     = 1.2;     // epaisseur PCB — a verifier au pied a coulisse
hole_spacing = 34;       // CONFIRME par test physique (eprouvette 34mm) le 2026-07-27
hole_inset   = (board_size - hole_spacing) / 2;   // = 2.5 mm, deduit de l'entraxe confirme

/* ===== Visee ===== */
plate_angle  = 80;      // inclinaison de la face par rapport au SOL
                        // => elevation de l'axe optique = 90 - plate_angle

/* ===== Plaque inclinee (camera en haut, Pi en dessous) ===== */
plate_w = 95;           // largeur : Pi 85 mm + marge
plate_t = 4;
cam_h   = 100;          // hauteur du centre de la carte camera (sol -> centre)

/* ===== Inserts laiton M2 (camera) — a caler avec l'eprouvette =====
   Type courant "M2 x OD3.6 x L4" (Ruthex/CNC-Kitchen) : trou conseille 3.2 */
cam_insert_hole_d = 3.2;
cam_insert_len    = 4.0;
cam_boss_d        = 7;
cam_boss_h        = 2;    // profondeur dispo = plate_t + 2 = 6 mm

/* ===== Inserts laiton M2 (Pi) — MEMES que la camera =====
   Le trou Pi officiel (D=2.7) exclut le M3 physiquement ; pas de M2.5
   disponible -> M2 partout, un seul insert/vis pour toute la piece. */
pi_insert_hole_d = cam_insert_hole_d;
pi_insert_len    = cam_insert_len;
pi_boss_d        = cam_boss_d;
pi_boss_h        = cam_boss_h;    // profondeur dispo = plate_t + 2 = 6 mm

/* ===== Aretes de calage de la carte camera =====
   DESACTIVEES par defaut : elles depasseraient de la face et empecheraient
   l'impression a plat. Le calage en rotation restant (jeu vis 2.0 dans
   trou 2.2) vaut ~0.3 deg au pire, rattrape par la calibration Pavois. */
use_lip = false;
lip_w   = 1.5;
lip_h   = 1.0;

/* ===== Raspberry Pi 5, parallele a la camera, juste en dessous =====
   Tourne de 180 degres dans le plan par rapport a l'orientation standard :
   bord USB-C / HDMI / MIPI vers le HAUT (MIPI pile sous la camera,
   USB-C a droite de la carte camera -> cable alim libre),
   GPIO vers le bas, carte SD a DROITE (+X), USB/Ethernet a GAUCHE (-X). */
pi_l          = 85;      // carte Pi 5 (verifie : plan officiel)
pi_w          = 56;
pi_hole_dx    = 58;      // entraxes officiels, trous D=2.7
pi_hole_dy    = 49;
pi_hole_inset = 3.5;     // trous a 3.5 mm des bords
pi_gap        = 18;      // espace entre bord bas carte camera et bord MIPI du Pi
                          // (agrandi le 2026-07-28 : degage la nappe MIPI et
                          // descend le Pi vers le socle -> CG plus bas ;
                          // marge restante bord bas trou Pi -> bord plaque
                          // ~9.5 mm, encore largement dans la matiere)
pi_spacer_h   = 4;       // entretoises imprimees a part (degagement dessous PCB)
pi_spacer_d   = 6.5;
pi_screw_d    = 2.4;     // alesage des entretoises (passage vis M2)

/* ===== Pied / socle ===== */
rib_w   = 10;    // nervure centrale — passe ENTRE les bossages d'inserts
base_w  = 100;
base_y0 = -25;   // sera recoupe au ras du plan de la face (~y -19)
base_y1 = 40;    // bord arriere
base_t  = 6;

/* ===== Interne ===== */
$fn = 48;
eps = 0.1;
hole_xy = hole_spacing/2;              // 16.5
half_b  = board_size/2;

// Repere local de la plaque : origine au CENTRE DE LA CARTE CAMERA,
// y le long de la pente (+ vers le haut), z=0 face arriere, z=plate_t face avant.
plate_top = half_b + 3;                                   // marge au-dessus de la carte
plate_bot = -(cam_h - 2)/cos(90 - plate_angle);           // rejoint le socle en bas

// Pi : bord MIPI a pi_gap sous la carte camera, SD a droite (+X)
pi_top_y   = -(half_b + pi_gap);
pi_hole_xs = [pi_l/2 - pi_hole_inset, pi_l/2 - pi_hole_inset - pi_hole_dx];
pi_hole_ys = [pi_top_y - pi_hole_inset, pi_top_y - pi_hole_inset - pi_hole_dy];

echo(str("Elevation axe optique : ", 90 - plate_angle, " deg au-dessus de l'horizon"));
echo(str("Vis camera : M2 x 6 (ou 8), insert M2 L", cam_insert_len,
         " dans ", plate_t + cam_boss_h, " mm de matiere"));
echo(str("Vis Pi 5   : M2 x 10 (ou 12), insert M2 L", pi_insert_len,
         " dans ", plate_t + pi_boss_h, " mm de matiere"));

module in_plate_frame() {
    translate([0, 0, cam_h])
        rotate([plate_angle, 0, 0])
            translate([0, 0, -plate_t/2])
                children();
}

// Demi-espace situe DEVANT le plan de la face — sert a couper le socle
// au ras, pour que la face posee sur le plateau soit le point le plus avance.
module front_halfspace() {
    in_plate_frame()
        translate([-500, -500, plate_t])
            cube([1000, 1000, 500]);
}

module plate_body() {
    translate([-plate_w/2, plate_bot, 0])
        cube([plate_w, plate_top - plate_bot, plate_t]);
    // bossages d'inserts au DOS de la plaque (imprimes vers le haut quand
    // la piece est a plat) — la nervure centrale passe entre eux
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx*hole_xy, sy*hole_xy, -cam_boss_h])
            cylinder(d = cam_boss_d, h = cam_boss_h + eps);
    for (x = pi_hole_xs, y = pi_hole_ys)
        translate([x, y, -pi_boss_h])
            cylinder(d = pi_boss_d, h = pi_boss_h + eps);
    if (use_lip) {
        // Aretes de calage bords BAS et GAUCHE de la carte camera —
        // impression DEBOUT uniquement (elles depassent de la face)
        translate([-half_b - lip_w, -half_b - lip_w, plate_t])
            cube([board_size + 2*lip_w, lip_w, lip_h]);            // bas
        translate([-half_b - lip_w, -half_b - lip_w, plate_t])
            cube([lip_w, 30, lip_h]);                              // gauche
    }
}

module plate_cuts() {
    // --- camera : 4 alesages d'insert M2, traversants (insert pose
    //     par l'arriere, affleurant au bossage) ---
    for (sx = [-1, 1], sy = [-1, 1])
        translate([sx*hole_xy, sy*hole_xy, -cam_boss_h - eps])
            cylinder(d = cam_insert_hole_d, h = cam_boss_h + plate_t + 2*eps);
    // --- Pi 5 : 4 alesages d'insert M2, traversants ---
    for (x = pi_hole_xs, y = pi_hole_ys)
        translate([x, y, -pi_boss_h - eps])
            cylinder(d = pi_insert_hole_d, h = pi_boss_h + plate_t + 2*eps);
    version_mark();
}

// Marquage "34" en creux au DOS de la plaque (cote bossages, jamais sur
// la face optique), a cote des trous camera, hors du passage de la
// nervure -> sert a distinguer cette version (entraxe 34mm confirme)
// d'un tirage precedent. Profondeur 0.6mm, ne traverse pas la plaque
// (3.4mm de matiere restants devant).
version_mark_size  = 9;
version_mark_depth = 0.8;   // profond pour bien accrocher la lumiere une fois imprime
module version_mark() {
    translate([35, 5, -eps])
        linear_extrude(version_mark_depth + eps)
            text("34", size = version_mark_size, font = "Liberation Sans:style=Bold",
                 halign = "center", valign = "center");
}

module base() {
    difference() {
        translate([-base_w/2, base_y0, 0])
            cube([base_w, base_y1 - base_y0, base_t]);
        front_halfspace();   // coupe au ras du plan de la face
    }
}

module rib() {
    // Pilier plein entre le dos de la plaque (bande centrale, entre les
    // bossages d'inserts camera ET Pi) et le socle — hull = gousset.
    hull() {
        in_plate_frame()
            translate([-rib_w/2, plate_bot, -eps])
                cube([rib_w, plate_top - plate_bot, eps]);
        translate([-rib_w/2, 6, 0])
            cube([rib_w, 22, base_t]);
    }
}

module mount() {
    difference() {
        union() {
            in_plate_frame() plate_body();
            rib();
            base();
        }
        in_plate_frame() plate_cuts();
    }
}

// 4 entretoises Pi (vis M2.5 au travers), a imprimer a plat
module spacers() {
    for (i = [0:3])
        translate([i*12, 0, 0])
            difference() {
                cylinder(d = pi_spacer_d, h = pi_spacer_h);
                translate([0, 0, -eps])
                    cylinder(d = pi_screw_d, h = pi_spacer_h + 2*eps);
            }
}

// Eprouvette A PLAT, comme le support final : trous verticaux, bande
// surelevee reproduisant les bossages d'inserts (meme profondeur que
// sur la piece). Poser de VRAIS inserts M2 dans les candidats et visser.
// Camera ET Pi utilisent maintenant le meme insert M2 (pas de M2.5
// disponible, M3 ne rentre pas dans le trou Pi de 2.7mm) -> une seule
// rangee d'inserts suffit.
// De gauche a droite :
//   rangee haute (tuile 4 mm)   : alesages entretoises 2.2 / 2.4 / 2.6
//   rangee basse (bande +2 mm)  : inserts M2 3.0 / 3.2 / 3.4
module coupon() {
    tile_l = 58; tile_w = 26;
    bore_tests      = [2.2, 2.4, 2.6];
    m2_ins_tests    = [3.0, 3.2, 3.4];
    band_w = 11;
    difference() {
        union() {
            translate([-tile_l/2, -tile_w/2, 0])
                cube([tile_l, tile_w, plate_t]);
            translate([-tile_l/2, -tile_w/2, 0])
                cube([tile_l, band_w, plate_t + cam_boss_h]);      // bande inserts M2
        }
        for (i = [0 : len(bore_tests)-1])
            translate([-16.5 + i*16.5, 7, -eps])
                cylinder(d = bore_tests[i], h = plate_t + 2*eps, $fn = 32);
        for (i = [0 : len(m2_ins_tests)-1])
            translate([-16.5 + i*16.5, -tile_w/2 + band_w/2, -eps])
                cylinder(d = m2_ins_tests[i], h = plate_t + cam_boss_h + 2*eps, $fn = 32);
    }
}

if (part == "mount") {
    if (print_flat)
        // couche la piece face camera contre le plateau (le slicer la
        // repose a z=0 tout seul)
        rotate([90 + (90 - plate_angle), 0, 0]) mount();
    else
        mount();
}
else if (part == "spacers") spacers();
else coupon();

// ============================================================================
// Impression (x2 supports identiques, Cam0 + Cam1) :
// - Support A PLAT : FACE CAMERA CONTRE LE PLATEAU. Plus rien ne depasse
//   devant la face (socle coupe au ras). Aucun support requis : nervure
//   et socle montent quasi verticaux, les bossages d'inserts pointent
//   vers le haut.
// - La face posee sur le plateau devient la reference optique : planeite
//   de premiere couche. Soigner le premier layer (pas d'elephant foot).
// - PETG conseille ; 4-6 perimetres (les alesages d'inserts ont besoin
//   de matiere autour pour le frettage a chaud).
// - POSE DES INSERTS : PAR L'ARRIERE (cote bossages), au fer a souder
//   ~220-250 degC, bien perpendiculaire, affleurant au bossage. Ne
//   JAMAIS poser par la face avant : le bourrelet de fusion ruinerait
//   la planeite de la reference optique. L'eprouvette sert aussi a
//   s'entrainer au geste.
// - Montage camera : carte posee a plat sur la face, 4 vis M2 x 6 de
//   l'avant dans les inserts. Serrage modere et en croix.
// - Montage Pi : vis M2 x 10 -> Pi -> entretoise imprimee -> plaque
//   -> insert. SD a droite, USB/Ethernet a gauche, alim USB-C vers le
//   haut a droite de la carte camera (le cable passe a cote d'elle).
// - Nappe : descend de la carte camera vers les connecteurs MIPI du Pi
//   juste en dessous, trajet ~40 mm.
// - Stabilite : le socle ne depasse plus devant -> serre-joint ou butee
//   conseilles (deja necessaires pour la repetabilite du pied).
// ============================================================================
