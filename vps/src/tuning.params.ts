/**
 * Réglages modifiables pendant que le système tourne : seuils des détecteurs
 * (sur les Pi) et paramètres du moteur de fusion (sur le VPS).
 *
 * Cette table est la seule description des réglages : l'API s'en sert pour
 * valider, et le frontend la reçoit telle quelle pour dessiner ses curseurs.
 */

export type TuningValues = Record<string, number>;

export interface TuningChoice {
  value: number;
  label: string;
}

export interface TuningParam {
  key: string;
  group: string;
  label: string;
  hint: string;
  unit?: string;
  /** Bornes acceptées par l'API. */
  min: number;
  max: number;
  /** Bornes du curseur, plus serrées que celles de l'API quand elles sont trop larges. */
  sliderMin?: number;
  sliderMax?: number;
  step: number;
  integer: boolean;
  /** Liste fermée : seule une de ces valeurs est acceptée, l'interface montre une liste. */
  choices?: TuningChoice[];
  /** Ce que vaut 0 pour ce réglage, quand 0 n'est pas une valeur ordinaire. */
  zeroLabel?: string;
  /** Liste courte que l'interface montre en boutons côte à côte plutôt qu'en liste déroulante. */
  switch?: boolean;
}

export interface TuningPreset {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  /** null : chaque Pi reprend son propre fichier de configuration. */
  detector: TuningValues | null;
  /** Écarts par rapport aux valeurs de démarrage du VPS. */
  fusion: TuningValues;
}

