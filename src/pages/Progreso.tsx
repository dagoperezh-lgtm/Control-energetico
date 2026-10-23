import { useMemo, useState } from 'react';
import {
  Chart as ChartJS, LineElement, PointElement, BarElement, LinearScale, TimeScale, Tooltip, Legend, Filler,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import { es } from 'date-fns/locale';
import { Chart } from 'react-chartjs-2';
import { useDatos } from '../lib/datos';
import { hoyLocal, KCAL_POR_KG, sumarDias } from '../lib/calc';
import { fechaCorta, n, ns } from '../lib/formato';
import { Kpi } from '../components/ui';

ChartJS.register(LineElement, PointElement, BarElement, LinearScale, TimeScale, Tooltip, Legend, Filler);
ChartJS.defaults.locale = 'es-CL';

const RANGOS = [['30', '30 días'], ['90', '90 días'], ['365', '1 año'], ['todo', 'Todo']] as const;
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || '#2f7a4f';

export default function Progreso() {
  const [vista, setVista] = useState<'tendencia' | 'semana'>('tendencia');
  return (
    <>
      <div className="cabecera"><h1>Progreso</h1></div>
      <div className="tabs">
        <button className={vista === 'tendencia' ? 'activo' : ''} onClick={() => setVista('tendencia')}>Tendencia</button>
        <button className={vista === 'semana' ? 'activo' : ''} onClick={() => setVista('semana')}>Cierre semanal</button>
      </div>
      {vista === 'tendencia' ? <Tendencia /> : <Semanal />}
    </>
  );
}

function Tendencia() {
  const { dias, mediciones } = useDatos();
  const [rango, setRango] = useState<string>('90');
  const desde = rango === 'todo' ? '0000' : sumarDias(hoyLocal(), -+rango);
  const ds = useMemo(() => dias.filter((d) => d.fecha >= desde), [dias, desde]);
  const reales = useMemo(() => new Set(mediciones.filter((m) => m.origen !== 'interpolado').map((m) => m.fecha)), [mediciones]);

  const conPeso = ds.filter((d) => d.peso != null);
  const primero = conPeso[0], ultimo = conPeso[conPeso.length - 1];
  const conBal = ds.filter((d) => d.balance != null);
  const deficit = -conBal.reduce((s, d) => s + d.balance!, 0);
  const acento = css('--accent'), aviso = css('--warn'), apagado = css('--muted');

  const datosPeso = {
    datasets: [
      { type: 'line' as const, label: 'Peso medido (kg)', data: ds.filter((d) => d.peso != null && reales.has(d.fecha)).map((d) => ({ x: d.fecha, y: d.peso })),
        showLine: false, pointRadius: 2.5, borderColor: apagado, backgroundColor: apagado, yAxisID: 'y' },
      { type: 'line' as const, label: 'Media 7 días (kg)', data: ds.filter((d) => d.mediaMovil7 != null && d.pesoOrigen !== null).map((d) => ({ x: d.fecha, y: d.mediaMovil7 })),
        borderColor: acento, borderWidth: 2.5, pointRadius: 0, tension: 0.25, yAxisID: 'y', spanGaps: false },
      { type: 'line' as const, label: '% grasa', data: ds.filter((d) => d.grasaPct != null && reales.has(d.fecha)).map((d) => ({ x: d.fecha, y: d.grasaPct })),
        borderColor: aviso, borderWidth: 1.5, pointRadius: 0, borderDash: [4, 4], yAxisID: 'y2' },
    ],
  };
  const datosBalance = {
    datasets: [{ type: 'bar' as const, label: 'Balance (kcal)', data: conBal.map((d) => ({ x: d.fecha, y: d.balance })),
      backgroundColor: conBal.map((d) => (d.balance! > 0 ? css('--bad') : acento)) }],
  };
  const ejeX = { type: 'time' as const, adapters: { date: { locale: es } }, time: { tooltipFormat: 'dd-MM-yyyy' }, grid: { display: false }, ticks: { maxTicksLimit: 6 } };

  return (
    <>
      <div className="tabs">{RANGOS.map(([k, t]) => <button key={k} className={rango === k ? 'activo' : ''} onClick={() => setRango(k)}>{t}</button>)}</div>
      <section className="card">
        <div className="kpis">
          <Kpi valor={n(ultimo?.mediaMovil7 ?? ultimo?.peso, 1)} etiqueta="kg (media 7 días)" destacado />
          <Kpi valor={ns(primero && ultimo ? ultimo.peso! - primero.peso! : null, 1)} etiqueta="kg en el período" />
          <Kpi valor={n(deficit / KCAL_POR_KG, 1)} etiqueta={`kg teóricos (déficit ${n(deficit)} kcal)`} />
        </div>
      </section>
      <section className="card">
        <h2>Peso y grasa</h2>
        <div style={{ height: 260 }}>
          <Chart type="line" data={datosPeso} options={{
            maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: false },
            plugins: { legend: { labels: { boxWidth: 12 } } },
            scales: { x: ejeX, y: { title: { display: true, text: 'kg' } }, y2: { position: 'right', grid: { display: false }, title: { display: true, text: '% grasa' } } },
          }} />
        </div>
        <p className="sub">Puntos: pesajes reales. Línea: media móvil de 7 días (incluye días interpolados entre pesajes).</p>
      </section>
      <section className="card">
        <h2>Balance calórico diario</h2>
        <div style={{ height: 200 }}>
          <Chart type="bar" data={datosBalance} options={{ maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: ejeX, y: { title: { display: true, text: 'kcal' } } } }} />
        </div>
        <p className="sub">Verde: déficit. Rojo: superávit.</p>
      </section>
    </>
  );
}

