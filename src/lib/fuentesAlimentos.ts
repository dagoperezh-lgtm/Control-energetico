/**
 * Fuentes externas de alimentos:
 *  - Open Food Facts: productos envasados, búsqueda por nombre y por código de barras (sin clave).
 *  - USDA FoodData Central: alimentos genéricos crudos. Usa DEMO_KEY (límite bajo de consultas);
 *    se puede definir VITE_USDA_API_KEY con una clave gratuita propia.
 * Los valores se normalizan a "100 g" salvo que el producto declare porción.
 */
import type { Alimento } from './types';

export interface ResultadoExterno {
  nombre: string;
  kcal: number;
  carbos_g: number;
  porcion: string;
  fuente: 'openfoodfacts' | 'usda';
  codigo_barra?: string;
  ref_externa: string;
  detalle?: string;
}

const OFF = 'https://world.openfoodfacts.org';

function desdeOFF(p: any): ResultadoExterno | null {
  const nut = p?.nutriments ?? {};
  const kcal100 = nut['energy-kcal_100g'] ?? (nut['energy_100g'] ? nut['energy_100g'] / 4.184 : null);
  if (kcal100 == null || !p.product_name) return null;
  return {
    nombre: [p.product_name, p.brands?.split(',')[0]].filter(Boolean).join(' — '),
    kcal: Math.round(kcal100 * 10) / 10,
    carbos_g: Math.round((nut['carbohydrates_100g'] ?? 0) * 10) / 10,
    porcion: '100 g',
    fuente: 'openfoodfacts',
    codigo_barra: p.code,
    ref_externa: p.code,
    detalle: p.serving_size ? `Porción declarada: ${p.serving_size}` : undefined,
  };
}

export async function buscarOFF(texto: string): Promise<ResultadoExterno[]> {
  const url = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(texto)}&search_simple=1&action=process&json=1&page_size=20&fields=code,product_name,brands,nutriments,serving_size&lc=es`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open Food Facts respondió ${r.status}`);
  const j = await r.json();
  return (j.products ?? []).map(desdeOFF).filter(Boolean) as ResultadoExterno[];
}

export async function buscarCodigoBarra(codigo: string): Promise<ResultadoExterno | null> {
  const r = await fetch(`${OFF}/api/v2/product/${encodeURIComponent(codigo)}.json?fields=code,product_name,brands,nutriments,serving_size`);
  if (!r.ok) return null;
  const j = await r.json();
  return j.status === 1 ? desdeOFF(j.product) : null;
}

export async function buscarUSDA(texto: string): Promise<ResultadoExterno[]> {
  const key = (import.meta.env.VITE_USDA_API_KEY as string | undefined) || 'DEMO_KEY';
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${key}&query=${encodeURIComponent(texto)}&pageSize=20&dataType=Foundation,SR%20Legacy`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`USDA respondió ${r.status}`);
  const j = await r.json();
  return (j.foods ?? []).map((f: any) => {
    const nut = (num: string) => f.foodNutrients?.find((x: any) => x.nutrientNumber === num)?.value;
    const kcal = nut('208') ?? nut('957') ?? nut('958');
    if (kcal == null) return null;
    return {
      nombre: f.description, kcal: Math.round(kcal * 10) / 10, carbos_g: Math.round((nut('205') ?? 0) * 10) / 10,
      porcion: '100 g', fuente: 'usda', ref_externa: String(f.fdcId), detalle: 'USDA (nombre en inglés)',
    } as ResultadoExterno;
  }).filter(Boolean);
}

export const aAlimento = (r: ResultadoExterno): Alimento => ({
  alcance: 'personal', nombre: r.nombre, kcal: r.kcal, carbos_g: r.carbos_g, porcion: r.porcion,
  fuente: r.fuente, codigo_barra: r.codigo_barra ?? null, ref_externa: r.ref_externa,
});

/** Normaliza para búsqueda sin tildes ni mayúsculas */
export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
