import { useMemo, useState } from 'react';
import { useDatos } from '../lib/datos';
import { insertarLotes, sb, borrarConfig, leerConfig } from '../lib/supabase';
import { hoyLocal, parametrosEn } from '../lib/calc';
import { normalizar } from '../lib/fuentesAlimentos';
import type { Alimento, ParametrosPerfil, Perfil } from '../lib/types';
import { fechaCorta, n } from '../lib/formato';
import type { ResultadoImportacion } from '../lib/importador';
import { Modal } from '../components/ui';

type Vista = 'perfil' | 'alimentos' | 'importar';

export default function Mas() {
  const { sesion } = useDatos();
  const [vista, setVista] = useState<Vista>('perfil');
  return (
    <>
      <div className="cabecera">
        <div><h1>Más</h1><div className="sub">{sesion?.user.email}</div></div>
        <button className="btn chico" onClick={() => sb().auth.signOut()}>Cerrar sesión</button>
      </div>
      <div className="tabs">
        {([['perfil', 'Perfil y parámetros'], ['alimentos', 'Alimentos'], ['importar', 'Importar planilla']] as [Vista, string][]).map(([k, t]) => (
          <button key={k} className={vista === k ? 'activo' : ''} onClick={() => setVista(k)}>{t}</button>
        ))}
      </div>
      {vista === 'perfil' && <PerfilVista />}
      {vista === 'alimentos' && <Alimentos />}
      {vista === 'importar' && <Importar />}
    </>
  );
}

