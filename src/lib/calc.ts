/**
 * Motor de cálculo. Reproduce la lógica de la planilla "Seguimiento peso":
 *  - Composición:   IMC = peso / estatura²; grasa kg = peso × %grasa; masa magra = peso − grasa
 *  - Basal:         Harris-Benedict (peso total) o Katch-McArdle (370 + 21,6 × masa magra)
 *  - Ejercicio:     kcal medidas; si faltan, modelo propio kcal/km y kcal/h por deporte
 *  - Balance:       ingesta − (basal + ejercicio)
 *  - Carbohidratos: ingeridos − horas de entrenamiento × carbos/h (40 g/h por defecto)
 *  - Semana:        déficit acumulado vs variación real de peso y grasa
 * Funciones puras, sin dependencia de la base de datos.
 */
import type { Actividad, Consumo, Deporte, Medicion, ParametrosPerfil, Perfil } from './types';

export const KCAL_POR_KG = 7700;
/** Brechas entre pesajes mayores a esto no se interpolan (quedan sin peso) */
export const MAX_DIAS_INTERPOLACION = 21;
/** Días que se arrastra el último peso conocido si no hay pesaje posterior */
export const MAX_DIAS_ARRASTRE = 7;
const DIA_MS = 86_400_000;

// ---------- fechas (YYYY-MM-DD, sin zona horaria) ----------
export const toMs = (f: string) => Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10));
export const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const sumarDias = (f: string, n: number) => fromMs(toMs(f) + n * DIA_MS);
export const diffDias = (a: string, b: string) => Math.round((toMs(b) - toMs(a)) / DIA_MS);
export function hoyLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Lunes de la semana de la fecha */
export function inicioSemana(f: string): string {
  const dow = new Date(toMs(f)).getUTCDay(); // 0 = domingo
  return sumarDias(f, -((dow + 6) % 7));
}

// ---------- parámetros vigentes ----------
export function parametrosEn(params: ParametrosPerfil[], fecha: string): ParametrosPerfil | null {
  let elegido: ParametrosPerfil | null = null;
  for (const p of params) {
    if (p.vigente_desde <= fecha && (!elegido || p.vigente_desde > elegido.vigente_desde)) elegido = p;
  }
  // Antes del primer registro de parámetros se usa el más antiguo disponible
  if (!elegido && params.length) elegido = [...params].sort((a, b) => a.vigente_desde.localeCompare(b.vigente_desde))[0];
  return elegido;
}

export function edadEn(perfil: Pick<Perfil, 'fecha_nacimiento'>, p: ParametrosPerfil | null, fecha: string): number | null {
  if (p?.edad_fija) return p.edad_fija;
  if (!perfil.fecha_nacimiento) return null;
  const [y, m, d] = perfil.fecha_nacimiento.split('-').map(Number);
  const [fy, fm, fd] = fecha.split('-').map(Number);
  return fy - y - (fm < m || (fm === m && fd < d) ? 1 : 0);
}

// ---------- composición y basal ----------
export const imc = (peso: number, estaturaCm: number) => peso / (estaturaCm / 100) ** 2;

export function basalHarrisBenedict(sexo: 'M' | 'F', peso: number, estaturaCm: number, edad: number): number {
  return sexo === 'F'
    ? 655.0955 + 9.5634 * peso + 1.8496 * estaturaCm - 4.6756 * edad
    : 66.473 + 13.751 * peso + 5.003 * estaturaCm - 6.755 * edad; // coeficientes de la planilla
}
export const basalKatchMcArdle = (masaMagraKg: number) => 370 + 21.6 * masaMagraKg;

/** Mifflin-St Jeor (1990): más precisa que Harris-Benedict en población actual */
export function basalMifflin(sexo: 'M' | 'F', peso: number, estaturaCm: number, edad: number): number {
  return 10 * peso + 6.25 * estaturaCm - 5 * edad + (sexo === 'F' ? -161 : 5);
}

export const NOMBRE_FORMULA: Record<string, string> = {
  harris_benedict: 'Harris-Benedict', mifflin_st_jeor: 'Mifflin-St Jeor', katch_mcardle: 'Katch-McArdle',
};

