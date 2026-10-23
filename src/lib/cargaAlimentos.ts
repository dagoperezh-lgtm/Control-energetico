/**
 * Carga masiva de alimentos desde Excel con el formato de la hoja "BD Alimento" de la planilla:
 *   fila de encabezados con  Comida | Cal | Carbs  (y opcionalmente Porción | Código de barras)
 * Los encabezados se buscan en las primeras 15 filas y en cualquier columna, así que también
 * sirven otras planillas con esas columnas. Se prefiere la hoja "BD Alimento"; si no existe,
 * se usa la primera hoja que tenga encabezados reconocibles.
 */
import type ExcelJS from 'exceljs';
import type { Alimento } from './types';
import { normalizar } from './fuentesAlimentos';

export interface FilaAlimento {
  fila: number;          // número de fila en el Excel
  nombre: string;
  kcal: number;
  carbos_g: number;
  porcion: string;
  codigo_barra: string | null;
}
export interface ErrorFila { fila: number; texto: string; motivo: string }

export interface LecturaCatalogo {
  hoja: string;
  filas: FilaAlimento[];
  errores: ErrorFila[];
  repetidasEnArchivo: number;
}

const SINONIMOS: Record<'nombre' | 'kcal' | 'carbos' | 'porcion' | 'codigo', string[]> = {
  nombre: ['comida', 'alimento', 'nombre', 'producto'],
  kcal: ['cal', 'kcal', 'calorias', 'energia'],
  carbos: ['carbs', 'carbos', 'carbohidratos', 'hidratos', 'hc'],
  porcion: ['porcion', 'unidad', 'medida'],
  codigo: ['codigo de barras', 'codigo', 'barra', 'ean', 'barcode'],
};

function texto(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return texto(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
  }
  return String(v);
}
function numero(v: ExcelJS.CellValue): number | null {
  const t = texto(v).trim().replace(/\s/g, '');
  if (!t) return null;
  // Acepta 1.234,5 / 1234,5 / 1234.5
  const norm = /,\d+$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  const x = Number(norm);
  return Number.isFinite(x) ? x : null;
}

function buscarEncabezados(ws: ExcelJS.Worksheet) {
  for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
    const cols: Partial<Record<keyof typeof SINONIMOS, number>> = {};
    const fila = ws.getRow(r);
    for (let c = 1; c <= Math.min(30, ws.columnCount || 30); c++) {
      const h = normalizar(texto(fila.getCell(c).value)).trim();
      if (!h) continue;
      for (const [campo, sins] of Object.entries(SINONIMOS) as [keyof typeof SINONIMOS, string[]][]) {
        if (cols[campo] == null && sins.some((s) => h === s || h.startsWith(s + ' ') || h.startsWith(s + '('))) { cols[campo] = c; break; }
      }
    }
    if (cols.nombre && cols.kcal) return { fila: r, cols };
  }
  return null;
}

export function leerCatalogo(wb: ExcelJS.Workbook): LecturaCatalogo {
  const hojas = [...wb.worksheets].sort((a, b) =>
    (normalizar(b.name).trim() === 'bd alimento' ? 1 : 0) - (normalizar(a.name).trim() === 'bd alimento' ? 1 : 0));
  for (const ws of hojas) {
    const enc = buscarEncabezados(ws);
    if (!enc) continue;
    const { cols } = enc;
    const porNombre = new Map<string, FilaAlimento>();
    const errores: ErrorFila[] = [];
    let repetidas = 0;
    for (let r = enc.fila + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const nombre = texto(row.getCell(cols.nombre!).value).trim().replace(/\s+/g, ' ');
      const kcalRaw = row.getCell(cols.kcal!).value;
      if (!nombre && texto(kcalRaw).trim() === '') continue; // fila vacía
      const kcal = numero(kcalRaw);
      const carbos = cols.carbos ? numero(row.getCell(cols.carbos).value) : 0;
      if (!nombre) { errores.push({ fila: r, texto: texto(kcalRaw), motivo: 'Sin nombre' }); continue; }
      if (kcal == null || kcal < 0) { errores.push({ fila: r, texto: nombre, motivo: 'kcal vacías o no numéricas' }); continue; }
      if (cols.carbos && texto(row.getCell(cols.carbos).value).trim() !== '' && carbos == null) {
        errores.push({ fila: r, texto: nombre, motivo: 'Carbos no numéricos' }); continue;
      }
      const clave = normalizar(nombre);
      if (porNombre.has(clave)) repetidas++;
      porNombre.set(clave, {
        fila: r, nombre, kcal, carbos_g: carbos ?? 0,
        porcion: (cols.porcion && texto(row.getCell(cols.porcion).value).trim()) || '1 porción',
        codigo_barra: (cols.codigo && texto(row.getCell(cols.codigo).value).trim()) || null,
      });
    }
    return { hoja: ws.name.trim(), filas: [...porNombre.values()], errores, repetidasEnArchivo: repetidas };
  }
  throw new Error('No se encontró una hoja con encabezados "Comida" y "Cal". Use la plantilla o el formato de la hoja BD Alimento.');
}