// ---------------- Perfil ----------------
function PerfilVista() {
  const { perfil, parametros, recargar } = useDatos();
  const [f, setF] = useState<Perfil>(perfil!);
  const [msg, setMsg] = useState<string | null>(null);
  const [nuevoParam, setNuevoParam] = useState(false);
  const vigente = parametrosEn(parametros, hoyLocal());

  async function guardar() {
    const { error } = await sb().from('perfiles').update({
      nombre: f.nombre, sexo: f.sexo, fecha_nacimiento: f.fecha_nacimiento || null, inicio_etapa: f.inicio_etapa || null,
    }).eq('id', f.id);
    setMsg(error ? error.message : 'Perfil guardado.');
    await recargar();
  }

  return (
    <>
      <section className="card">
        <h2>Datos personales</h2>
        <div className="grid2">
          <label className="campo">Nombre<input type="text" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
          <label className="campo">Sexo (fórmulas de basal)
            <select value={f.sexo} onChange={(e) => setF({ ...f, sexo: e.target.value as 'M' | 'F' })}><option value="M">Hombre</option><option value="F">Mujer</option></select>
          </label>
          <label className="campo">Fecha de nacimiento<input type="date" value={f.fecha_nacimiento ?? ''} onChange={(e) => setF({ ...f, fecha_nacimiento: e.target.value })} /></label>
          <label className="campo">Inicio de etapa (ref. variación acumulada)<input type="date" value={f.inicio_etapa ?? ''} onChange={(e) => setF({ ...f, inicio_etapa: e.target.value })} /></label>
        </div>
        {msg && <p className="sub">{msg}</p>}
        <button className="btn primario mt" onClick={guardar}>Guardar</button>
      </section>

      <section className="card">
        <h2>Parámetros con vigencia <button className="btn chico" onClick={() => setNuevoParam(true)}>+ Nueva vigencia</button></h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Cada día se calcula con los parámetros vigentes en esa fecha. Un cambio no altera los días anteriores. Si se fija "edad", se usa en vez de la fecha de nacimiento.
        </p>
        <div className="tabla-wrap">
          <table className="tabla">
            <thead><tr><th>Desde</th><th>Estatura</th><th>Fórmula basal</th><th>Edad fija</th><th>Carbos/h</th><th>Meta kcal</th><th>FC reposo</th><th>FC máx</th></tr></thead>
            <tbody>
              {[...parametros].reverse().map((p) => (
                <tr key={p.id}>
                  <td>{fechaCorta(p.vigente_desde)} {p === vigente && <span className="chip ok">vigente</span>}</td>
                  <td>{n(+p.estatura_cm, 1)} cm</td>
                  <td>{p.formula_basal === 'harris_benedict' ? 'Harris-Benedict' : 'Katch-McArdle'}</td>
                  <td>{p.edad_fija ?? '—'}</td><td>{n(+p.carbos_por_hora)} g</td><td>{n(+p.meta_kcal)}</td>
                  <td>{p.fc_reposo ?? '—'}</td><td>{p.fc_maxima ?? '—'}</td>
                </tr>
              ))}
              {!parametros.length && <tr><td colSpan={8} className="vacio">Defina sus parámetros para que la app calcule el gasto basal.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {nuevoParam && <FormParametros base={vigente} onCerrar={() => setNuevoParam(false)} />}

      <section className="card">
        <h2>Conexión</h2>
        <p className="sub" style={{ marginTop: 0 }}>Base de datos: {leerConfig()?.url}</p>
        {!import.meta.env.VITE_SUPABASE_URL && <button className="btn chico" onClick={() => { borrarConfig(); location.reload(); }}>Cambiar proyecto Supabase</button>}
      </section>
    </>
  );
}

function FormParametros({ base, onCerrar }: { base: ParametrosPerfil | null; onCerrar: () => void }) {
  const { sesion, recargar } = useDatos();
  const [f, setF] = useState({
    vigente_desde: hoyLocal(), estatura_cm: String(base?.estatura_cm ?? ''), formula_basal: base?.formula_basal ?? 'harris_benedict',
    edad_fija: base?.edad_fija?.toString() ?? '', carbos_por_hora: String(base?.carbos_por_hora ?? 40), meta_kcal: String(base?.meta_kcal ?? 1200),
    fc_reposo: base?.fc_reposo?.toString() ?? '', fc_maxima: base?.fc_maxima?.toString() ?? '',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const num = (s: string) => (s.trim() === '' ? null : +s.replace(',', '.'));
  async function guardar() {
    if (!num(f.estatura_cm)) { setMsg('Ingrese la estatura.'); return; }
    const { error } = await sb().from('parametros_perfil').upsert({
      usuario_id: sesion!.user.id, vigente_desde: f.vigente_desde, estatura_cm: num(f.estatura_cm), formula_basal: f.formula_basal,
      edad_fija: num(f.edad_fija), carbos_por_hora: num(f.carbos_por_hora) ?? 40, meta_kcal: num(f.meta_kcal) ?? 1200,
      fc_reposo: num(f.fc_reposo), fc_maxima: num(f.fc_maxima),
    }, { onConflict: 'usuario_id,vigente_desde' });
    if (error) { setMsg(error.message); return; }
    await recargar();
    onCerrar();
  }
  const campo = (k: keyof typeof f, t: string, tipo = 'number') => (
    <label className="campo">{t}<input type={tipo} inputMode={tipo === 'number' ? 'decimal' : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <Modal titulo="Nueva vigencia de parámetros" onCerrar={onCerrar}>
      <div className="grid2">
        {campo('vigente_desde', 'Vigente desde', 'date')}
        {campo('estatura_cm', 'Estatura (cm)')}
        <label className="campo">Fórmula de gasto basal
          <select value={f.formula_basal} onChange={(e) => setF({ ...f, formula_basal: e.target.value as any })}>
            <option value="harris_benedict">Harris-Benedict (peso total)</option>
            <option value="katch_mcardle">Katch-McArdle (masa magra)</option>
          </select>
        </label>
        {campo('edad_fija', 'Edad fija (opcional)')}
        {campo('carbos_por_hora', 'Carbos por hora de entreno (g)')}
        {campo('meta_kcal', 'Meta diaria de ingesta (kcal)')}
        {campo('fc_reposo', 'FC reposo (ppm)')}
        {campo('fc_maxima', 'FC máxima (ppm)')}
      </div>
      <p className="sub">Katch-McArdle es más fiel cuando el % de grasa se mide con regularidad.</p>
      {msg && <div className="error">{msg}</div>}
      <button className="btn primario mt" onClick={guardar}>Guardar</button>
    </Modal>
  );
}

// ---------------- Alimentos ----------------
function Alimentos() {
  const { alimentos, perfil, sesion, recargar } = useDatos();
  const [q, setQ] = useState('');
  const [editar, setEditar] = useState<Alimento | null>(null);
  const t = normalizar(q);
  const lista = alimentos.filter((a) => !t || normalizar(a.nombre).includes(t));
  const propuestos = perfil?.es_admin ? alimentos.filter((a) => a.alcance === 'propuesto') : [];

  async function cambiarAlcance(a: Alimento, alcance: Alimento['alcance']) {
    const { error } = await sb().from('alimentos').update({ alcance }).eq('id', a.id!);
    if (error) alert(error.message);
    await recargar();
  }

  return (
    <>
      {propuestos.length > 0 && (
        <section className="card">
          <h2>Propuestas al catálogo compartido</h2>
          <ul className="lista">{propuestos.map((a) => (
            <li key={a.id}><span className="nombre">{a.nombre} <span className="sub">{n(+a.kcal)} kcal · {n(+a.carbos_g, 1)} g</span></span>
              <button className="btn chico" onClick={() => cambiarAlcance(a, 'compartido')}>Aprobar</button>
              <button className="btn chico" onClick={() => cambiarAlcance(a, 'personal')}>Rechazar</button></li>
          ))}</ul>
        </section>
      )}
      <section className="card">
        <h2>Catálogo <span className="sub">{alimentos.length} alimentos</span></h2>
        <input type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="lista mt">
          {lista.slice(0, 200).map((a) => {
            const propio = a.propietario === sesion?.user.id;
            return (
              <li key={a.id}>
                <span className="nombre">{a.nombre}<br /><span className="sub">{n(+a.kcal, 1)} kcal · {n(+a.carbos_g, 1)} g carbos · {a.porcion}</span></span>
                <span className={`chip ${a.alcance === 'compartido' ? 'ok' : a.alcance === 'propuesto' ? 'aviso' : ''}`}>{a.alcance}</span>
                {propio && a.alcance === 'personal' && <button className="btn chico" onClick={() => cambiarAlcance(a, perfil?.es_admin ? 'compartido' : 'propuesto')}>{perfil?.es_admin ? 'Compartir' : 'Proponer'}</button>}
                {(propio && a.alcance !== 'compartido') || perfil?.es_admin ? <button className="icono-btn" onClick={() => setEditar(a)} aria-label="Editar">✎</button> : null}
              </li>
            );
          })}
        </ul>
      </section>
      {editar && <EditarAlimento a={editar} onCerrar={() => setEditar(null)} />}
    </>
  );
}

function EditarAlimento({ a, onCerrar }: { a: Alimento; onCerrar: () => void }) {
  const { recargar } = useDatos();
  const [f, setF] = useState({ nombre: a.nombre, kcal: String(a.kcal), carbos: String(a.carbos_g), porcion: a.porcion });
  async function guardar() {
    const { error } = await sb().from('alimentos').update({ nombre: f.nombre, kcal: +f.kcal.replace(',', '.'), carbos_g: +f.carbos.replace(',', '.') || 0, porcion: f.porcion }).eq('id', a.id!);
    if (error) { alert(error.message); return; }
    await recargar(); onCerrar();
  }
  async function desactivar() {
    if (!confirm('¿Retirar este alimento del catálogo? Los consumos ya registrados no cambian.')) return;
    await sb().from('alimentos').update({ activo: false }).eq('id', a.id!);
    await recargar(); onCerrar();
  }
  return (
    <Modal titulo="Editar alimento" onCerrar={onCerrar}>
      <label className="campo">Nombre<input type="text" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></label>
      <div className="grid3 mt">
        <label className="campo">kcal<input type="number" value={f.kcal} onChange={(e) => setF({ ...f, kcal: e.target.value })} /></label>
        <label className="campo">Carbos g<input type="number" value={f.carbos} onChange={(e) => setF({ ...f, carbos: e.target.value })} /></label>
        <label className="campo">Porción<input type="text" value={f.porcion} onChange={(e) => setF({ ...f, porcion: e.target.value })} /></label>
      </div>
      <p className="sub">Corregir un alimento no modifica los días ya registrados: cada consumo guarda sus propios valores.</p>
      <div className="fila entre mt"><button className="btn peligro" onClick={desactivar}>Retirar</button><button className="btn primario" onClick={guardar}>Guardar</button></div>
    </Modal>
  );
}

// ---------------- Importar ----------------
function Importar() {
  const { sesion, perfil, alimentos, mediciones, recargar } = useDatos();
  const [res, setRes] = useState<ResultadoImportacion | null>(null);
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compartir, setCompartir] = useState(!!perfil?.es_admin);
  const [ocupado, setOcupado] = useState(false);
  const yaImportado = useMemo(() => mediciones.some((m) => m.origen === 'importado' || m.origen === 'interpolado'), [mediciones]);

  async function leer(file: File) {
    setError(null); setRes(null); setEstado('Leyendo planilla…');
    try {
      const [{ default: ExcelJS }, { importarPlanilla }] = await Promise.all([import('exceljs'), import('../lib/importador')]);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      setRes(importarPlanilla(wb));
      setEstado(null);
    } catch (e: any) { setError(e.message ?? String(e)); setEstado(null); }
  }

  async function importar() {
    if (!res || !sesion) return;
    const uid = sesion.user.id;
    setOcupado(true); setError(null);
    try {
      setEstado('Reemplazando la importación anterior…');
      await sb().from('mediciones').delete().eq('usuario_id', uid).in('origen', ['importado', 'interpolado']);
      await sb().from('consumos').delete().eq('usuario_id', uid).eq('origen', 'importado');
      await sb().from('actividades').delete().eq('usuario_id', uid).eq('origen', 'importado');

      setEstado('Parámetros…');
      await insertarLotes('parametros_perfil', res.parametros.map((p) => ({ ...p, usuario_id: uid })), 'usuario_id,vigente_desde');

      setEstado('Mediciones…');
      const manuales = new Set(mediciones.filter((m) => m.origen === 'manual' || m.origen === 'balanza').map((m) => m.fecha));
      await insertarLotes('mediciones', res.mediciones.filter((m) => !manuales.has(m.fecha)).map((m) => ({ ...m, usuario_id: uid })));

      setEstado('Ingesta diaria…');
      await insertarLotes('consumos', res.consumos.map((c) => ({ ...c, usuario_id: uid })));

      setEstado('Entrenamientos…');
      await insertarLotes('actividades', res.actividades.map((a) => ({ ...a, usuario_id: uid })));

      setEstado('Archivo íntegro de la planilla…');
      await insertarLotes('historico_planilla', res.historico.map((h) => ({ ...h, usuario_id: uid })), 'usuario_id,fecha');

      setEstado('Catálogo de alimentos…');
      const existentes = new Set(alimentos.map((a) => normalizar(a.nombre)));
      const nuevos = res.alimentos.filter((a) => !existentes.has(normalizar(a.nombre)));
      const alcance = compartir && perfil?.es_admin ? 'compartido' : 'personal';
      await insertarLotes('alimentos', nuevos.map((a) => ({ ...a, alcance, propietario: uid })));

      if (!perfil?.inicio_etapa && res.parametros[0]) {
        await sb().from('perfiles').update({ inicio_etapa: res.parametros[0].vigente_desde }).eq('id', uid);
      }
      setEstado('Recalculando…');
      await recargar();
      setEstado(`Importación completa: ${res.resumen.filas} días, ${nuevos.length} alimentos nuevos.`);
      setRes(null);
    } catch (e: any) {
      setError(e.message ?? String(e)); setEstado(null);
    } finally { setOcupado(false); }
  }

  const s = res?.resumen;
  return (
    <section className="card">
      <h2>Importar planilla Excel</h2>
      <p className="sub" style={{ marginTop: 0 }}>
        Cargue su archivo "Seguimiento peso" (.xlsx). Se importan pesos, % grasa, ingesta diaria, entrenamientos por deporte, parámetros de gasto basal,
        zonas de FC y la base de alimentos. Cada fila de la hoja Datos queda además archivada tal cual, con banderas de calidad.
      </p>
      {yaImportado && <div className="aviso">Ya existe una importación. Volver a importar reemplaza solo los datos importados; lo registrado en la app se conserva.</div>}
      <input type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} disabled={ocupado} />
      {error && <div className="error mt">{error}</div>}
      {estado && <p className="sub">{estado}</p>}
      {s && (
        <>
          <h3>Vista previa</h3>
          <ul className="lista">
            <li><span className="nombre">Período</span><span className="num">{s.desde && fechaCorta(s.desde)} → {s.hasta && fechaCorta(s.hasta)}</span></li>
            <li><span className="nombre">Días (filas)</span><span className="num">{s.filas}</span></li>
            <li><span className="nombre">Pesos medidos</span><span className="num">{s.pesosMedidos}</span></li>
            <li><span className="nombre">Pesos interpolados <span className="chip aviso">se marcan como estimados</span></span><span className="num">{s.pesosInterpolados}</span></li>
            <li><span className="nombre">Días con ingesta</span><span className="num">{s.diasConIngesta}</span></li>
            <li><span className="nombre">Ingestas idénticas al día anterior <span className="chip aviso">posible copia</span></span><span className="num">{s.ingestasRepetidas}</span></li>
            <li><span className="nombre">Ejercicio negativo <span className="chip aviso">se descarta</span></span><span className="num">{s.ejercicioNegativo}</span></li>
            <li><span className="nombre">Celdas con error de fórmula</span><span className="num">{s.errores}</span></li>
            <li><span className="nombre">Actividades</span><span className="num">{s.actividades}</span></li>
            <li><span className="nombre">Alimentos en la base</span><span className="num">{s.alimentos}</span></li>
            <li style={{ flexWrap: 'wrap' }}><span className="nombre">Vigencias de parámetros</span><span className="sub">{res!.parametros.map((p) => `${fechaCorta(p.vigente_desde)} (${p.edad_fija} años)`).join(' · ')}</span></li>
          </ul>
          {perfil?.es_admin && (
            <label className="fila mt"><input type="checkbox" checked={compartir} onChange={(e) => setCompartir(e.target.checked)} />Publicar la base de alimentos en el catálogo compartido</label>
          )}
          <button className="btn primario mt" onClick={importar} disabled={ocupado}>{ocupado ? 'Importando…' : 'Importar'}</button>
        </>
      )}
    </section>
  );
}
