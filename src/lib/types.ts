export type Sexo = 'M' | 'F';
export type FormulaBasal = 'harris_benedict' | 'mifflin_st_jeor' | 'katch_mcardle';
export type Comida = 'desayuno' | 'almuerzo' | 'once_cena' | 'colacion' | 'total_dia';
export type Deporte = 'ciclismo' | 'trote' | 'natacion' | 'otro';

export interface Perfil {
  id: string;
  nombre: string;
  sexo: Sexo;
  fecha_nacimiento: string | null;
  inicio_etapa: string | null;
  es_admin: boolean;
}

export interface ParametrosPerfil {
  id?: number;
  usuario_id?: string;
  vigente_desde: string; // YYYY-MM-DD
  estatura_cm: number;
  formula_basal: FormulaBasal;
  carbos_por_hora: number;
  meta_kcal: number;
  fc_reposo: number | null;
  fc_maxima: number | null;
  edad_fija: number | null;
  /** Ajuste personal del gasto basal en %, ej. -10 (indicación médica). 0 o null = sin ajuste */
  ajuste_basal_pct?: number | null;
  nota?: string | null;
}

export interface Medicion {
  id?: number;
  usuario_id?: string;
  fecha: string;
  peso_kg: number;
  grasa_pct: number | null; // porcentaje, ej. 26.5
  origen: 'manual' | 'balanza' | 'interpolado' | 'importado';
  nota?: string | null;
}

export interface Alimento {
  id?: number;
  propietario?: string | null;
  alcance: 'personal' | 'propuesto' | 'compartido';
  nombre: string;
  kcal: number;
  carbos_g: number;
  porcion: string;
  fuente: 'propia' | 'planilla' | 'openfoodfacts' | 'usda';
  codigo_barra?: string | null;
  ref_externa?: string | null;
  activo?: boolean;
}

export interface Consumo {
  id?: number;
  usuario_id?: string;
  fecha: string;
  comida: Comida;
  alimento_id: number | null;
  nombre: string;
  kcal_unidad: number;
  carbos_unidad: number;
  cantidad: number;
  origen?: 'manual' | 'importado';
}

export interface Actividad {
  id?: number;
  usuario_id?: string;
  fecha: string;
  deporte: Deporte;
  duracion_min: number;
  distancia_km: number | null;
  kcal: number | null;
  fc_media: number | null;
  origen?: string;
  nota?: string | null;
}

export const COMIDAS: { id: Comida; nombre: string }[] = [
  { id: 'desayuno', nombre: 'Desayuno' },
  { id: 'almuerzo', nombre: 'Almuerzo' },
  { id: 'once_cena', nombre: 'Once / Cena' },
  { id: 'colacion', nombre: 'Colación' },
];

export const DEPORTES: { id: Deporte; nombre: string }[] = [
  { id: 'ciclismo', nombre: 'Ciclismo' },
  { id: 'trote', nombre: 'Trote' },
  { id: 'natacion', nombre: 'Natación' },
  { id: 'otro', nombre: 'Otro / sin desglose' },
];