// ---------- zonas de frecuencia cardíaca (Karvonen, como la planilla) ----------
export function zonasFC(fcReposo: number, fcMax: number) {
  const reserva = fcMax - fcReposo;
  const lim = (pct: number) => Math.round(reserva * pct + fcReposo);
  return [
    { zona: 'Zona 1', desde: lim(0.5), hasta: lim(0.6), descripcion: 'Conversación, actividad muy suave' },
    { zona: 'Zona 2', desde: lim(0.6), hasta: lim(0.7), descripcion: 'Caminata, recuperativo' },
    { zona: 'Zona 3', desde: lim(0.7), hasta: lim(0.8), descripcion: 'Quema de grasas' },
    { zona: 'Zona 4', desde: lim(0.8), hasta: lim(0.9), descripcion: 'Aeróbico, capacidad cardiovascular' },
    { zona: 'Zona 5', desde: lim(0.9), hasta: lim(1.0), descripcion: 'Anaeróbico, rendimiento' },
  ];
}

// ---------- modelo de ejercicio (kcal/km y kcal/h por deporte) ----------
export interface ModeloDeporte {
  deporte: Deporte;
  n: number;
  kcalKm: number | null;
  kcalH: number | null;
  errorKmProm: number | null; // error relativo medio de la estimación por km
  errorHProm: number | null;
  desvKm: number | null;
  desvH: number | null;
}
const prom = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const desv = (xs: number[]) => {
  if (xs.length < 2) return null;
  const m = prom(xs)!;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1)); // STDEV muestral
};

export function modeloEjercicio(actividades: Actividad[]): Record<Deporte, ModeloDeporte> {
  const out = {} as Record<Deporte, ModeloDeporte>;
  for (const dep of ['ciclismo', 'trote', 'natacion', 'otro'] as Deporte[]) {
    const muestras = actividades.filter((a) => a.deporte === dep && (a.kcal ?? 0) > 0 && a.duracion_min > 0);
    const conKm = muestras.filter((a) => (a.distancia_km ?? 0) > 0);
    const kcalKm = prom(conKm.map((a) => a.kcal! / a.distancia_km!));
    const kcalH = prom(muestras.map((a) => a.kcal! / (a.duracion_min / 60)));
    // Error relativo = (estimado − medido) / medido, como columnas AI/AJ de la planilla
    const errKm = kcalKm == null ? [] : conKm.map((a) => (a.distancia_km! * kcalKm - a.kcal!) / a.kcal!);
    const errH = kcalH == null ? [] : muestras.map((a) => ((a.duracion_min / 60) * kcalH - a.kcal!) / a.kcal!);
    out[dep] = {
      deporte: dep, n: muestras.length, kcalKm, kcalH,
      errorKmProm: prom(errKm), errorHProm: prom(errH), desvKm: desv(errKm), desvH: desv(errH),
    };
  }
  return out;
}

/** kcal de una actividad: la medida si existe; si no, el modelo (promedio de estimación por km y por hora). */
export function kcalActividad(a: Actividad, modelo: Record<Deporte, ModeloDeporte>): { kcal: number; estimada: boolean } {
  if (a.kcal != null && a.kcal > 0) return { kcal: a.kcal, estimada: false };
  const m = modelo[a.deporte] ?? modelo.otro;
  const est: number[] = [];
  if (m?.kcalKm && a.distancia_km) est.push(a.distancia_km * m.kcalKm);
  if (m?.kcalH && a.duracion_min) est.push((a.duracion_min / 60) * m.kcalH);
  return { kcal: est.length ? est.reduce((x, y) => x + y) / est.length : 0, estimada: est.length > 0 };
}

