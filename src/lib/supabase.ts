import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const CLAVE_LOCAL = 'control-peso.supabase';

/** Configuración: variables de entorno del build (GitHub Actions) o, si faltan, la ingresada en la pantalla de configuración. */
/**
 * Deja solo el origen del proyecto (https://xxxx.supabase.co).
 * La consola de Supabase muestra a veces la URL con /rest/v1/ u otra ruta; el cliente necesita la base.
 */
export function normalizarUrl(u: string): string {
  let s = u.trim().replace(/^["']|["']$/g, '');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try { return new URL(s).origin; } catch { return s.replace(/\/+$/, ''); }
}

export function leerConfig(): { url: string; anonKey: string } | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim().replace(/^["']|["']$/g, '');
  if (url && anonKey) return { url: normalizarUrl(url), anonKey };
  try {
    const raw = localStorage.getItem(CLAVE_LOCAL);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return { url: normalizarUrl(c.url), anonKey: c.anonKey.trim() };
  } catch {
    return null;
  }
}

export function guardarConfig(url: string, anonKey: string) {
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify({ url: url.trim(), anonKey: anonKey.trim() })); } catch { /* sin almacenamiento */ }
}

export function borrarConfig() {
  try { localStorage.removeItem(CLAVE_LOCAL); } catch { /* sin almacenamiento */ }
}

let cliente: SupabaseClient | null = null;
export function sb(): SupabaseClient {
  if (cliente) return cliente;
  const cfg = leerConfig();
  if (!cfg) throw new Error('Supabase no está configurado');
  cliente = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return cliente;
}

/** Lee todas las filas de una consulta, paginando de a 1.000 (límite por defecto de Supabase). */
export async function leerTodo<T>(tabla: string, columnas = '*', filtro?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    let q = sb().from(tabla).select(columnas).range(desde, desde + 999);
    if (filtro) q = filtro(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Inserta en lotes de 500 filas */
export async function insertarLotes(tabla: string, filas: object[], upsert?: string) {
  for (let i = 0; i < filas.length; i += 500) {
    const lote = filas.slice(i, i + 500);
    const q = upsert ? sb().from(tabla).upsert(lote, { onConflict: upsert }) : sb().from(tabla).insert(lote);
    const { error } = await q;
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}
