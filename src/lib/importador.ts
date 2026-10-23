/**
 * Importador de la planilla "Seguimiento peso" (formato versión 5).
 * Lee los valores calculados (en caché) de las hojas:
 *   - Datos               → mediciones, ingesta diaria, entrenamientos y archivo íntegro por fecha
 *   - Gasto Basal         → estatura y edad vigentes por fecha
 *   - Zonas Frec Cardiaca → FC de reposo y máxima
 *   - Alimentos Ingeridas → carbos por hora y meta diaria
 *   - BD Alimento         → catálogo de alimentos
 * Cada dato queda etiquetado con su calidad: medido, interpolado, repetido o inválido.
 */
import type ExcelJS from 'exceljs';
import type { Actividad, Alimento, Consumo, Medicion, ParametrosPerfil } from './types';

const BASE_EXCEL = Date.UTC(1899, 11, 30);

type Celda = ExcelJS.CellValue;
function valor(v: Celda): number | string | Date | null {
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('error' in v) return null;
    if ('result' in v) return valor(v.result as Celda);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    return null;
  }
  return v as number | string | Date;
}
function num(v: Celda): number | null {
  const x = valor(v);
  if (typeof x === 'number' && Number.isFinite(x)) return x;
  if (typeof x === 'string' && x.trim() !== '' && !Number.isNaN(+x.replace(',', '.'))) return +x.replace(',', '.');
  return null;
}
function fecha(v: Celda): string | null {
  const x = valor(v);
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === 'number') return new Date(BASE_EXCEL + x * 86_400_000).toISOString().slice(0, 10);
  return null;
}
/** Duración en horas: celdas con formato de hora (Date) o fracción de día (número) */
function horas(v: Celda): number | null {
  const x = valor(v);
  if (x instanceof Date) return (x.getTime() - BASE_EXCEL) / 3_600_000;
  if (typeof x === 'number') return x * 24;
  return null;
}
const decimalesLargos = (x: number, d: number) => Math.abs(x * 10 ** d - Math.round(x * 10 ** d)) > 1e-6;

export interface FilaHistorica {
  fecha: string;
  datos: Record<string, number | string | null>;
  calidad: Record<string, string>;
}

export interface ResultadoImportacion {
  mediciones: Medicion[];
  consumos: Consumo[];
  actividades: Actividad[];
  parametros: ParametrosPerfil[];
  alimentos: Alimento[];
  historico: FilaHistorica[];
  resumen: {
    filas: number; desde: string | null; hasta: string | null;
    pesosMedidos: number; pesosInterpolados: number; ingestasRepetidas: number;
    ejercicioNegativo: number; errores: number; diasConIngesta: number; actividades: number; alimentos: number;
  };
}

// Columnas de la hoja Datos (fila 2/3 de encabezados)
const COLS: [string, number][] = [
  ['fecha', 1], ['peso_kg', 2], ['grasa_frac', 3], ['imc', 4], ['grasa_kg', 5], ['masa_magra_kg', 6],
  ['var_grasa_kg', 7], ['var_peso_kg', 8], ['var_acumulada_kg', 9], ['calorias_ingeridas', 10],
  ['gasto_basal', 11], ['calorias_quemadas', 12], ['gasto_total', 13], ['balance_calorias', 14],
  ['balance_carbos_g', 15], ['tiempo_h', 16], ['distancia_km', 17],
  ['ciclismo_kcal', 18], ['ciclismo_h', 19], ['ciclismo_km', 20],
  ['trote_kcal', 21], ['trote_h', 22], ['trote_km', 23],
  ['natacion_kcal', 24], ['natacion_h', 25], ['natacion_km', 26],
  ['semana_deficit_kcal', 27], ['semana_var_peso_kg', 28], ['semana_var_grasa', 29],
  ['cal_x_km', 30], ['tiempo_dec_h', 31], ['cal_x_h', 32], ['estimacion_x_km', 33], ['estimacion_x_h', 34],
  ['error_x_km', 35], ['error_x_h', 36],
];
const COLS_HORA = new Set([16, 19, 22, 25]);