// ---------- serie diaria ----------
export interface Dia {
  fecha: string;
  peso: number | null;
  grasaPct: number | null; // %
  pesoOrigen: 'medido' | 'interpolado' | 'arrastrado' | null;
  imc: number | null;
  grasaKg: number | null;
  masaMagra: number | null;
  varGrasa: number | null;
  varPeso: number | null;
  varAcumulada: number | null; // pérdida desde el inicio de etapa (positivo = bajó)
  ingesta: number;
  carbosIngeridos: number;
  hayIngesta: boolean;
  edad: number | null;
  basalHB: number | null;
  basalKM: number | null;
  basalMS: number | null;
  ajusteBasalPct: number;
  basal: number | null;
  basalOrigen: 'calculado' | 'planilla' | null;
  ejercicio: number;
  ejercicioEstimado: boolean;
  gastoTotal: number | null;
  balance: number | null;
  horas: number;
  km: number;
  carbosQuemados: number;
  balanceCarbos: number | null;
  porDeporte: Record<Deporte, { kcal: number; horas: number; km: number }>;
  meta: number | null;
  mediaMovil7: number | null;
}

export interface Entradas {
  perfil: Perfil;
  parametros: ParametrosPerfil[];
  mediciones: Medicion[];
  consumos: Consumo[];
  actividades: Actividad[];
  factorCalibracion?: number; // multiplica el gasto total si se activa la autocalibración
  /** Gasto basal registrado en la planilla para días importados: se respeta tal como quedó */
  basalRegistrado?: Map<string, number>;
}

/** Peso y %grasa de cada día: medido, interpolado linealmente entre mediciones, o arrastrado tras la última. */
function seriePeso(mediciones: Medicion[], desde: string, hasta: string) {
  const ms = [...mediciones].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const mapa = new Map<string, { peso: number | null; grasa: number | null; origen: Dia['pesoOrigen'] }>();
  let i = 0;
  for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
    while (i < ms.length && ms[i].fecha < f) i++;
    const exacta = ms[i] && ms[i].fecha === f ? ms[i] : null;
    if (exacta) {
      mapa.set(f, { peso: +exacta.peso_kg, grasa: exacta.grasa_pct == null ? null : +exacta.grasa_pct,
        origen: exacta.origen === 'interpolado' ? 'interpolado' : 'medido' });
      continue;
    }
    const prev = ms[i - 1];
    const next = ms[i];
    if (prev && next && diffDias(prev.fecha, next.fecha) <= MAX_DIAS_INTERPOLACION) {
      const t = diffDias(prev.fecha, f) / diffDias(prev.fecha, next.fecha);
      const lerp = (a: number | null, b: number | null) => (a == null || b == null ? a ?? b : a + (b - a) * t);
      mapa.set(f, { peso: lerp(+prev.peso_kg, +next.peso_kg), grasa: lerp(prev.grasa_pct == null ? null : +prev.grasa_pct, next.grasa_pct == null ? null : +next.grasa_pct), origen: 'interpolado' });
    } else if (prev && diffDias(prev.fecha, f) <= MAX_DIAS_ARRASTRE) {
      mapa.set(f, { peso: +prev.peso_kg, grasa: prev.grasa_pct == null ? null : +prev.grasa_pct, origen: 'arrastrado' });
    } else {
      mapa.set(f, { peso: null, grasa: null, origen: null });
    }
  }
  return mapa;
}