function Semanal() {
  const { semanas, calibracion, setCalibracionActiva } = useDatos();
  const conDatos = semanas.filter((s) => s.diasConIngesta > 0 || s.medicionesReales > 0);
  return (
    <>
      <section className="card">
        <h2>Autocalibración del gasto</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Compara el gasto que estima el modelo con el gasto real que implica la balanza, en semanas con al menos 5 días de ingesta y 2 pesajes reales.
        </p>
        <div className="kpis">
          <Kpi valor={`×${n(calibracion.factor, 2)}`} etiqueta="factor real / modelo" destacado />
          <Kpi valor={calibracion.semanasUsadas} etiqueta="semanas válidas (máx. 8)" />
          <Kpi valor={calibracion.activa ? 'Activa' : 'Inactiva'} etiqueta="aplicada al balance" />
        </div>
        <label className="fila mt" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={calibracion.activa} onChange={(e) => setCalibracionActiva(e.target.checked)} disabled={calibracion.semanasUsadas < 2} />
          <span>Aplicar el factor al gasto total de los días calculados por la app</span>
        </label>
        {calibracion.semanasUsadas < 2 && <p className="sub">Se requieren al menos 2 semanas válidas.</p>}
      </section>
      <section className="card">
        <h2>Cierre semanal</h2>
        <div className="tabla-wrap">
          <table className="tabla">
            <thead><tr>
              <th>Semana</th><th>Días ing.</th><th>Déficit kcal</th><th>kg teóricos</th><th>kg reales</th><th>Error kg</th>
              <th>Δ grasa pp</th><th>Gasto modelo</th><th>Gasto real</th><th>Pesajes</th>
            </tr></thead>
            <tbody>
              {conDatos.map((s) => (
                <tr key={s.inicio}>
                  <td>{fechaCorta(s.inicio)}</td>
                  <td>{s.diasConIngesta}</td>
                  <td>{s.diasConIngesta ? n(s.deficit) : "—"}</td>
                  <td>{s.diasConIngesta ? n(s.kgTeoricos, 2) : "—"}</td>
                  <td className={s.medicionesReales < 2 ? 'est' : ''}>{n(s.varPesoReal, 2)}</td>
                  <td>{ns(s.errorKg, 2)}</td>
                  <td>{ns(s.varGrasaPct, 1)}</td>
                  <td>{n(s.gastoModelo)}</td>
                  <td className={s.medicionesReales < 2 ? 'est' : ''}>{n(s.gastoReal)}</td>
                  <td>{s.medicionesReales}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub">kg reales y teóricos: positivo = bajó. En cursiva, semanas con menos de 2 pesajes reales. 1 kg = {n(KCAL_POR_KG)} kcal.</p>
      </section>
    </>
  );
}