// Clés et bornes identiques à pavois++/src/config/live_tuning.cpp, qui borne
// de son côté ce qu'il reçoit.
export const DETECTOR_PARAMS: TuningParam[] = [
  {
    key: 'diff_threshold',
    group: 'Seuil',
    label: 'Seuil de différence',
    hint: "Écart minimal avec le fond pour qu'un pixel compte. Plus bas : plus sensible, mais plus de bruit.",
    unit: 'niveaux',
    min: 1,
    max: 255,
    sliderMax: 60,
    step: 1,
    integer: true,
  },
  {
    key: 'adaptive_k',
    group: 'Seuil',
    label: 'Marge sur le bruit',
    hint: 'Le seuil monte de k × le bruit mesuré du pixel. Plus haut : ignore mieux les zones qui scintillent.',
    min: 0,
    max: 10,
    sliderMax: 6,
    step: 0.1,
    integer: false,
  },
  {
    key: 'blur_radius',
    group: 'Seuil',
    label: 'Flou avant comparaison',
    hint: "Lisse l'image avant de la comparer au fond. Le changer relance l'apprentissage du fond (12 images).",
    unit: 'px',
    min: 0,
    max: 5,
    step: 1,
    integer: true,
  },
  {
    key: 'morph_open',
    group: 'Nettoyage',
    label: 'Ouverture',
    hint: 'Efface les points isolés. À 0, les très petites cibles ne sont plus effacées avec eux.',
    min: 0,
    max: 5,
    step: 1,
    integer: true,
  },
  {
    key: 'morph_close',
    group: 'Nettoyage',
    label: 'Fermeture',
    hint: "Bouche les trous et recolle les morceaux proches d'un même blob.",
    min: 0,
    max: 8,
    step: 1,
    integer: true,
  },
  {
    key: 'min_blob_area',
    group: 'Forme des blobs',
    label: 'Surface minimale',
    hint: 'Un blob plus petit est ignoré.',
    unit: 'px²',
    min: 1,
    max: 5000,
    sliderMax: 200,
    step: 1,
    integer: true,
  },
  {
    key: 'max_blob_area_ratio',
    group: 'Forme des blobs',
    label: 'Surface maximale',
    hint: "Part de l'image au-delà de laquelle un blob est traité comme du décor.",
    min: 0.001,
    max: 1,
    sliderMin: 0.005,
    step: 0.005,
    integer: false,
  },
  {
    key: 'min_blob_fill_ratio',
    group: 'Forme des blobs',
    label: 'Remplissage minimal',
    hint: 'Surface du blob divisée par celle de son rectangle. Rejette les traits fins.',
    min: 0,
    max: 1,
    step: 0.01,
    integer: false,
  },
  {
    key: 'max_blob_aspect',
    group: 'Forme des blobs',
    label: 'Allongement maximal',
    hint: 'Rapport entre le grand et le petit côté du blob.',
    min: 1,
    max: 50,
    sliderMax: 20,
    step: 0.5,
    integer: false,
  },
  {
    key: 'border_ignore_px',
    group: 'Forme des blobs',
    label: 'Bord ignoré',
    hint: "Un petit blob dont le centre est à moins de cette distance du bord de l'image est ignoré.",
    unit: 'px',
    min: 0,
    max: 200,
    sliderMax: 60,
    step: 1,
    integer: true,
  },
  {
    key: 'confirm_m',
    group: 'Confirmation',
    label: 'Images avec détection (M)',
    hint: 'La détection est envoyée quand M des N dernières images contiennent un blob.',
    min: 1,
    max: 10,
    step: 1,
    integer: true,
  },
  {
    key: 'confirm_n',
    group: 'Confirmation',
    label: 'Sur les N dernières',
    hint: 'Jamais plus petit que M : le détecteur le remonte si besoin.',
    min: 1,
    max: 30,
    sliderMax: 15,
    step: 1,
    integer: true,
  },
  {
    key: 'bg_learn_rate',
    group: 'Fond',
    label: 'Apprentissage du fond',
    hint: "Part de l'image courante mélangée au fond à chaque image.",
    min: 0,
    max: 1,
    sliderMax: 0.3,
    step: 0.005,
    integer: false,
  },
  {
    key: 'bg_learn_rate_fg',
    group: 'Fond',
    label: 'Apprentissage sous une cible',
    hint: 'Plus bas : une cible immobile met plus longtemps à se fondre dans le décor.',
    min: 0,
    max: 1,
    sliderMax: 0.05,
    step: 0.0005,
    integer: false,
  },
  {
    key: 'bg_hold_frames',
    group: 'Fond',
    label: 'Maintien après passage',
    hint: "Nombre d'images pendant lesquelles un pixel reste protégé après le passage d'une cible.",
    unit: 'images',
    min: 0,
    max: 60000,
    sliderMax: 600,
    step: 10,
    integer: true,
  },
  {
    key: 'illumination_hot_ratio',
    group: 'Fond',
    label: "Changement d'éclairage",
    hint: "Part de l'image qui doit changer d'un coup pour que l'image soit ignorée en bloc.",
    min: 0.01,
    max: 1,
    step: 0.01,
    integer: false,
  },
  // Capture : arguments de rpicam-vid, le Pi redémarre sa caméra (environ une
  // seconde sans image). 0 garde la valeur du fichier de configuration du Pi.
  {
    key: 'capture_width',
    group: 'Image',
    label: "Taille d'image",
    hint: "Pixels de chaque image. Plus petite : plus d'images par seconde sur un Pi chargé, mais une cible lointaine couvre moins de pixels. Même champ de vision à toutes les tailles. Le Pi redémarre sa caméra.",
    unit: 'px',
    min: 0,
    max: 1920,
    step: 1,
    integer: true,
    choices: [
      { value: 0, label: 'Fichier du Pi' },
      { value: 640, label: '640 × 360' },
      { value: 1024, label: '1024 × 576' },
      { value: 1280, label: '1280 × 720' },
      { value: 1920, label: '1920 × 1080' },
    ],
  },
  {
    key: 'shutter_us',
    group: 'Image',
    label: 'Temps de pose',
    hint: "Plus long : image plus claire, mais une cible en mouvement devient floue. Au-delà de 33 000 µs la caméra ne tient plus 30 images par seconde. Ignoré en exposition automatique. 0 : valeur du fichier du Pi. Le Pi redémarre sa caméra.",
    unit: 'µs',
    min: 0,
    max: 1000000,
    sliderMax: 33000,
    step: 100,
    integer: true,
    zeroLabel: 'fichier du Pi',
  },
  {
    key: 'analogue_gain',
    group: 'Image',
    label: 'Gain',
    hint: "Amplification du capteur. Plus haut : image plus claire, mais plus de bruit, donc plus de faux blobs. Ignoré en exposition automatique. 0 : valeur du fichier du Pi. Le Pi redémarre sa caméra.",
    min: 0,
    max: 32,
    sliderMax: 16,
    step: 0.1,
    integer: false,
    zeroLabel: 'fichier du Pi',
  },
  {
    key: 'auto_exposure',
    group: 'Image',
    label: 'Exposition',
    hint: "Automatique : la caméra règle elle-même temps de pose et gain selon la lumière (soleil, nuages, crépuscule), en continu ; les deux réglages ci-dessus sont alors ignorés. Manuelle : temps de pose et gain fixes. Changer de mode redémarre la caméra du Pi.",
    min: 0,
    max: 2,
    step: 1,
    integer: true,
    choices: [
      { value: 0, label: 'Fichier du Pi' },
      { value: 1, label: 'Manuelle' },
      { value: 2, label: 'Automatique' },
    ],
    switch: true,
  },
  {
    key: 'ev',
    group: 'Image',
    label: 'Compensation',
    hint: "Exposition automatique seulement : éclaircit (+) ou assombrit (−) le résultat, en indices de lumination. 0 : valeur du fichier du Pi. Le Pi redémarre sa caméra.",
    unit: 'IL',
    min: -8,
    max: 8,
    sliderMin: -3,
    sliderMax: 3,
    step: 0.5,
    integer: false,
    zeroLabel: 'fichier du Pi',
  },
];