export function calcularDias(e: Entradas, desde: string, hasta: string): Dia[] {
  const { perfil, parametros } = e;
  const modelo = modeloEjercicio(e.actividades);
  // Se parte una semana antes para tener media móvil y variaciones del primer día
  const inicio = sumarDias(desde, -7);
  const pesos = seriePeso(e.mediciones, inicio, hasta);

  const consumosPorDia = new Map<string, Consumo[]>();
  for (const c of e.consumos) (consumosPorDia.get(c.fecha) ?? consumosPorDia.set(c.fecha, []).get(c.fecha)!).push(c);
  const actPorDia = new Map<string, Actividad[]>();
  for (const a of e.actividades) (actPorDia.get(a.fecha) ?? actPorDia.set(a.fecha, []).get(a.fecha)!).push(a);

  // Peso de referencia para "variación acumulada"
  const medOrd = [...e.mediciones].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ref = perfil.inicio_etapa ? medOrd.find((m) => m.fecha >= perfil.inicio_etapa!) : medOrd[0];
  const pesoRef = ref ? +ref.peso_kg : null;

  const dias: Dia[] = [];
  let anterior: Dia | null = null;
  const ventana: (number | null)[] = []; // últimos 7 días calendario
  for (let f = inicio; f <= hasta; f = sumarDias(f, 1)) {
    const p = parametrosEn(parametros, f);
    const pw = pesos.get(f)!;
    const peso = pw.peso;
    const grasaPct = pw.grasa;
    const grasaKg = peso != null && grasaPct != null ? (peso * grasaPct) / 100 : null;
    const masaMagra = peso != null && grasaKg != null ? peso - grasaKg : null;
    const edad = edadEn(perfil, p, f);
    const bHB = peso != null && p && edad != null ? basalHarrisBenedict(perfil.sexo, peso, +p.estatura_cm, edad) : null;
    const bKM = masaMagra != null ? basalKatchMcArdle(masaMagra) : null;
    const bMS = peso != null && p && edad != null ? basalMifflin(perfil.sexo, peso, +p.estatura_cm, edad) : null;
    const basalReg = e.basalRegistrado?.get(f);
    const formula = p?.formula_basal === 'katch_mcardle' ? bKM ?? bHB : p?.formula_basal === 'mifflin_st_jeor' ? bMS ?? bHB : bHB ?? bKM;
    const ajuste = p?.ajuste_basal_pct ? +p.ajuste_basal_pct : 0;
    // El ajuste personal se aplica a la fórmula; el basal registrado en la planilla se respeta tal cual
    const basal = basalReg ?? (formula != null ? formula * (1 + ajuste / 100) : null);

    const cons = consumosPorDia.get(f) ?? [];
    const ingesta = cons.reduce((s, c) => s + +c.kcal_unidad * +c.cantidad, 0);
    const carbosIng = cons.reduce((s, c) => s + +c.carbos_unidad * +c.cantidad, 0);

    const porDeporte = {
      ciclismo: { kcal: 0, horas: 0, km: 0 }, trote: { kcal: 0, horas: 0, km: 0 },
      natacion: { kcal: 0, horas: 0, km: 0 }, otro: { kcal: 0, horas: 0, km: 0 },
    } as Dia['porDeporte'];
    let ejercicio = 0, horas = 0, km = 0, estimado = false;
    for (const a of actPorDia.get(f) ?? []) {
      const k = kcalActividad(a, modelo);
      const h = +a.duracion_min / 60;
      ejercicio += k.kcal; horas += h; km += +(a.distancia_km ?? 0);
      estimado ||= k.estimada;
      const d = porDeporte[a.deporte];
      d.kcal += k.kcal; d.horas += h; d.km += +(a.distancia_km ?? 0);
    }
    const gastoTotal = basal != null ? (basal + ejercicio) * (e.factorCalibracion ?? 1) : null;
    const hayIngesta = cons.length > 0;
    const carbosQuemados = horas * (p ? +p.carbos_por_hora : 40);

    ventana.push(peso != null && pw.origen !== 'arrastrado' ? peso : null);
    if (ventana.length > 7) ventana.shift();
    const enVentana = ventana.filter((x): x is number => x != null);

    const dia: Dia = {
      fecha: f, peso, grasaPct, pesoOrigen: pw.origen,
      imc: peso != null && p ? imc(peso, +p.estatura_cm) : null,
      grasaKg, masaMagra,
      varGrasa: grasaKg != null && anterior?.grasaKg != null ? grasaKg - anterior.grasaKg : null,
      varPeso: peso != null && anterior?.peso != null ? peso - anterior.peso : null,
      varAcumulada: peso != null && pesoRef != null ? pesoRef - peso : null,
      ingesta, carbosIngeridos: carbosIng, hayIngesta,
      edad, basalHB: bHB, basalKM: bKM, basalMS: bMS, ajusteBasalPct: basalReg != null ? 0 : ajuste, basal,
      basalOrigen: basalReg != null ? 'planilla' : basal != null ? 'calculado' : null,
      ejercicio, ejercicioEstimado: estimado, gastoTotal,
      balance: hayIngesta && gastoTotal != null ? ingesta - gastoTotal : null,
      horas, km, carbosQuemados,
      balanceCarbos: hayIngesta ? carbosIng - carbosQuemados : null,
      porDeporte,
      meta: p ? +p.meta_kcal : null,
      mediaMovil7: peso != null && enVentana.length ? enVentana.reduce((a, b) => a + b, 0) / enVentana.length : null,
    };
    if (f >= desde) dias.push(dia);
    anterior = dia;
  }
  return dias;
}

