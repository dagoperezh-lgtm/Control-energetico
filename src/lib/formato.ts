const cache = new Map<number, Intl.NumberFormat>();
function nf(dec: number) {
  if (!cache.has(dec)) cache.set(dec, new Intl.NumberFormat('es-CL', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
  return cache.get(dec)!;
}
/** Número en formato chileno (1.234,5). null → "—" */
export const n = (x: number | null | undefined, dec = 0) => (x == null || !Number.isFinite(x) ? '—' : nf(dec).format(x));
/** Con signo explícito */
export const ns = (x: number | null | undefined, dec = 0) => (x == null || !Number.isFinite(x) ? '—' : (x > 0 ? '+' : '') + nf(dec).format(x));

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export function fechaCorta(f: string) {
  return `${+f.slice(8, 10)} ${MESES[+f.slice(5, 7) - 1]} ${f.slice(0, 4)}`;
}
export function fechaLarga(f: string) {
  const dow = new Date(Date.UTC(+f.slice(0, 4), +f.slice(5, 7) - 1, +f.slice(8, 10))).getUTCDay();
  return `${DIAS[dow]} ${+f.slice(8, 10)} ${MESES[+f.slice(5, 7) - 1]} ${f.slice(0, 4)}`;
}
export const horasMin = (h: number) => {
  const t = Math.round(h * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
