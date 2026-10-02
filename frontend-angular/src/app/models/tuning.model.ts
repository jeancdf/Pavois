// Miroir de vps/src/tuning.service.ts : l'état complet du panneau « Réglages ».

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
  min: number;
  max: number;
  sliderMin?: number;
  sliderMax?: number;
  step: number;
  integer: boolean;
  // Liste fermée : affichée comme une liste déroulante.
  choices?: TuningChoice[];
  // Ce que vaut 0 quand ce n'est pas une valeur ordinaire (« fichier du Pi »).
  zeroLabel?: string;
}

export interface TuningPreset {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  // null : chaque Pi reprend son propre fichier de configuration.
  detector: TuningValues | null;
  fusion: TuningValues;
}

export interface TuningCameraState {
  cameraId: string;
  mode: 'untouched' | 'file' | 'live';
  wanted: TuningValues | null;
  // Ce que le détecteur dit appliquer ; null tant qu'il ne l'a pas annoncé.
  reported: TuningValues | null;
  reportedVersion: number | null;
  width: number | null;
  height: number | null;
  synced: boolean;
}

export interface TuningState {
  type: 'tuning_state';
  params: { detector: TuningParam[]; fusion: TuningParam[] };
  detectorDefaults: TuningValues;
  fusion: { values: TuningValues; defaults: TuningValues };
  cameras: TuningCameraState[];
  presets: TuningPreset[];
  activePresetId: string | null;
  detectorCommands: boolean;
}