// ---------- cierre semanal y autocalibración ----------
export interface Semana {
  inicio: string;
  fin: string;
  diasConIngesta: number;
  deficit: number;          // kcal (positivo = déficit)
  kgTeoricos: number;       // déficit / 7.700
  varPesoReal: number | null; // kg perdidos (positivo = bajó)
  varGrasaPct: number | null; // puntos porcentuales (negativo = bajó)
  errorKg: number | null;   // real − teórico
  gastoModelo: number | null;   // gasto diario promedio según el modelo
  gastoReal: number | null;     // gasto diario implícito por la balanza
  medicionesReales: number;
}

export function resumenSemanal(dias: Dia[], mediciones: Medicion[]): Semana[] {
  const reales = new Set(mediciones.filter((m) => m.origen !== 'interpolado').map((m) => m.fecha));
  const grupos = new Map<string, Dia[]>();
  for (const d of dias) {
    const k = inicioSemana(d.fecha);
    (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(d);
  }
  const out: Semana[] = [];
  for (const [inicio, ds] of grupos) {
    const conIngesta = ds.filter((d) => d.balance != null);
    const deficit = -conIngesta.reduce((s, d) => s + d.balance!, 0) || 0;
    const primero = ds.find((d) => d.peso != null);
    const ultimo = [...ds].reverse().find((d) => d.peso != null);
    const varPeso = primero && ultimo && primero !== ultimo ? primero.peso! - ultimo.peso! : null;
    const varGrasa = primero?.grasaPct != null && ultimo?.grasaPct != null && primero !== ultimo ? ultimo.grasaPct - primero.grasaPct : null;
    const n = conIngesta.length;
    const gastoModelo = n ? conIngesta.reduce((s, d) => s + d.gastoTotal!, 0) / n : null;
    const ingestaProm = n ? conIngesta.reduce((s, d) => s + d.ingesta, 0) / n : null;
    const spanDias = primero && ultimo ? diffDias(primero.fecha, ultimo.fecha) : 0;
    const gastoReal = varPeso != null && ingestaProm != null && spanDias > 0
      ? ingestaProm + (varPeso * KCAL_POR_KG) / spanDias : null;
    out.push({
      inicio, fin: sumarDias(inicio, 6), diasConIngesta: n, deficit,
      kgTeoricos: deficit / KCAL_POR_KG, varPesoReal: varPeso, varGrasaPct: varGrasa,
      errorKg: varPeso != null && n ? varPeso - deficit / KCAL_POR_KG : null,
      gastoModelo, gastoReal,
      medicionesReales: ds.filter((d) => reales.has(d.fecha)).length,
    });
  }
  return out.sort((a, b) => b.inicio.localeCompare(a.inicio));
}

/**
 * Factor de autocalibración: cociente entre el gasto real implícito y el gasto del modelo,
 * usando solo semanas con ≥ 5 días de ingesta y ≥ 2 mediciones reales (no interpoladas).
 * Se acota a [0,8 ; 1,2] para evitar que una semana anómala distorsione el cálculo.
 */
export function factorCalibracion(semanas: Semana[], maxSemanas = 8): { factor: number; semanasUsadas: number } {
  const validas = semanas
    .filter((s) => s.diasConIngesta >= 5 && s.medicionesReales >= 2 && s.gastoReal != null && s.gastoModelo)
    .slice(0, maxSemanas);
  if (validas.length < 2) return { factor: 1, semanasUsadas: validas.length };
  const real = validas.reduce((a, s) => a + s.gastoReal!, 0);
  const mod = validas.reduce((a, s) => a + s.gastoModelo!, 0);
  return { factor: Math.min(1.2, Math.max(0.8, real / mod)), semanasUsadas: validas.length };
}
