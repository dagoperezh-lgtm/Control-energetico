/**
 * Verificación contra la planilla original. Requiere la ruta del archivo en PLANILLA:
 *   PLANILLA=/ruta/Seguimiento.xlsx npx vitest run
 * Sin el archivo, solo corren las pruebas unitarias.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { basalHarrisBenedict, basalKatchMcArdle, basalMifflin, calcularDias, imc, modeloEjercicio, resumenSemanal, zonasFC } from './calc';
import { importarPlanilla } from './importador';
import type { Perfil } from './types';

describe('fórmulas', () => {
  it('Harris-Benedict reproduce la planilla (86,6 kg, 167 cm, 51 años → 1.748,3 kcal)', () => {
    expect(basalHarrisBenedict('M', 86.6, 167, 51)).toBeCloseTo(1748.3056, 3);
  });
  it('Katch-McArdle', () => expect(basalKatchMcArdle(58.9746)).toBeCloseTo(1643.85, 1));
  it('IMC con estatura 1,67 m', () => expect(imc(86.6, 167)).toBeCloseTo(31.0517, 3));
  it('zonas Karvonen (39/166)', () => {
    const z = zonasFC(39, 166);
    expect(z[0].desde).toBe(Math.round(127 * 0.5 + 39));
    expect(z[4].hasta).toBe(166);
  });
});

const ruta = process.env.PLANILLA;
describe.skipIf(!ruta || !existsSync(ruta))('planilla real', () => {
  it('importa y recalcula consistente con la hoja Datos', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ruta!);
    const res = importarPlanilla(wb);
    console.log('Resumen importación', res.resumen);
    console.log('Parámetros', res.parametros);
    expect(res.resumen.filas).toBeGreaterThan(200);

    const perfil: Perfil = { id: 'x', nombre: 'Dago', sexo: 'M', fecha_nacimiento: null, inicio_etapa: '2020-05-13', es_admin: true };
    const entradas = {
      perfil, parametros: res.parametros, mediciones: res.mediciones,
      consumos: res.consumos.map((c, i) => ({ ...c, id: i })), actividades: res.actividades,
    };
    const dias = calcularDias(entradas, res.resumen.desde!, res.resumen.hasta!);
    const basalRegistrado = new Map(res.historico.filter((h) => typeof h.datos.gasto_basal === 'number').map((h) => [h.fecha, h.datos.gasto_basal as number]));
    const diasReg = calcularDias({ ...entradas, basalRegistrado }, res.resumen.desde!, res.resumen.hasta!);
    let nBal = 0, nDif = 0;
    for (const h of res.historico) {
      const d = diasReg.find((x) => x.fecha === h.fecha)!;
      if (typeof h.datos.balance_calorias === 'number' && d.balance != null && typeof h.datos.calorias_quemadas === 'number' && h.datos.calorias_quemadas >= 0) {
        nBal++; if (Math.abs(h.datos.balance_calorias - d.balance) > 1) nDif++;
      }
    }
    console.log('Balance con basal registrado: días', nBal, 'con diferencia > 1 kcal', nDif);
    // 2021-05-03: la planilla registra 0 kcal de ejercicio pese a tener tiempo y km; la app lo estima con el modelo
    expect(nDif).toBeLessThanOrEqual(1);
    const porFecha = new Map(dias.map((d) => [d.fecha, d]));

    // Comparación día a día con los valores calculados por Excel
    let comparados = 0, difBasal = 0, difImc = 0, difBalance = 0;
    const malos: string[] = [];
    for (const h of res.historico) {
      const d = porFecha.get(h.fecha)!;
      const x = h.datos;
      if (typeof x.imc === 'number' && d.imc != null && h.fecha >= '2020-05-13') {
        difImc = Math.max(difImc, Math.abs(x.imc - d.imc));
      }
      if (typeof x.gasto_basal === 'number' && d.basal != null && h.fecha >= '2020-05-13') {
        const delta = Math.abs(x.gasto_basal - d.basal);
        difBasal = Math.max(difBasal, delta);
        if (delta > 5) malos.push(`${h.fecha} basal excel ${x.gasto_basal.toFixed(1)} app ${d.basal.toFixed(1)}`);
        comparados++;
      }
      if (typeof x.balance_calorias === 'number' && d.balance != null && typeof x.calorias_quemadas === 'number' && x.calorias_quemadas >= 0
          && typeof x.gasto_basal === 'number' && Math.abs(x.gasto_basal - (d.basal ?? 0)) < 1) {
        difBalance = Math.max(difBalance, Math.abs(x.balance_calorias - d.balance));
      }
    }
    console.log({ comparados, difImc, difBasal, difBalance, basalDistinto: malos.length, ejemplos: malos.slice(0, 8) });
    expect(difImc).toBeLessThan(0.01);

    const modelo = modeloEjercicio(res.actividades);
    console.log('Modelo ejercicio', modelo);
    const semanas = resumenSemanal(dias, res.mediciones).slice(0, 4);
    console.log('Últimas semanas', semanas);
  });
});

describe('ajustes del gasto basal', () => {
  it('Mifflin-St Jeor distingue por sexo', () => {
    expect(basalMifflin('M', 80, 167, 57)).toBeCloseTo(10 * 80 + 6.25 * 167 - 5 * 57 + 5, 6);
    expect(basalMifflin('M', 80, 167, 57) - basalMifflin('F', 80, 167, 57)).toBe(166);
  });
  it('aplica el ajuste personal solo desde su vigencia', () => {
    const perfil: Perfil = { id: 'x', nombre: '', sexo: 'M', fecha_nacimiento: '1969-08-01', inicio_etapa: null, es_admin: false };
    const base = { estatura_cm: 167, carbos_por_hora: 40, meta_kcal: 1500, fc_reposo: null, fc_maxima: null, edad_fija: null };
    const parametros = [
      { ...base, vigente_desde: '2026-01-01', formula_basal: 'mifflin_st_jeor' as const, ajuste_basal_pct: 0 },
      { ...base, vigente_desde: '2026-02-01', formula_basal: 'mifflin_st_jeor' as const, ajuste_basal_pct: -10 },
    ];
    const mediciones = [{ fecha: '2026-01-31', peso_kg: 80, grasa_pct: 25, origen: 'manual' as const }, { fecha: '2026-02-01', peso_kg: 80, grasa_pct: 25, origen: 'manual' as const }];
    const dias = calcularDias({ perfil, parametros, mediciones, consumos: [], actividades: [] }, '2026-01-31', '2026-02-01');
    expect(dias[1].basal! / dias[0].basal!).toBeCloseTo(0.9, 3);
    expect(dias[1].ajusteBasalPct).toBe(-10);
  });
});