export interface Clasificacion {
  nuevos: FilaAlimento[];
  sinCambios: FilaAlimento[];
  conCambios: { fila: FilaAlimento; actual: Alimento; editable: boolean }[];
}

/** Compara con el catálogo visible: nuevo, igual o con valores distintos */
export function clasificar(filas: FilaAlimento[], catalogo: Alimento[], uid: string, esAdmin: boolean): Clasificacion {
  const porNombre = new Map<string, Alimento>();
  // Prioridad: el propio > compartido > otros
  for (const a of catalogo) {
    const k = normalizar(a.nombre);
    const prev = porNombre.get(k);
    if (!prev || (a.propietario === uid && prev.propietario !== uid) || (a.alcance === 'compartido' && prev.alcance !== 'compartido' && prev.propietario !== uid)) porNombre.set(k, a);
  }
  const out: Clasificacion = { nuevos: [], sinCambios: [], conCambios: [] };
  for (const f of filas) {
    const a = porNombre.get(normalizar(f.nombre));
    if (!a) { out.nuevos.push(f); continue; }
    const igual = Math.abs(+a.kcal - f.kcal) < 0.05 && Math.abs(+a.carbos_g - f.carbos_g) < 0.05;
    if (igual) out.sinCambios.push(f);
    else out.conCambios.push({ fila: f, actual: a, editable: esAdmin || (a.propietario === uid && a.alcance !== 'compartido') });
  }
  return out;
}

/** Plantilla con el mismo diseño de la hoja BD Alimento de la planilla original */
export async function descargarPlantilla() {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('BD Alimento');
  ws.getCell('B1').value = 'Tabla Calorías';
  ws.getCell('B1').font = { bold: true, size: 14 };
  ws.getRow(2).values = [null, 'Comida', 'Cal', 'Carbs', 'Porción', 'Código de barras'];
  ws.getRow(2).font = { bold: true };
  ws.getRow(2).eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F0E7' } }; });
  const ejemplos: [string, number, number, string, string][] = [
    ['Marraqueta (unidad)', 270, 55, '1 unidad (100 g)', ''],
    ['Palta Hass (1/2 unidad)', 160, 8.5, '1/2 unidad', ''],
    ['Completo italiano', 520, 45, '1 unidad', ''],
  ];
  ejemplos.forEach((e, i) => { ws.getRow(3 + i).values = [null, ...e]; });
  ws.getColumn(2).width = 40; ws.getColumn(3).width = 10; ws.getColumn(4).width = 10; ws.getColumn(5).width = 20; ws.getColumn(6).width = 18;
  ws.getCell('H2').value = 'Instrucciones';
  ws.getCell('H2').font = { bold: true };
  [
    'Una fila por alimento. Obligatorios: Comida y Cal.',
    'Cal y Carbs son por porción (lo que se descuenta al registrar 1 unidad).',
    'Porción y Código de barras son opcionales.',
    'Borre las filas de ejemplo antes de cargar.',
    'Si un nombre ya existe, la app ofrece actualizar sus valores.',
  ].forEach((t, i) => { ws.getCell(`H${3 + i}`).value = t; });
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = 'plantilla-alimentos.xlsx';
  a.click();
  URL.revokeObjectURL(a.href);
}
