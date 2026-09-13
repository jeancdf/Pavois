// PAVOIS V0.5 : passage camera corrige, plateau a 8 mm.
// Versions precedentes conservees. Supports automatiques dans le projet 3MF uniquement.
// Toutes les pieces reposent sur la table ; pas de verrouillage vertical.
// Un ajustement imprime et une calibration restent necessaires.
use <camera_mount_v2_pi25.scad>

/* [Vue] */
view = "assembly"; // [assembly,exploded,part,cradle_detail]
part = "camera_rail"; // [rail,camera_rail,camera_end_left,camera_end_right,camera_rail_end,cradle_key,coupon_socket,coupon_tongue]
camera_count = 3; // [2,3]
show_mounts = true;
show_axes = true;
show_keys = true;

/* [Dimensions] */
rig_width = 1000;
fit = 0.10; // Jeu par face autour de la queue d'aronde
coupon_fit = 0.10;
base_thickness = 3; // Plaque mince posee integralement sur une table rigide
waisted_base = true; // Retirer les bandes exterieures inutiles, sans trous internes

/* [Hidden] */
$fn=32;
eps=0.02;
pitch=rig_width/7;
deck=8;
camera_deck=deck; // meme plan que le dessus des jonctions
joint_y=68;
explode=view=="exploded";
assert(camera_count==2 || camera_count==3,"Deux ou trois cameras");
assert(base_thickness>=2.4 && base_thickness<=5,"Base 2.4..5 mm");
assert(fit>=0 && fit<=0.3,"Jeu hors plage 0..0.3 mm");
assert(pitch>=120 && pitch+20<=170,"Largeur hors plage 840..1050 mm");

// Deux queues d'aronde planes, hors de l'emprise des berceaux.
// Descente Z, pas translation X. La table fait reference Z.
module joint_profile(clearance=0) {
    offset(delta=clearance)
        polygon([[-eps,-5],[4,-5],[20,-9],[20,9],[4,5],[-eps,5]]);
}
module male_joint() { linear_extrude(deck) joint_profile(); }
module female_joint(clearance=fit) {
    translate([0,0,-eps]) linear_extrude(deck+2*eps) joint_profile(clearance);
}

// Dessous plan continu : aucun tenon suspendu a imprimer.
module base_outline() {
    if(waisted_base)
        polygon([[0,-80],[28,-80],[35,-52],[pitch-17,-52],
                 [pitch-10,-80],[pitch,-80],[pitch,80],[pitch-10,80],
                 [pitch-17,48],[35,48],[28,80],[0,80]]);
    else translate([0,-80]) square([pitch,160]);
}
module rail(last=false, first=false) {
    difference() {
        union() {
            linear_extrude(base_thickness) base_outline();
            // Seules les interfaces restent a 8 mm, pour compatibilite V2/V3.
            for(y=[-80,56]) {
                translate([0,y,0]) cube([28,24,deck]);
                translate([pitch-10,y,0]) cube([10,24,deck]);
            }
            if(!last) for(y=[-joint_y,joint_y])
                translate([pitch,y,0]) male_joint();
        }
        if(!first) for(y=[-joint_y,joint_y]) translate([0,y,0]) female_joint();
    }
}

// Berceau V2 : introduction depuis -Y. Deux butees arriere hors nervure.
// Les supports V2 gardent leur inclinaison de 20 deg et leur electronique.
module cradle() {
    union() {
        translate([-56,-40,0]) cube([6,80,10]);
        translate([-56,-40,6.6]) cube([9,80,3.4]);
        translate([54,-40,0]) cube([6,84,10]);
        translate([48,-40,6.6]) cube([12,80,3.4]);
        for(x=[-43,27]) translate([x,40,0]) cube([16,6,8]);
    }
}
// Plateau plein jusqu'a Z=8, avec une entree plane entre les jonctions.
// La base d'origine V2 glisse depuis -Y sur ce meme plan.
module camera_rail(last=false, first=false) {
    union() {
        rail(last, first);
        translate([pitch/2-56,-56,0]) cube([116,104,camera_deck]);
        translate([pitch/2,0,camera_deck]) cradle();
    }
}
// Une cale separee par V2 pour maintenir le socle existant.
module cradle_key() {
    union() {
        translate([0,0,0.3]) linear_extrude(5.8)
            polygon([[49.6,-49],[54,-49],[54,40],[50.8,40]]);
        translate([49.6,-55,0.3]) cube([10.4,6.05,5.8]);
    }
}
module coupon_socket() {
    difference() {
        translate([0,-15,0]) cube([30,30,deck]);
        female_joint(coupon_fit);
        translate([26,0,deck-0.6]) linear_extrude(1)
            text(str(coupon_fit),size=3,halign="center",valign="center",
                 font="Liberation Sans:style=Bold");
    }
}
module coupon_tongue() {
    union() {
        translate([-10,-15,0]) cube([10,30,deck]);
        male_joint();
    }
}
module existing_mount() { color([0.66,0.71,0.76,0.8]) mount(); }
module payload() {
    if(show_keys) color("#ef9e35") translate([0,-32,0]) cradle_key();
    if(show_mounts) translate([0,0,(explode?30:0)]) existing_mount();
    if(show_axes) color("#df4e48") translate([0,0,130])
        rotate([70,0,0]) cylinder(r=1.1,h=200);
}
module assembly() {
    for(i=[0:6]) {
        is_camera=i==0 || i==3 || i==6;
        x=(i-3)*pitch-pitch/2+(explode?(i-3)*10:0);
        z=explode?(6-i)*12:0;
        translate([x,0,z]) {
            color(is_camera?"#4f9cb4":(i%2==0?"#405566":"#60798a"))
                if(is_camera) camera_rail(last=i==6, first=i==0); else rail();
            if(is_camera && (i!=3 || camera_count==3))
                translate([pitch/2,0,camera_deck]) payload();
        }
    }
}
module print_part() {
    if(part=="rail") rail();
    else if(part=="camera_rail") camera_rail();
    else if(part=="camera_end_left") camera_rail(first=true);
    else if(part=="camera_end_right" || part=="camera_rail_end") camera_rail(last=true);
    else if(part=="cradle_key") translate([0,0,-0.3]) cradle_key();
    else if(part=="coupon_socket") coupon_socket();
    else if(part=="coupon_tongue") coupon_tongue();
    else assert(false,"Piece inconnue");
}
echo(str("V0.5 : plateau au niveau des jonctions ; centres cartes Z=",camera_deck+130,
         " mm ; positions X=-",3*pitch," / 0 / +",3*pitch));
if(view=="part") print_part();
else if(view=="assembly" || view=="exploded") assembly();
else if(view=="cradle_detail") {
    color("#4f9cb4") camera_rail();
    translate([pitch/2,0,camera_deck]) payload();
}
else assert(false,"Vue inconnue");
