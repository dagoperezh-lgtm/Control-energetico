import { useMemo, useState } from 'react';
import { useDatos } from '../lib/datos';
import { hoyLocal, kcalActividad, modeloEjercicio, parametrosEn, zonasFC } from '../lib/calc';
import { DEPORTES, type Actividad, type Deporte } from '../lib/types';
import { fechaCorta, horasMin, n } from '../lib/formato';
import { FormActividad } from '../components/Formularios';

export default function Entreno() {
  const { actividades, parametros } = useDatos();
  const [filtro, setFiltro] = useState<Deporte | 'todos'>('todos');
  const [form, setForm] = useState<{ act?: Actividad } | null>(null);
  const [max, setMax] = useState(30);
  const modelo = useMemo(() => modeloEjercicio(actividades), [actividades]);
  const p = parametrosEn(parametros, hoyLocal());
  const zonas = p?.fc_reposo && p?.fc_maxima ? zonasFC(p.fc_reposo, p.fc_maxima) : null;
  const lista = actividades.filter((a) => filtro === 'todos' || a.deporte === filtro).slice().reverse();
  const pct = (x: number | null) => (x == null ? '—' : `${n(x * 100, 1)} %`);

  return (
    <>
      <div className="cabecera"><h1>Entrenamiento</h1><button className="btn primario" onClick={() => setForm({})}>+ Actividad</button></div>

      <section className="card">
        <h2>Modelo propio de gasto</h2>
        <p className="sub" style={{ marginTop: 0 }}>Se recalibra con cada actividad que trae kcal medidas. Se usa para estimar las actividades sin dato del dispositivo.</p>
        <div className="tabla-wrap">
          <table className="tabla">
            <thead><tr><th>Deporte</th><th>Muestras</th><th>kcal/km</th><th>kcal/h</th><th>Error x km</th><th>Desv. x km</th><th>Error x h</th><th>Desv. x h</th></tr></thead>
            <tbody>
              {DEPORTES.map((d) => {
                const m = modelo[d.id];
                return (
                  <tr key={d.id}>
                    <td>{d.nombre}</td><td>{m.n}</td><td>{n(m.kcalKm, 1)}</td><td>{n(m.kcalH, 0)}</td>
                    <td>{pct(m.errorKmProm)}</td><td>{pct(m.desvKm)}</td><td>{pct(m.errorHProm)}</td><td>{pct(m.desvH)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="sub">Error = (estimado − medido) / medido. Una desviación alta indica que esa variable predice mal el gasto de ese deporte.</p>
      </section>

      {zonas && (
        <section className="card">
          <h2>Zonas de frecuencia cardíaca</h2>
          <p className="sub" style={{ marginTop: 0 }}>Método Karvonen: (FC máx − FC reposo) × % + FC reposo. Reposo {p!.fc_reposo} · máxima {p!.fc_maxima} ppm.</p>
          <ul className="lista">
            {zonas.map((z) => (
              <li key={z.zona}><strong style={{ width: 64 }}>{z.zona}</strong><span className="nombre sub">{z.descripcion}</span><span className="num">{z.desde}–{z.hasta} ppm</span></li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>Actividades
          <select value={filtro} onChange={(e) => setFiltro(e.target.value as any)} style={{ width: 'auto' }}>
            <option value="todos">Todas</option>
            {DEPORTES.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </h2>
        <ul className="lista">
          {lista.slice(0, max).map((a) => {
            const k = kcalActividad(a, modelo);
            return (
              <li key={a.id} onClick={() => setForm({ act: a })} style={{ cursor: 'pointer' }}>
                <span className="nombre">{fechaCorta(a.fecha)} · {DEPORTES.find((d) => d.id === a.deporte)?.nombre}
                  <span className="sub"> · {horasMin(a.duracion_min / 60)} h{a.distancia_km ? ` · ${n(a.distancia_km, 1)} km` : ''}</span></span>
                <span className="num">{n(k.kcal)} kcal {k.estimada && <span className="chip aviso">est.</span>}</span>
              </li>
            );
          })}
          {!lista.length && <li className="vacio">Sin actividades.</li>}
        </ul>
        {lista.length > max && <button className="btn texto mt" onClick={() => setMax(max + 50)}>Ver más ({lista.length - max} restantes)</button>}
      </section>
      {form && <FormActividad fecha={hoyLocal()} actividad={form.act} onCerrar={() => setForm(null)} />}
    </>
  );
}