// Valeurs par défaut de CameraConfig (pavois++/include/pavois/config/app_config.hpp).
export const DETECTOR_DEFAULTS: TuningValues = {
  diff_threshold: 14,
  adaptive_k: 2.2,
  blur_radius: 1,
  morph_open: 1,
  morph_close: 2,
  min_blob_area: 12,
  max_blob_area_ratio: 0.12,
  min_blob_fill_ratio: 0.1,
  max_blob_aspect: 6,
  border_ignore_px: 6,
  confirm_m: 2,
  confirm_n: 3,
  bg_learn_rate: 0.05,
  bg_learn_rate_fg: 0.002,
  bg_hold_frames: 90,
  illumination_hot_ratio: 0.45,
  // 0 : chaque Pi garde la taille et l'exposition de son fichier.
  capture_width: 0,
  shutter_us: 0,
  analogue_gain: 0,
  auto_exposure: 0,
  ev: 0,
};

export const FUSION_PARAMS: TuningParam[] = [
  {
    key: 'maxResidualPx',
    group: 'Triangulation',
    label: 'Résidu maximal',
    hint: 'Écart toléré entre le point 3D reprojeté et chaque blob. Plus bas : moins de fausses pistes, mais il faut des poses bien calibrées.',
    unit: 'px',
    min: 1,
    max: 500,
    sliderMax: 200,
    step: 1,
    integer: false,
  },
  {
    key: 'minParallaxDeg',
    group: 'Triangulation',
    label: 'Parallaxe minimale',
    hint: 'Angle minimal entre les rayons de deux caméras. En dessous, la profondeur est trop incertaine.',
    unit: '°',
    min: 0.1,
    max: 30,
    sliderMax: 10,
    step: 0.1,
    integer: false,
  },
  {
    key: 'minRangeM',
    group: 'Triangulation',
    label: 'Distance minimale',
    hint: "Une solution plus proche d'une caméra est rejetée.",
    unit: 'm',
    min: 0,
    max: 50,
    sliderMax: 5,
    step: 0.1,
    integer: false,
  },
  {
    key: 'maxRangeM',
    group: 'Triangulation',
    label: 'Distance maximale',
    hint: 'Une solution plus lointaine est rejetée.',
    unit: 'm',
    min: 1,
    max: 1000,
    sliderMax: 100,
    step: 0.5,
    integer: false,
  },
  {
    key: 'assocGatePx',
    group: 'Association',
    label: 'Tolérance piste → blob',
    hint: "Écart maximal entre la position prédite d'une piste dans l'image et le blob qu'on lui attribue.",
    unit: 'px',
    min: 1,
    max: 500,
    sliderMax: 200,
    step: 1,
    integer: false,
  },
  {
    key: 'pairGatePx',
    group: 'Association',
    label: "Tolérance d'une image à l'autre",
    hint: "Déplacement maximal d'un blob entre deux images d'une même caméra pour qu'il soit suivi.",
    unit: 'px',
    min: 1,
    max: 500,
    sliderMax: 200,
    step: 1,
    integer: false,
  },
  {
    key: 'maxBlobsPerCamera',
    group: 'Association',
    label: 'Blobs par caméra',
    hint: 'Nombre de blobs gardés par caméra à chaque fusion, les plus sûrs en premier.',
    min: 1,
    max: 32,
    step: 1,
    integer: true,
  },
  {
    key: 'maxTargets',
    group: 'Association',
    label: 'Nouvelles cibles par fusion',
    hint: 'Nombre maximal de pistes créées à chaque fusion.',
    min: 1,
    max: 32,
    step: 1,
    integer: true,
  },
  {
    key: 'intervalMs',
    group: 'Cadence',
    label: 'Période de fusion',
    hint: '33 ms = 30 fusions par seconde. À aligner sur la cadence de capture des caméras.',
    unit: 'ms',
    min: 5,
    max: 200,
    sliderMax: 100,
    step: 1,
    integer: true,
  },
  {
    key: 'latencyMs',
    group: 'Cadence',
    label: 'Attente des caméras',
    hint: "Temps maximal passé à attendre l'image de chaque caméra avant de fusionner.",
    unit: 'ms',
    min: 0,
    max: 500,
    sliderMax: 300,
    step: 5,
    integer: true,
  },
  {
    key: 'broadcastMs',
    group: 'Cadence',
    label: "Période d'affichage",
    hint: "Intervalle minimal entre deux envois de pistes vers l'interface.",
    unit: 'ms',
    min: 0,
    max: 1000,
    sliderMax: 200,
    step: 1,
    integer: true,
  },
  {
    key: 'confirmUpdates',
    group: 'Suivi',
    label: 'Mesures pour confirmer',
    hint: "Nombre de fusions cohérentes avant qu'une piste soit affichée.",
    min: 1,
    max: 20,
    sliderMax: 10,
    step: 1,
    integer: true,
  },
  {
    key: 'maxCoastMs',
    group: 'Suivi',
    label: 'Survie sans mesure',
    hint: 'Durée pendant laquelle une piste perdue peut encore être reprise.',
    unit: 'ms',
    min: 100,
    max: 10000,
    sliderMax: 5000,
    step: 100,
    integer: true,
  },
  {
    key: 'gateChi2',
    group: 'Suivi',
    label: 'Porte statistique (χ²)',
    hint: 'Écart maximal, mesuré en incertitudes, entre une mesure et ce que la piste prédisait.',
    min: 1,
    max: 100,
    sliderMax: 40,
    step: 0.5,
    integer: false,
  },
  {
    key: 'matchDistanceM',
    group: 'Suivi',
    label: "Distance d'association",
    hint: 'Marge en mètres ajoutée à ce que la cible a pu parcourir depuis sa dernière mesure.',
    unit: 'm',
    min: 0.05,
    max: 50,
    sliderMax: 10,
    step: 0.05,
    integer: false,
  },
  {
    key: 'maxSpeedMps',
    group: 'Suivi',
    label: 'Vitesse maximale',
    hint: "Une piste plus rapide n'est ni confirmée ni affichée.",
    unit: 'm/s',
    min: 1,
    max: 500,
    sliderMax: 150,
    step: 1,
    integer: false,
  },
  {
    key: 'processNoise',
    group: 'Suivi',
    label: 'Agilité supposée',
    hint: 'Plus haut : la piste suit mieux les virages mais lisse moins. Ne vaut que pour les pistes créées ensuite.',
    min: 0.1,
    max: 5000,
    sliderMin: 1,
    sliderMax: 500,
    step: 1,
    integer: false,
  },
];

