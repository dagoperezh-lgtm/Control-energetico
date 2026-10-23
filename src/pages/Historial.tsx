import { useEffect, useMemo, useState } from 'react';
import { useDatos } from '../lib/datos';
import { leerTodo } from '../lib/supabase';
import { fechaCorta, horasMin, n } from '../lib/formato';
import type { Dia } from '../lib/calc';

type Vista = 'diario' | 'planilla' | 'cambios';

function descargarCSV(nombre: string, filas: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    if (v == null) return '';
    const s = typeof v === 'number' ? String(v).replace('.', ',') : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Separador ";" y coma decimal: abre directo en Excel con configuración regional de Chile
  const csv = '﻿' + filas.map((f) => f.map(esc).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

const r = (x: number | null, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export default function Historial() {
  const [vista, setVista] = useState<Vista>('diario');
  return (
    <>
      <div className="cabecera"><h1>Historial</h1></div>
      <div className="tabs">
        {([['diario', 'Registro diario'], ['planilla', 'Planilla original'], ['cambios', 'Cambios']] as [Vista, string][]).map(([k, t]) => (
          <button key={k} className={vista === k ? 'activo' : ''} onClick={() => setVista(k)}>{t}</button>
        ))}
      </div>
      {vista === 'diario' && <Diario />}
      {vista === 'planilla' && <Planilla />}
      {vista === 'cambios' && <Cambios />}
    </>
  );
}

function Diario() {
  const { dias } = useDatos();
  const anos = useMemo(() => [...new Set(dias.map((d) => d.fecha.slice(0, 4)))].sort().reverse(), [dias]);
  const [ano, setAno] = useState<string>('');
  const [soloConDatos, setSoloConDatos] = useState(true);
  const anoSel = ano || anos[0] || '';
  const filas = dias
    .filter((d) => (anoSel === 'todos' || d.fecha.startsWith(anoSel)) && (!soloConDatos || d.hayIngesta || d.horas > 0 || d.pesoOrigen === 'medido'))
    .reverse();

  function exportar() {
    const enc = ['Fecha', 'Peso kg', 'Origen peso', '% Grasa', 'IMC', 'Grasa kg', 'Masa magra kg', 'Var. grasa kg', 'Var. peso kg', 'Var. acumulada kg',
      'Calorías ingeridas', 'Gasto basal', 'Origen basal', 'Calorías quemadas', 'Gasto total', 'Balance kcal', 'Carbos ingeridos g', 'Balance carbos g',
      'Tiempo h', 'Distancia km', 'Ciclismo kcal', 'Ciclismo h', 'Ciclismo km', 'Trote kcal', 'Trote h', 'Trote km', 'Natación kcal', 'Natación h', 'Natación km', 'Media 7 días kg'];
    const fila = (d: Dia) => [d.fecha, r(d.peso), d.pesoOrigen, r(d.grasaPct), r(d.imc), r(d.grasaKg), r(d.masaMagra), r(d.varGrasa), r(d.varPeso), r(d.varAcumulada),
      r(d.ingesta, 1), r(d.basal, 1), d.basalOrigen, r(d.ejercicio, 1), r(d.gastoTotal, 1), r(d.balance, 1), r(d.carbosIngeridos, 1), r(d.balanceCarbos, 1),
      r(d.horas), r(d.km), r(d.porDeporte.ciclismo.kcal, 1), r(d.porDeporte.ciclismo.horas), r(d.porDeporte.ciclismo.km),
      r(d.porDeporte.trote.kcal, 1), r(d.porDeporte.trote.horas), r(d.porDeporte.trote.km),
      r(d.porDeporte.natacion.kcal, 1), r(d.porDeporte.natacion.horas), r(d.porDeporte.natacion.km), r(d.mediaMovil7)];
    descargarCSV(`control-peso-${anoSel}.csv`, [enc, ...[...filas].reverse().map(fila)]);
  }

  const est = (d: Dia) => (d.pesoOrigen && d.pesoOrigen !== 'medido' ? 'est' : '');
  return (
    <section className="card">
      <div className="fila entre" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
        <div className="fila">
          <select value={anoSel} onChange={(e) => setAno(e.target.value)} style={{ width: 110 }}>
            {anos.map((a) => <option key={a}>{a}</option>)}
            <option value="todos">Todos</option>
          </select>
          <label className="fila sub"><input type="checkbox" checked={soloConDatos} onChange={(e) => setSoloConDatos(e.target.checked)} />Solo días con registros</label>
        </div>
        <button className="btn chico" onClick={exportar}>Exportar CSV</button>
      </div>
      <div className="tabla-wrap" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
        <table className="tabla">
          <thead>
            <tr className="grupo"><th></th><th colSpan={8}>Control de peso</th><th colSpan={6}>Balance energético</th><th colSpan={2}>Entrenamiento</th><th colSpan={3}>Ciclismo</th><th colSpan={3}>Trote</th><th colSpan={3}>Natación</th></tr>
            <tr>
              <th>Fecha</th><th>Peso</th><th>% Grasa</th><th>IMC</th><th>Grasa kg</th><th>Magra kg</th><th>Δ grasa</th><th>Δ peso</th><th>Δ acum.</th>
              <th>Ingesta</th><th>Basal</th><th>Ejercicio</th><th>Gasto total</th><th>Balance</th><th>Bal. carbos g</th>
              <th>Tiempo</th><th>km</th><th>kcal</th><th>h</th><th>km</th><th>kcal</th><th>h</th><th>km</th><th>kcal</th><th>h</th><th>km</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((d) => (
              <tr key={d.fecha}>
                <td>{fechaCorta(d.fecha)}</td>
                <td className={est(d)}>{n(d.peso, 1)}</td>
                <td className={est(d)}>{d.grasaPct == null ? '—' : n(d.grasaPct, 1)}</td>
                <td className={est(d)}>{n(d.imc, 1)}</td>
                <td className={est(d)}>{n(d.grasaKg, 1)}</td>
                <td className={est(d)}>{n(d.masaMagra, 1)}</td>
                <td>{n(d.varGrasa, 2)}</td>
                <td>{n(d.varPeso, 2)}</td>
                <td>{n(d.varAcumulada, 1)}</td>
                <td>{d.hayIngesta ? n(d.ingesta) : '—'}</td>
                <td className={d.basalOrigen === 'planilla' ? '' : 'est'}>{n(d.basal)}</td>
                <td className={d.ejercicioEstimado ? 'est' : ''}>{d.ejercicio ? n(d.ejercicio) : '—'}</td>
                <td>{n(d.gastoTotal)}</td>
                <td className={d.balance == null ? '' : d.balance > 0 ? 'pos' : 'neg'}>{n(d.balance)}</td>
                <td>{n(d.balanceCarbos)}</td>
                <td>{d.horas ? horasMin(d.horas) : '—'}</td>
                <td>{d.km ? n(d.km, 1) : '—'}</td>
                {(['ciclismo', 'trote', 'natacion'] as const).flatMap((k) => [
                  <td key={k + 'k'}>{d.porDeporte[k].kcal ? n(d.porDeporte[k].kcal) : ''}</td>,
                  <td key={k + 'h'}>{d.porDeporte[k].horas ? horasMin(d.porDeporte[k].horas) : ''}</td>,
                  <td key={k + 'km'}>{d.porDeporte[k].km ? n(d.porDeporte[k].km, 1) : ''}</td>,
                ])}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="sub">En cursiva: valores interpolados o estimados. Basal en cursiva = calculado por la app; normal = registrado en la planilla original.</p>
    </section>
  );
}

const ETIQUETAS: Record<string, string> = {
  peso_kg: 'Peso', grasa_frac: '% Grasa', imc: 'IMC', grasa_kg: 'Grasa kg', masa_magra_kg: 'Magra kg', var_grasa_kg: 'Δ grasa', var_peso_kg: 'Δ peso',
  var_acumulada_kg: 'Δ acum.', calorias_ingeridas: 'Ingesta', gasto_basal: 'Basal', calorias_quemadas: 'Quemadas', gasto_total: 'Gasto total',
  balance_calorias: 'Balance', balance_carbos_g: 'Bal. carbos', tiempo_h: 'Tiempo h', distancia_km: 'km', ciclismo_kcal: 'Cicl. kcal', ciclismo_h: 'Cicl. h',
  ciclismo_km: 'Cicl. km', trote_kcal: 'Trote kcal', trote_h: 'Trote h', trote_km: 'Trote km', natacion_kcal: 'Nat. kcal', natacion_h: 'Nat. h', natacion_km: 'Nat. km',
  semana_deficit_kcal: 'Sem. déficit', semana_var_peso_kg: 'Sem. Δ peso', semana_var_grasa: 'Sem. Δ grasa', cal_x_km: 'kcal/km', cal_x_h: 'kcal/h',
  estimacion_x_km: 'Estim. km', estimacion_x_h: 'Estim. h', error_x_km: 'Error km', error_x_h: 'Error h',
};

function Planilla() {
  const { sesion } = useDatos();
  const [filas, setFilas] = useState<{ fecha: string; datos: Record<string, any>; calidad: Record<string, string> }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!sesion) return;
    leerTodo<any>('historico_planilla', 'fecha, datos, calidad', (q) => q.eq('usuario_id', sesion.user.id).order('fecha', { ascending: false }))
      .then(setFilas).catch((e) => setError(e.message));
  }, [sesion]);
  if (error) return <div className="error">{error}</div>;
  if (!filas) return <div className="vacio">Cargando…</div>;
  if (!filas.length) return <div className="card vacio">No hay planilla importada. Importe su archivo desde Más → Importar planilla.</div>;
  const cols = Object.keys(ETIQUETAS);
  const fmt = (k: string, v: any) => (typeof v !== 'number' ? v ?? '' : k === 'grasa_frac' ? n(v * 100, 1) : k.endsWith('_h') && k !== 'cal_x_h' ? horasMin(v) : n(v, Math.abs(v) < 10 ? 2 : 0));
  return (
    <section className="card">
      <div className="fila entre" style={{ marginBottom: 10 }}>
        <span className="sub">{filas.length} filas archivadas, tal como estaban en la hoja Datos.</span>
        <button className="btn chico" onClick={() => descargarCSV('planilla-original.csv', [['Fecha', ...cols.map((c) => ETIQUETAS[c]), 'Calidad'],
          ...[...filas].reverse().map((f) => [f.fecha, ...cols.map((c) => f.datos[c] ?? null), Object.entries(f.calidad).map(([k, v]) => `${k}:${v}`).join(' ')])])}>Exportar CSV</button>
      </div>
      <div className="tabla-wrap" style={{ maxHeight: '68vh', overflowY: 'auto' }}>
        <table className="tabla">
          <thead><tr><th>Fecha</th>{cols.map((c) => <th key={c}>{ETIQUETAS[c]}</th>)}<th style={{ textAlign: 'left' }}>Calidad</th></tr></thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.fecha}>
                <td>{fechaCorta(f.fecha)}</td>
                {cols.map((c) => <td key={c} className={f.calidad[c] || (c === 'peso_kg' && f.calidad.peso === 'interpolado') ? 'est' : ''}>{fmt(c, f.datos[c])}</td>)}
                <td style={{ textAlign: 'left' }}>{Object.entries(f.calidad).filter(([, v]) => v !== 'medido').map(([k, v]) => <span key={k} className="chip aviso" style={{ marginRight: 3 }}>{k}: {v.replace(/_/g, ' ')}</span>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const TABLAS: Record<string, string> = { mediciones: 'Medición', consumos: 'Consumo', actividades: 'Actividad', alimentos: 'Alimento', parametros_perfil: 'Parámetros', perfiles: 'Perfil' };
const OPS: Record<string, string> = { INSERT: 'Alta', UPDATE: 'Edición', DELETE: 'Eliminación' };

function Cambios() {
  const { sesion } = useDatos();
  const [filas, setFilas] = useState<any[] | null>(null);
  useEffect(() => {
    if (!sesion) return;
    leerTodo<any>('historial_cambios', '*', (q) => q.eq('usuario_id', sesion.user.id).order('en', { ascending: false }).limit(300)).then(setFilas);
  }, [sesion]);
  if (!filas) return <div className="vacio">Cargando…</div>;
  const resumen = (x: any) => {
    const v = x.despues ?? x.antes ?? {};
    if (x.tabla === 'mediciones') return `${v.fecha} · ${n(+v.peso_kg, 1)} kg${v.grasa_pct != null ? ` · ${n(+v.grasa_pct, 1)} %` : ''}${x.operacion === 'UPDATE' ? ` (antes ${n(+x.antes.peso_kg, 1)} kg)` : ''}`;
    if (x.tabla === 'consumos') return `${v.fecha} · ${v.nombre} × ${n(+v.cantidad, 2)}${x.operacion === 'UPDATE' ? ` (antes × ${n(+x.antes.cantidad, 2)})` : ''}`;
    if (x.tabla === 'actividades') return `${v.fecha} · ${v.deporte} · ${n(+v.duracion_min)} min`;
    if (x.tabla === 'alimentos') return `${v.nombre} · ${n(+v.kcal)} kcal · ${v.alcance}`;
    if (x.tabla === 'parametros_perfil') return `desde ${v.vigente_desde} · ${v.estatura_cm} cm · ${v.formula_basal}`;
    return '';
  };
  return (
    <section className="card">
      <p className="sub" style={{ marginTop: 0 }}>Cada alta, edición o eliminación queda registrada con sus valores anteriores. Últimos 300 cambios.</p>
      <ul className="lista">
        {filas.map((x) => (
          <li key={x.id}>
            <span className="chip">{OPS[x.operacion] ?? x.operacion}</span>
            <span className="nombre"><strong>{TABLAS[x.tabla] ?? x.tabla}</strong> <span className="sub">{resumen(x)}</span></span>
            <span className="sub num">{new Date(x.en).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </li>
        ))}
        {!filas.length && <li className="vacio">Sin cambios registrados.</li>}
      </ul>
    </section>
  );
}
