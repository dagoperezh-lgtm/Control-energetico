import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { leerTodo, sb } from './supabase';
import type { Actividad, Alimento, Consumo, Medicion, ParametrosPerfil, Perfil } from './types';
import { calcularDias, factorCalibracion, hoyLocal, resumenSemanal, type Dia, type Entradas, type Semana } from './calc';

const CLAVE_CALIBRACION = 'control-peso.calibracion';

interface Estado {
  sesion: Session | null;
  cargando: boolean;
  error: string | null;
  perfil: Perfil | null;
  parametros: ParametrosPerfil[];
  mediciones: Medicion[];
  consumos: Consumo[];
  actividades: Actividad[];
  alimentos: Alimento[];
  basalRegistrado: Map<string, number>;
  recargar: () => Promise<void>;
  // derivados
  dias: Dia[];               // desde el primer dato hasta hoy
  diaPorFecha: Map<string, Dia>;
  semanas: Semana[];
  calibracion: { factor: number; semanasUsadas: number; activa: boolean };
  setCalibracionActiva: (v: boolean) => void;
}

const Ctx = createContext<Estado | null>(null);
export const useDatos = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useDatos fuera del proveedor');
  return c;
};

export function ProveedorDatos({ children }: { children: ReactNode }) {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [parametros, setParametros] = useState<ParametrosPerfil[]>([]);
  const [mediciones, setMediciones] = useState<Medicion[]>([]);
  const [consumos, setConsumos] = useState<Consumo[]>([]);
  const [actividades, setActividades] = useState<Actividad[]>([]);
  const [alimentos, setAlimentos] = useState<Alimento[]>([]);
  const [basalRegistrado, setBasalRegistrado] = useState<Map<string, number>>(new Map());
  const [calActiva, setCalActiva] = useState<boolean>(() => {
    try { return localStorage.getItem(CLAVE_CALIBRACION) === '1'; } catch { return false; }
  });

  useEffect(() => {
    sb().auth.getSession().then(({ data }) => { setSesion(data.session); if (!data.session) setCargando(false); });
    const { data } = sb().auth.onAuthStateChange((_e, s) => setSesion(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const recargar = useCallback(async () => {
    if (!sesion) return;
    setCargando(true);
    setError(null);
    try {
      const uid = sesion.user.id;
      const [pf, pr, me, co, ac, al, hp] = await Promise.all([
        sb().from('perfiles').select('*').eq('id', uid).maybeSingle(),
        leerTodo<ParametrosPerfil>('parametros_perfil', '*', (q) => q.eq('usuario_id', uid).order('vigente_desde')),
        leerTodo<Medicion>('mediciones', '*', (q) => q.eq('usuario_id', uid).order('fecha')),
        leerTodo<Consumo>('consumos', '*', (q) => q.eq('usuario_id', uid).order('fecha')),
        leerTodo<Actividad>('actividades', '*', (q) => q.eq('usuario_id', uid).order('fecha')),
        leerTodo<Alimento>('alimentos', '*', (q) => q.eq('activo', true).order('nombre')),
        leerTodo<{ fecha: string; basal: number | null }>('historico_planilla', 'fecha, basal:datos->gasto_basal', (q) => q.eq('usuario_id', uid)),
      ]);
      if (pf.error) throw pf.error;
      let p = pf.data as Perfil | null;
      if (!p) {
        const ins = await sb().from('perfiles').insert({ id: uid, nombre: '' }).select().single();
        if (ins.error) throw ins.error;
        p = ins.data as Perfil;
      }
      setPerfil(p);
      setParametros(pr);
      setMediciones(me.map((m) => ({ ...m, peso_kg: +m.peso_kg, grasa_pct: m.grasa_pct == null ? null : +m.grasa_pct })));
      setConsumos(co);
      setActividades(ac);
      setAlimentos(al);
      setBasalRegistrado(new Map(hp.filter((h) => typeof h.basal === 'number').map((h) => [h.fecha, h.basal as number])));
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setCargando(false);
    }
  }, [sesion]);

  useEffect(() => { if (sesion) recargar(); }, [sesion?.user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const derivados = useMemo(() => {
    if (!perfil) return { dias: [], semanas: [], cal: { factor: 1, semanasUsadas: 0 } };
    const fechas = [...mediciones.map((m) => m.fecha), ...consumos.map((c) => c.fecha), ...actividades.map((a) => a.fecha)].sort();
    const hoy = hoyLocal();
    const desde = fechas[0] ?? hoy;
    const hasta = fechas[fechas.length - 1] > hoy ? fechas[fechas.length - 1] : hoy;
    const base: Entradas = { perfil, parametros, mediciones, consumos, actividades, basalRegistrado };
    const sinCal = calcularDias(base, desde, hasta);
    const semanasSinCal = resumenSemanal(sinCal, mediciones);
    const cal = factorCalibracion(semanasSinCal);
    if (calActiva && cal.factor !== 1) {
      // La calibración se aplica a los días calculados por la app, no a los registrados en la planilla
      const dias = calcularDias({ ...base, factorCalibracion: cal.factor }, desde, hasta).map((d, i) =>
        d.basalOrigen === 'planilla' ? sinCal[i] : d);
      return { dias, semanas: resumenSemanal(dias, mediciones), cal };
    }
    return { dias: sinCal, semanas: semanasSinCal, cal };
  }, [perfil, parametros, mediciones, consumos, actividades, basalRegistrado, calActiva]);

  const diaPorFecha = useMemo(() => new Map(derivados.dias.map((d) => [d.fecha, d])), [derivados.dias]);

  const valor: Estado = {
    sesion, cargando, error, perfil, parametros, mediciones, consumos, actividades, alimentos, basalRegistrado, recargar,
    dias: derivados.dias, diaPorFecha, semanas: derivados.semanas,
    calibracion: { ...derivados.cal, activa: calActiva },
    setCalibracionActiva: (v) => { setCalActiva(v); try { localStorage.setItem(CLAVE_CALIBRACION, v ? '1' : '0'); } catch { /* */ } },
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