export function importarPlanilla(wb: ExcelJS.Workbook): ResultadoImportacion {
  const hoja = (nombre: string) => wb.worksheets.find((w) => w.name.trim().toLowerCase() === nombre.toLowerCase());
  const datos = hoja('Datos');
  if (!datos) {
    const soloAlimentos = !!hoja('BD Alimento');
    throw new Error(soloAlimentos
      ? 'Este archivo solo trae alimentos (hoja "BD Alimento"). Cárguelo en Más → Alimentos → "Carga masiva desde Excel".'
      : 'No se encontró la hoja "Datos". Verifique que sea la planilla de seguimiento de peso.');
  }

  // ---- parámetros generales ----
  const ai = hoja('Alimentos Ingeridas');
  const carbosHora = (ai && num(ai.getCell('Q2').value)) || 40;
  const meta = (ai && num(ai.getCell('F31').value)) || 1200;
  const zf = hoja('Zonas Frec Cardiaca');
  const fcReposo = zf ? num(zf.getCell('B3').value) : null;
  const fcMax = zf ? num(zf.getCell('B4').value) : null;

  const parametros: ParametrosPerfil[] = [];
  const gb = hoja('Gasto Basal');
  if (gb) {
    let previo = '';
    for (let r = 4; r <= gb.rowCount; r++) {
      const f = fecha(gb.getCell(r, 1).value);
      const est = num(gb.getCell(r, 3).value);
      const edad = num(gb.getCell(r, 4).value);
      if (!f || !est) continue;
      const clave = `${est}|${edad}`;
      if (clave !== previo) {
        parametros.push({
          vigente_desde: f, estatura_cm: est, formula_basal: 'harris_benedict', carbos_por_hora: carbosHora,
          meta_kcal: meta, fc_reposo: fcReposo, fc_maxima: fcMax, edad_fija: edad,
          nota: 'Importado de la planilla (hoja Gasto Basal)',
        });
        previo = clave;
      }
    }
  }

  // ---- hoja Datos ----
  const mediciones: Medicion[] = [];
  const consumos: Consumo[] = [];
  const actividades: Actividad[] = [];
  const historico: FilaHistorica[] = [];
  const r = { pesosMedidos: 0, pesosInterpolados: 0, ingestasRepetidas: 0, ejercicioNegativo: 0, errores: 0, diasConIngesta: 0 };
  let ingestaAnterior: number | null = null;
  const vistos = new Set<string>();

  for (let fila = 4; fila <= datos.rowCount; fila++) {
    const f = fecha(datos.getCell(fila, 1).value);
    if (!f || vistos.has(f)) continue;
    vistos.add(f);

    const d: Record<string, number | string | null> = {};
    const calidad: Record<string, string> = {};
    for (const [nombre, col] of COLS) {
      const raw = datos.getCell(fila, col).value;
      if (raw && typeof raw === 'object' && 'error' in (raw as object)) {
        d[nombre] = String((raw as { error: string }).error);
        calidad[nombre] = 'error_formula';
        r.errores++;
        continue;
      }
      d[nombre] = col === 1 ? f : COLS_HORA.has(col) ? horas(raw) : num(raw);
    }

    // Peso y grasa
    const peso = d.peso_kg as number | null;
    const grasaFrac = d.grasa_frac as number | null;
    if (peso && peso > 0) {
      const interpolado = decimalesLargos(peso, 1) || (grasaFrac != null && decimalesLargos(grasaFrac, 4));
      calidad.peso = interpolado ? 'interpolado' : 'medido';
      interpolado ? r.pesosInterpolados++ : r.pesosMedidos++;
      mediciones.push({
        fecha: f, peso_kg: Math.round(peso * 100) / 100,
        grasa_pct: grasaFrac != null ? Math.round(grasaFrac * 10000) / 100 : null,
        origen: interpolado ? 'interpolado' : 'importado',
      });
    }

    // Ingesta del día (la planilla guarda solo el total diario)
    const ingesta = d.calorias_ingeridas as number | null;
    const horasEntreno = (d.tiempo_h as number | null) ?? 0;
    if (ingesta && ingesta > 0) {
      r.diasConIngesta++;
      const repetida = ingestaAnterior != null && Math.abs(ingesta - ingestaAnterior) < 0.01;
      if (repetida) { calidad.ingesta = 'repetida_dia_anterior'; r.ingestasRepetidas++; }
      // Carbos ingeridos = balance de carbos + horas × carbos/h (inverso de la fórmula de la planilla)
      const balC = d.balance_carbos_g as number | null;
      const carbos = balC != null ? Math.max(0, balC + horasEntreno * carbosHora) : 0;
      consumos.push({
        fecha: f, comida: 'total_dia', alimento_id: null,
        nombre: repetida ? 'Total del día (planilla, posible copia del día anterior)' : 'Total del día (planilla)',
        kcal_unidad: Math.round(ingesta * 10) / 10, carbos_unidad: Math.round(carbos * 10) / 10,
        cantidad: 1, origen: 'importado',
      });
    }
    ingestaAnterior = ingesta && ingesta > 0 ? ingesta : null;

    // Entrenamiento por deporte; si no hay desglose se registra el agregado como "otro"
    const quemadas = d.calorias_quemadas as number | null;
    if (quemadas != null && quemadas < 0) { calidad.ejercicio = 'negativo_descartado'; r.ejercicioNegativo++; }
    let conDesglose = false;
    for (const dep of ['ciclismo', 'trote', 'natacion'] as const) {
      const kcal = d[`${dep}_kcal`] as number | null;
      const h = d[`${dep}_h`] as number | null;
      const km = d[`${dep}_km`] as number | null;
      if ((kcal ?? 0) > 0 || (h ?? 0) > 0 || (km ?? 0) > 0) {
        conDesglose = true;
        actividades.push({
          fecha: f, deporte: dep, duracion_min: Math.round((h ?? 0) * 600) / 10,
          distancia_km: km, kcal: kcal && kcal > 0 ? kcal : null, fc_media: null, origen: 'importado',
        });
      }
    }
    if (!conDesglose && ((quemadas ?? 0) > 0 || horasEntreno > 0)) {
      actividades.push({
        fecha: f, deporte: 'otro', duracion_min: Math.round(horasEntreno * 600) / 10,
        distancia_km: (d.distancia_km as number | null) || null,
        kcal: quemadas && quemadas > 0 ? Math.round(quemadas * 10) / 10 : null,
        fc_media: null, origen: 'importado', nota: 'Planilla sin desglose por deporte',
      });
    }

    historico.push({ fecha: f, datos: d, calidad });
  }

  // ---- catálogo ----
  const alimentos: Alimento[] = [];
  const bd = hoja('BD Alimento');
  if (bd) {
    const nombres = new Set<string>();
    for (let fila = 3; fila <= bd.rowCount; fila++) {
      const nombreRaw = valor(bd.getCell(fila, 2).value);
      const kcal = num(bd.getCell(fila, 3).value);
      if (typeof nombreRaw !== 'string' || !nombreRaw.trim() || kcal == null) continue;
      const nombre = nombreRaw.trim().replace(/\s+/g, ' ');
      if (nombres.has(nombre.toLowerCase())) continue;
      nombres.add(nombre.toLowerCase());
      alimentos.push({
        alcance: 'personal', nombre, kcal, carbos_g: num(bd.getCell(fila, 4).value) ?? 0,
        porcion: '100 g', fuente: 'planilla',
      });
    }
  }

  const fechas = historico.map((h) => h.fecha).sort();
  return {
    mediciones, consumos, actividades, parametros, alimentos, historico,
    resumen: {
      filas: historico.length, desde: fechas[0] ?? null, hasta: fechas[fechas.length - 1] ?? null,
      ...r, actividades: actividades.length, alimentos: alimentos.length,
    },
  };
}
