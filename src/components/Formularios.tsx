import { useState } from 'react';
import { Modal } from './ui';
import { useDatos } from '../lib/datos';
import { sb } from '../lib/supabase';
import { DEPORTES, type Actividad, type Deporte, type Medicion } from '../lib/types';
import { kcalActividad, modeloEjercicio } from '../lib/calc';
import { n } from '../lib/formato';

const dec = (s: string) => { const x = parseFloat(s.replace(',', '.')); return Number.isFinite(x) ? x : null; };

export function FormActividad({ fecha, actividad, onCerrar }: { fecha: string; actividad?: Actividad; onCerrar: () => void }) {
  const { sesion, actividades, recargar } = useDatos();
  const [f, setF] = useState({
    fecha: actividad?.fecha ?? fecha,
    deporte: (actividad?.deporte ?? 'ciclismo') as Deporte,
    horas: actividad ? String(Math.floor(actividad.duracion_min / 60)) : '',
    minutos: actividad ? String(Math.round(actividad.duracion_min % 60)) : '',
    km: actividad?.distancia_km?.toString() ?? '',
    kcal: actividad?.kcal?.toString() ?? '',
    fc: actividad?.fc_media?.toString() ?? '',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const duracion = (dec(f.horas) ?? 0) * 60 + (dec(f.minutos) ?? 0);
  const estimacion = kcalActividad({ fecha: f.fecha, deporte: f.deporte, duracion_min: duracion, distancia_km: dec(f.km), kcal: null, fc_media: null }, modeloEjercicio(actividades));

  async function guardar() {
    if (!sesion) return;
    if (duracion <= 0) { setMsg('Ingrese la duración.'); return; }
    const fila = {
      usuario_id: sesion.user.id, fecha: f.fecha, deporte: f.deporte, duracion_min: duracion,
      distancia_km: dec(f.km), kcal: dec(f.kcal), fc_media: dec(f.fc) == null ? null : Math.round(dec(f.fc)!),
    };
    const { error } = actividad?.id
      ? await sb().from('actividades').update(fila).eq('id', actividad.id)
      : await sb().from('actividades').insert(fila);
    if (error) { setMsg(error.message); return; }
    await recargar();
    onCerrar();
  }
  async function borrar() {
    if (!actividad?.id || !confirm('¿Eliminar esta actividad? Quedará registrada en el historial de cambios.')) return;
    await sb().from('actividades').delete().eq('id', actividad.id);
    await recargar();
    onCerrar();
  }

  return (
    <Modal titulo={actividad ? 'Editar actividad' : 'Nueva actividad'} onCerrar={onCerrar}>
      <div className="grid2">
        <label className="campo">Fecha<input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label className="campo">Deporte
          <select value={f.deporte} onChange={(e) => setF({ ...f, deporte: e.target.value as Deporte })}>
            {DEPORTES.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </label>
      </div>
      <div className="grid3 mt">
        <label className="campo">Horas<input type="number" inputMode="numeric" value={f.horas} onChange={(e) => setF({ ...f, horas: e.target.value })} /></label>
        <label className="campo">Minutos<input type="number" inputMode="numeric" value={f.minutos} onChange={(e) => setF({ ...f, minutos: e.target.value })} /></label>
        <label className="campo">Distancia (km)<input type="number" inputMode="decimal" value={f.km} onChange={(e) => setF({ ...f, km: e.target.value })} /></label>
        <label className="campo">kcal (dispositivo)<input type="number" inputMode="decimal" value={f.kcal} onChange={(e) => setF({ ...f, kcal: e.target.value })} placeholder="Opcional" /></label>
        <label className="campo">FC media<input type="number" inputMode="numeric" value={f.fc} onChange={(e) => setF({ ...f, fc: e.target.value })} placeholder="Opcional" /></label>
      </div>
      {!f.kcal && estimacion.estimada && <p className="sub">Sin kcal del dispositivo: el modelo propio estima <strong>{n(estimacion.kcal)} kcal</strong>.</p>}
      {msg && <div className="error">{msg}</div>}
      <div className="fila entre mt">
        {actividad?.id ? <button className="btn peligro" onClick={borrar}>Eliminar</button> : <span />}
        <button className="btn primario" onClick={guardar}>Guardar</button>
      </div>
    </Modal>
  );
}

export function FormMedicion({ fecha, medicion, onCerrar }: { fecha: string; medicion?: Medicion; onCerrar: () => void }) {
  const { sesion, mediciones, recargar } = useDatos();
  const previa = [...mediciones].reverse().find((m) => m.fecha <= fecha);
  const [f, setF] = useState({
    fecha: medicion?.fecha ?? fecha,
    peso: medicion?.peso_kg?.toString() ?? '',
    grasa: medicion?.grasa_pct?.toString() ?? previa?.grasa_pct?.toString() ?? '',
    nota: medicion?.nota ?? '',
  });
  const [msg, setMsg] = useState<string | null>(null);

  async function guardar() {
    if (!sesion) return;
    const peso = dec(f.peso);
    if (!peso || peso <= 0) { setMsg('Ingrese el peso.'); return; }
    // Una medición por día: si ya existe, se actualiza (el valor anterior queda en el historial de cambios)
    const { error } = await sb().from('mediciones').upsert({
      usuario_id: sesion.user.id, fecha: f.fecha, peso_kg: peso, grasa_pct: dec(f.grasa),
      origen: 'manual', nota: f.nota || null,
    }, { onConflict: 'usuario_id,fecha' });
    if (error) { setMsg(error.message); return; }
    await recargar();
    onCerrar();
  }
  async function borrar() {
    if (!medicion?.id || !confirm('¿Eliminar esta medición? Quedará registrada en el historial de cambios.')) return;
    await sb().from('mediciones').delete().eq('id', medicion.id);
    await recargar();
    onCerrar();
  }

  return (
    <Modal titulo="Registrar medición" onCerrar={onCerrar}>
      <div className="grid3">
        <label className="campo">Fecha<input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
        <label className="campo">Peso (kg)<input type="number" inputMode="decimal" step="0.1" value={f.peso} onChange={(e) => setF({ ...f, peso: e.target.value })} autoFocus /></label>
        <label className="campo">% grasa<input type="number" inputMode="decimal" step="0.1" value={f.grasa} onChange={(e) => setF({ ...f, grasa: e.target.value })} placeholder="Opcional" /></label>
      </div>
      <label className="campo mt">Nota<input type="text" value={f.nota} onChange={(e) => setF({ ...f, nota: e.target.value })} placeholder="Opcional" /></label>
      {msg && <div className="error mt">{msg}</div>}
      <div className="fila entre mt">
        {medicion?.id ? <button className="btn peligro" onClick={borrar}>Eliminar</button> : <span />}
        <button className="btn primario" onClick={guardar}>Guardar</button>
      </div>
    </Modal>
  );
}