export const BUILTIN_PRESETS: TuningPreset[] = [
  {
    id: 'defaut',
    name: 'Défaut',
    description:
      'Chaque Pi reprend son fichier de configuration, le VPS ses valeurs de démarrage.',
    builtin: true,
    detector: null,
    fusion: {},
  },
  {
    id: 'sensible',
    name: 'Sensible',
    description:
      'Petites cibles ou faible contraste : seuils bas, donc plus de blobs et plus de bruit.',
    builtin: true,
    detector: {
      ...DETECTOR_DEFAULTS,
      diff_threshold: 8,
      adaptive_k: 1.8,
      morph_open: 0,
      min_blob_area: 4,
    },
    fusion: { maxBlobsPerCamera: 16 },
  },
  {
    id: 'strict',
    name: 'Strict',
    description:
      'Moins de fausses pistes : seuils hauts, confirmation plus longue, résidu serré.',
    builtin: true,
    detector: {
      ...DETECTOR_DEFAULTS,
      diff_threshold: 20,
      adaptive_k: 3,
      min_blob_area: 30,
      confirm_m: 3,
      confirm_n: 4,
    },
    fusion: { maxResidualPx: 25, confirmUpdates: 5 },
  },
  {
    id: 'multi-cibles',
    name: 'Multi-cibles',
    description:
      'Plusieurs cibles à la fois : plus de blobs par caméra et résidu à 40 px.',
    builtin: true,
    detector: null,
    fusion: { maxBlobsPerCamera: 16, maxTargets: 16, maxResidualPx: 40 },
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Vérifie un jeu de valeurs contre sa table. Renvoie les valeurs acceptées,
 * ou le message d'erreur à montrer à l'opérateur.
 */
export function checkValues(
  params: TuningParam[],
  input: unknown,
): { values: TuningValues } | { error: string } {
  if (!isPlainObject(input)) {
    return {
      error: 'Réglages invalides : un objet { clé: nombre } est attendu',
    };
  }
  const values: TuningValues = {};
  for (const [key, raw] of Object.entries(input)) {
    const param = params.find((item) => item.key === key);
    if (!param) {
      return { error: `Réglage inconnu : ${key}` };
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return { error: `${param.label} : un nombre est attendu` };
    }
    if (raw < param.min || raw > param.max) {
      return {
        error: `${param.label} : ${raw} est hors des bornes ${param.min} – ${param.max}`,
      };
    }
    if (param.integer && !Number.isInteger(raw)) {
      return { error: `${param.label} : un entier est attendu` };
    }
    if (param.choices && !param.choices.some((choice) => choice.value === raw)) {
      return {
        error: `${param.label} : ${raw} n'est pas dans la liste (${param.choices
          .map((choice) => choice.value)
          .join(', ')})`,
      };
    }
    values[key] = raw;
  }
  return { values };
}

/** Ne garde que les clés connues et dans leurs bornes (fichier d'une autre version). */
export function keepKnownValues(
  params: TuningParam[],
  input: unknown,
): TuningValues {
  if (!isPlainObject(input)) return {};
  const values: TuningValues = {};
  for (const param of params) {
    const checked = checkValues([param], { [param.key]: input[param.key] });
    if ('values' in checked) values[param.key] = checked.values[param.key];
  }
  return values;
}

/** Jeu complet pour un détecteur : toute clé absente prend sa valeur par défaut. */
export function completeDetectorValues(partial: TuningValues): TuningValues {
  const values: TuningValues = {};
  for (const param of DETECTOR_PARAMS) {
    values[param.key] = partial[param.key] ?? DETECTOR_DEFAULTS[param.key];
  }
  // Le détecteur remonte N à M ; faire pareil ici garde les deux côtés d'accord.
  values.confirm_n = Math.max(values.confirm_n, values.confirm_m);
  return values;
}

function formatValue(param: TuningParam, value: number): string {
  return param.integer
    ? String(Math.round(value))
    : String(Number(value.toPrecision(6)));
}

/** « clé=valeur,clé=valeur » dans l'ordre de la table : le corps d'une commande `set`. */
export function detectorSettingsLine(values: TuningValues): string {
  return DETECTOR_PARAMS.map(
    (param) => `${param.key}=${formatValue(param, values[param.key])}`,
  ).join(',');
}

/**
 * Version d'un jeu de réglages : une empreinte de son contenu. Le Pi la
 * renvoie telle quelle, ce qui dit s'il applique bien CE jeu, même après un
 * redémarrage du VPS. 0 est réservé au fichier de configuration du Pi.
 */
export function settingsVersion(line: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < line.length; i++) {
    hash ^= line.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 0x7fffffff) + 1;
}
