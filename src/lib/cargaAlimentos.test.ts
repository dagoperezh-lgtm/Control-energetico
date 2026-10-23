import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { clasificar, leerCatalogo } from './cargaAlimentos';
import type { Alimento } from './types';

describe('carga masiva de alimentos', () => {
  it('lee el formato BD Alimento con encabezados desplazados, decimales con coma y errores', () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Otra').getCell('A1').value = 'nada';
    const ws = wb.addWorksheet(' BD Alimento');
    ws.getCell('B1').value = 'Tabla Calorías';
    ws.getRow(2).values = [null, 'Comida', 'Cal', 'Carbs', 'Porción'];
    ws.getRow(3).values = [null, 'Pan Marraqueta', 270, 55, '1 unidad'];
    ws.getRow(4).values = [null, 'Palta  Hass', '160,5', '8,5'];
    ws.getRow(5).values = [null, 'Sin calorías', '', 3];
    ws.getRow(6).values = [null, 'Té', 'abc', 0];
    ws.getRow(8).values = [null, 'pan marraqueta', 280, 56];
    const r = leerCatalogo(wb);
    expect(r.hoja).toBe('BD Alimento');
    expect(r.filas.map((f) => [f.nombre, f.kcal, f.carbos_g])).toEqual([['pan marraqueta', 280, 56], ['Palta Hass', 160.5, 8.5]]);
    expect(r.errores).toHaveLength(2);
    expect(r.repetidasEnArchivo).toBe(1);
  });

  it('clasifica nuevos, iguales y con cambios según permisos', () => {
    const cat: Alimento[] = [
      { id: 1, nombre: 'Pan Marraqueta', kcal: 270, carbos_g: 55, alcance: 'compartido', propietario: 'otro', porcion: '1', fuente: 'planilla' },
      { id: 2, nombre: 'Palta Hass', kcal: 160.5, carbos_g: 8.5, alcance: 'personal', propietario: 'yo', porcion: '1', fuente: 'propia' },
    ];
    const filas = [
      { fila: 3, nombre: 'pan marraqueta', kcal: 280, carbos_g: 56, porcion: '1', codigo_barra: null },
      { fila: 4, nombre: 'Palta Hass', kcal: 160.5, carbos_g: 8.5, porcion: '1', codigo_barra: null },
      { fila: 5, nombre: 'Queso fresco', kcal: 90, carbos_g: 1, porcion: '30 g', codigo_barra: null },
    ];
    const c = clasificar(filas, cat, 'yo', false);
    expect(c.nuevos.map((f) => f.nombre)).toEqual(['Queso fresco']);
    expect(c.sinCambios).toHaveLength(1);
    expect(c.conCambios[0].editable).toBe(false);
    expect(clasificar(filas, cat, 'yo', true).conCambios[0].editable).toBe(true);
  });

  const ruta = '/home/claude/work/peso.xlsx';
  it.skipIf(!existsSync(ruta))('lee la planilla original completa', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ruta);
    const r = leerCatalogo(wb);
    expect(r.filas.length).toBe(233);
  });
});
