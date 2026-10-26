import { useState } from 'react';
import { useDatos } from '../lib/datos';
import { sb } from '../lib/supabase';
import { hoyLocal, kcalActividad, modeloEjercicio, sumarDias } from '../lib/calc';
import { useMemo } from 'react';
import { fraccion, PORCION_BASE, siguiente, textoCantidad } from '../lib/porciones';
import { SelectorCantidad } from '../components/Cantidad';
import { Modal } from '../components/ui';
import { COMIDAS, DEPORTES, type Actividad, type Comida, type Consumo } from '../lib/types';
import { fechaLarga, horasMin, n, ns } from '../lib/formato';
import { Kpi } from '../components/ui';
import { SelectorAlimento } from '../components/SelectorAlimento';
import { FormActividad, FormMedicion } from '../components/Formularios';

export default function Hoy() {
  const { diaPorFecha, consumos, actividades, mediciones, alimentos, parametros, perfil, sesion, recargar, calibracion } = useDatos();
  const [editCant, setEditCant] = useState<Consumo | null>(null);
  const porcionPorId = useMemo(() => new Map(alimentos.map((a) => [a.id, a.porcion])), [alimentos]);
  const porcionDe = (c: Consumo) => (c.alimento_id ? porcionPorId.get(c.alimento_id) : undefined) ?? null;
  const [fecha, setFecha] = useState(hoyLocal());
  const [agregar, setAgregar] = useState<Comida | null>(null);
  const [actForm, setActForm] = useState<{ act?: Actividad } | null>(null);
  const [medForm, setMedForm] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const modelo = useMemo(() => modeloEjercicio(actividades), [actividades]);
  const dia = diaPorFecha.get(fecha);
  const delDia = consumos.filter((c) => c.fecha === fecha);
  const actsDia = actividades.filter((a) => a.fecha === fecha);
  const medicion = mediciones.find((m) => m.fecha === fecha);
  const ayer = consumos.filter((c) => c.fecha === sumarDias(fecha, -1) && c.comida !== 'total_dia');

  async function cambiarCantidad(c: Consumo, cant: number) {
    if (cant <= 0) { await sb().from('consumos').delete().eq('id', c.id!); }
    else await sb().from('consumos').update({ cantidad: cant }).eq('id', c.id!);
    await recargar();
  }
  async function repetirAyer() {
    if (!sesion || !ayer.length) return;
    setOcupado(true);
    await sb().from('consumos').insert(ayer.map(({ id, creado_en, origen, ...c }: any) => ({ ...c, fecha, usuario_id: sesion.user.id })));
    await recargar();
    setOcupado(false);
  }

  const meta = dia?.meta ?? 0;
  const pct = meta ? Math.min(100, (dia!.ingesta / meta) * 100) : 0;

  return (
    <>
      <div className="cabecera">
        <div>
          <h1>{fecha === hoyLocal() ? 'Hoy' : fechaLarga(fecha)}</h1>
          <div className="sub">{fecha === hoyLocal() ? fechaLarga(fecha) : ''}</div>
        </div>
        <div className="fila">
          <button className="btn chico" onClick={() => setFecha(sumarDias(fecha, -1))} aria-label="Día anterior">‹</button>
          <input type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)} style={{ width: 140 }} />
          <button className="btn chico" onClick={() => setFecha(sumarDias(fecha, 1))} aria-label="Día siguiente">›</button>
        </div>
      </div>

      {(!parametros.length || !perfil?.fecha_nacimiento) && (
        <a href="#/mas" className="aviso" style={{ display: 'block', textDecoration: 'none' }}>
          Para calcular tu gasto diario, completa tu estatura y fecha de nacimiento en <strong>Más → Mis datos</strong>. ›
        </a>
      )}
      {parametros.length > 0 && perfil?.fecha_nacimiento && !mediciones.length && (
        <div className="aviso">Registra tu peso con <strong>+ Peso</strong> para calcular tu gasto basal.</div>
      )}
      <section className="card">
        <h2>Balance del día {calibracion.activa && <span className="chip ok">calibrado ×{n(calibracion.factor, 2)}</span>}</h2>
        <div className="kpis">
          <Kpi valor={n(dia?.ingesta ?? 0)} etiqueta="kcal ingeridas" />
          <Kpi valor={n(dia?.gastoTotal)} etiqueta={`gasto (basal ${n(dia?.basal)} + ej. ${n(dia?.ejercicio)})`} />
          <Kpi destacado valor={ns(dia?.balance)} etiqueta="balance kcal" clase={dia?.balance == null ? '' : dia.balance > 0 ? 'pos' : 'neg'} />
        </div>
        {meta > 0 && (
          <div className="mt">
            <div className="fila entre sub"><span>Meta de ingesta {n(meta)} kcal</span><span>{dia && dia.ingesta <= meta ? `faltan ${n(meta - dia.ingesta)}` : `excede ${n((dia?.ingesta ?? 0) - meta)}`}</span></div>
            <div className={`barra mt ${dia && dia.ingesta > meta ? 'excede' : ''}`}><div style={{ width: `${pct}%` }} /></div>
          </div>
        )}
        <div className="fila entre sub mt">
          <span>Carbohidratos: {n(dia?.carbosIngeridos, 0)} g ingeridos − {n(dia?.carbosQuemados, 0)} g entreno</span>
          <strong className={dia?.balanceCarbos != null && dia.balanceCarbos < 0 ? 'pos' : ''}>{ns(dia?.balanceCarbos, 0)} g</strong>
        </div>
        {dia?.basalOrigen === 'planilla' && <p className="sub">Gasto basal registrado en la planilla original.</p>}
        {dia?.ajusteBasalPct ? <p className="sub">Gasto basal con ajuste personal de {dia.ajusteBasalPct > 0 ? '+' : ''}{n(dia.ajusteBasalPct, 1)} %.</p> : null}
      </section>

      <section className="card">
        <h2>Composición corporal
          <button className="btn chico" onClick={() => setMedForm(true)}>{medicion ? 'Editar' : '+ Peso'}</button>
        </h2>
        <div className="kpis">
          <Kpi valor={n(dia?.peso, 1)} etiqueta={`kg${dia?.pesoOrigen && dia.pesoOrigen !== 'medido' ? ` (${dia.pesoOrigen})` : ''}`} />
          <Kpi valor={dia?.grasaPct == null ? '—' : `${n(dia.grasaPct, 1)} %`} etiqueta={`grasa · ${n(dia?.grasaKg, 1)} kg`} />
          <Kpi valor={n(dia?.imc, 1)} etiqueta={`IMC · magra ${n(dia?.masaMagra, 1)} kg`} />
        </div>
        <div className="fila entre sub mt">
          <span>Media 7 días {n(dia?.mediaMovil7, 1)} kg</span>
          <span>Día {ns(dia?.varPeso, 1)} kg · desde inicio de etapa {ns(dia?.varAcumulada == null ? null : -dia.varAcumulada, 1)} kg</span>
        </div>
      </section>

      {COMIDAS.map((c) => {
        const items = delDia.filter((x) => x.comida === c.id);
        const total = items.reduce((s, x) => s + x.kcal_unidad * x.cantidad, 0);
        return (
          <section className="card" key={c.id}>
            <h2>{c.nombre}<span className="fila"><span className="sub num">{n(total)} kcal</span>
              <button className="btn chico" onClick={() => setAgregar(c.id)}>+ Agregar</button></span></h2>
            {items.length > 0 && (
              <ul className="lista">
                {items.map((x) => (
                  <li key={x.id}>
                    <span className="nombre">{x.nombre}<br /><span className="sub">{textoCantidad(+x.cantidad, porcionDe(x))}</span></span>
                    <button className="icono-btn" onClick={() => cambiarCantidad(x, siguiente(+x.cantidad, -1))} aria-label="Menos">−</button>
                    <button className="btn chico" style={{ minWidth: 40 }} onClick={() => setEditCant(x)} aria-label="Cambiar cantidad">{fraccion(+x.cantidad)}</button>
                    <button className="icono-btn" onClick={() => cambiarCantidad(x, siguiente(+x.cantidad, 1))} aria-label="Más">+</button>
                    <span className="num sub" style={{ minWidth: 64 }}>{n(x.kcal_unidad * x.cantidad)} kcal</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {delDia.some((x) => x.comida === 'total_dia') && (
        <section className="card">
          <h2>Registro histórico</h2>
          <ul className="lista">{delDia.filter((x) => x.comida === 'total_dia').map((x) => (
            <li key={x.id}><span className="nombre">{x.nombre}</span><span className="num">{n(x.kcal_unidad * x.cantidad)} kcal</span></li>
          ))}</ul>
        </section>
      )}

      {!delDia.length && ayer.length > 0 && (
        <button className="btn" style={{ width: '100%', marginBottom: 12 }} onClick={repetirAyer} disabled={ocupado}>
          Repetir las comidas de ayer ({ayer.length} ítems)
        </button>
      )}

      <section className="card">
        <h2>Entrenamiento <button className="btn chico" onClick={() => setActForm({})}>+ Actividad</button></h2>
        {actsDia.length ? (
          <ul className="lista">
            {actsDia.map((a) => (
              <li key={a.id} onClick={() => setActForm({ act: a })} style={{ cursor: 'pointer' }}>
                <span className="nombre">{DEPORTES.find((d) => d.id === a.deporte)?.nombre}
                  <span className="sub"> · {horasMin(a.duracion_min / 60)} h{a.distancia_km ? ` · ${n(a.distancia_km, 1)} km` : ''}</span></span>
                <span className="num">{a.kcal ? `${n(a.kcal)} kcal` : <span className="chip aviso">≈ {n(kcalActividad(a, modelo).kcal)} kcal</span>}</span>
              </li>
            ))}
          </ul>
        ) : <div className="vacio">Sin entrenamiento registrado.</div>}
        {dia && dia.horas > 0 && <div className="sub mt">Total {horasMin(dia.horas)} h · {n(dia.km, 1)} km · {n(dia.ejercicio)} kcal{dia.ejercicioEstimado ? ' (incluye estimación)' : ''}</div>}
      </section>

      {agregar && <SelectorAlimento fecha={fecha} comida={agregar} onCerrar={() => setAgregar(null)} />}
      {actForm && <FormActividad fecha={fecha} actividad={actForm.act} onCerrar={() => setActForm(null)} />}
      {editCant && <EditarCantidad consumo={editCant} porcion={porcionDe(editCant) ?? PORCION_BASE} onGuardar={async (v) => { await cambiarCantidad(editCant, v); setEditCant(null); }} onCerrar={() => setEditCant(null)} />}
      {medForm && <FormMedicion fecha={fecha} medicion={medicion} onCerrar={() => setMedForm(false)} />}
    </>
  );
}

function EditarCantidad({ consumo, porcion, onGuardar, onCerrar }: { consumo: Consumo; porcion: string; onGuardar: (v: number) => void; onCerrar: () => void }) {
  const [v, setV] = useState(+consumo.cantidad);
  return (
    <Modal titulo={consumo.nombre} onCerrar={onCerrar}>
      <SelectorCantidad valor={v} onCambio={setV} porcion={porcion} />
      <p className="sub">Total: <strong>{n(consumo.kcal_unidad * v)} kcal</strong> · {n(consumo.carbos_unidad * v, 1)} g carbos</p>
      <div className="fila entre mt">
        <button className="btn peligro" onClick={() => onGuardar(0)}>Quitar</button>
        <button className="btn primario" onClick={() => onGuardar(v)} disabled={!(v > 0)}>Guardar</button>
      </div>
    </Modal>
  );
}
