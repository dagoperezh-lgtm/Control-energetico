/** Porción base y fracciones de porción */

export const PORCION_BASE = '100 g';

export const FRACCIONES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

const SIMBOLOS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾', '0.33': '⅓', '0.67': '⅔' };

/** 0,5 → "½"; 1,75 → "1¾"; 1,2 → "1,2" */
export function fraccion(x: number): string {
  const entero = Math.floor(x + 1e-9);
  const resto = Math.round((x - entero) * 100) / 100;
  if (resto === 0) return String(entero);
  const s = SIMBOLOS[String(resto)];
  if (s) return entero ? `${entero}${s}` : s;
  return x.toLocaleString('es-CL', { maximumFractionDigits: 2 });
}

/** Si la porción es una medida (100 g, 250 ml), devuelve el total equivalente: 1,5 × 100 g → "150 g" */
export function equivalencia(porcion: string | null | undefined, cantidad: number): string | null {
  const m = porcion?.trim().match(/^(\d+(?:[.,]\d+)?)\s*(g|gr|grs|gramos|ml|cc|kg|l)\b/i);
  if (!m) return null;
  const total = parseFloat(m[1].replace(',', '.')) * cantidad;
  const unidad = m[2].toLowerCase().startsWith('g') ? 'g' : m[2].toLowerCase() === 'cc' ? 'ml' : m[2].toLowerCase();
  return `${total.toLocaleString('es-CL', { maximumFractionDigits: 1 })} ${unidad}`;
}

/** Texto de cantidad para listas: "½ × 100 g (50 g)" o "1¾ × 1 plato" */
export function textoCantidad(cantidad: number, porcion?: string | null): string {
  if (!porcion) return `${fraccion(cantidad)} ${cantidad === 1 ? 'porción' : 'porciones'}`;
  const eq = equivalencia(porcion, cantidad);
  return `${fraccion(cantidad)} × ${porcion}${eq && cantidad !== 1 ? ` = ${eq}` : ''}`;
}

/** Paso de los botones − / +: de a ¼ bajo 1 porción, de a ½ hasta 3, luego de a 1 */
export function siguiente(cantidad: number, dir: 1 | -1): number {
  const paso = (c: number) => (c < 1 ? 0.25 : c < 3 ? 0.5 : 1);
  const p = dir > 0 ? paso(cantidad) : paso(cantidad - 0.001);
  return Math.max(0, Math.round((cantidad + dir * p) * 100) / 100);
}
