import { useMemo, useState } from 'react';
import { useDatos } from '../lib/datos';
import { insertarLotes, sb, borrarConfig, leerConfig } from '../lib/supabase';
import { hoyLocal, NOMBRE_FORMULA, parametrosEn } from '../lib/calc';
import { normalizar } from '../lib/fuentesAlimentos';
import type { Alimento, ParametrosPerfil, Perfil } from '../lib/types';
import { fechaCorta, n } from '../lib/formato';
import type { ResultadoImportacion } from '../lib/importador';
import { Modal } from '../components/ui';
import { clasificar, descargarPlantilla, leerCatalogo, type Clasificacion, type LecturaCatalogo } from '../lib/cargaAlimentos';

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
        {([['perfil', 'Mis datos'], ['alimentos', 'Alimentos'], ['importar', 'Importar planilla']] as [Vista, string][]).map(([k, t]) => (
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
/**
 * Un solo formulario "Mis datos". Internamente cada cambio de estatura, fórmula, meta, ajuste o FC
 * se guarda con la fecha de hoy (parametros_perfil), de modo que los días anteriores no se recalculan.
 * El usuario no necesita saber de "vigencias": solo ve sus datos actuales y, si quiere, el historial.
 */
function PerfilVista() {
  const { perfil, parametros, recargar, sesion } = useDatos();
  const hoy = hoyLocal();
  const actual = parametrosEn(parametros, hoy);
  const ini = () => ({
    nombre: perfil!.nombre ?? '', sexo: perfil!.sexo, fecha_nacimiento: perfil!.fecha_nacimiento ?? '', inicio_etapa: perfil!.inicio_etapa ?? '',
    estatura_cm: actual?.estatura_cm != null ? String(+actual.estatura_cm) : '',
    meta_kcal: actual?.meta_kcal != null ? String(+actual.meta_kcal) : '1500',
    formula_basal: (actual?.formula_basal ?? 'mifflin_st_jeor') as ParametrosPerfil['formula_basal'],
    ajuste_basal_pct: actual?.ajuste_basal_pct ? String(+actual.ajuste_basal_pct) : '',
    nota: actual?.nota && !actual.nota.startsWith('Importado') ? actual.nota : '',
    carbos_por_hora: actual?.carbos_por_hora != null ? String(+actual.carbos_por_hora) : '40',
    fc_reposo: actual?.fc_reposo?.toString() ?? '', fc_maxima: actual?.fc_maxima?.toString() ?? '',
  });
  const [f, setF] = useState(ini);
  const [msg, setMsg] = useState<{ t: string; error?: boolean } | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verHist, setVerHist] = useState(false);
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const set = (k: keyof ReturnType<typeof ini>) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setMsg(null); };

  async function guardar() {
    const est = num(f.estatura_cm);
    const meta = num(f.meta_kcal);
    const aj = num(f.ajuste_basal_pct);
    if (!est || est < 100 || est > 230) { setMsg({ t: 'Ingresa tu estatura en centímetros (ej.: 167).', error: true }); return; }
    if (!f.fecha_nacimiento) { setMsg({ t: 'Ingresa tu fecha de nacimiento: se usa para calcular tu gasto basal.', error: true }); return; }
    if (meta == null || !Number.isFinite(meta) || meta < 500) { setMsg({ t: 'Ingresa una meta diaria de calorías válida.', error: true }); return; }
    if (aj != null && (!Number.isFinite(aj) || aj < -40 || aj > 40)) { setMsg({ t: 'El ajuste debe estar entre −40 % y +40 %.', error: true }); return; }
    setGuardando(true);
    try {
      const r1 = await sb().from('perfiles').update({
        nombre: f.nombre.trim(), sexo: f.sexo, fecha_nacimiento: f.fecha_nacimiento || null, inicio_etapa: f.inicio_etapa || null,
      }).eq('id', perfil!.id);
      if (r1.error) throw r1.error;

      const nuevo = {
        estatura_cm: est, formula_basal: f.formula_basal, meta_kcal: meta, ajuste_basal_pct: aj ?? 0,
        carbos_por_hora: num(f.carbos_por_hora) ?? 40, fc_reposo: num(f.fc_reposo), fc_maxima: num(f.fc_maxima),
        nota: f.nota.trim() || null,
        // La edad se calcula desde la fecha de nacimiento; la edad fija solo existe en datos importados
        edad_fija: null,
      };
      const igual = actual && (['estatura_cm', 'formula_basal', 'meta_kcal', 'ajuste_basal_pct', 'carbos_por_hora', 'fc_reposo', 'fc_maxima'] as const)
        .every((k) => String(actual[k] ?? '') === String(nuevo[k] ?? '') || (k === 'ajuste_basal_pct' && !actual[k] && !nuevo[k]))
        && !actual.edad_fija && (actual.nota ?? null) === nuevo.nota;
      if (!igual) {
        const r2 = await sb().from('parametros_perfil').upsert({ ...nuevo, usuario_id: sesion!.user.id, vigente_desde: hoy }, { onConflict: 'usuario_id,vigente_desde' });
        if (r2.error) throw r2.error;
      }
      await recargar();
      setMsg({ t: igual ? 'Datos guardados.' : 'Datos guardados. Los cambios rigen desde hoy; tus días anteriores no se modifican.' });
    } catch (e: any) {
      const m = e.message ?? String(e);
      setMsg({ t: /ajuste_basal_pct|mifflin|check constraint/i.test(m) ? 'Falta actualizar la base de datos (migracion-002.sql en Supabase).' : m, error: true });
    } finally { setGuardando(false); }
  }

  const edad = f.fecha_nacimiento ? (() => {
    const [y, m, d] = f.fecha_nacimiento.split('-').map(Number); const [hy, hm, hd] = hoy.split('-').map(Number);
    return hy - y - (hm < m || (hm === m && hd < d) ? 1 : 0);
  })() : null;

  return (
    <>
      {!actual && <div className="aviso">Completa tus datos para que la app calcule tu gasto diario.</div>}
      <section className="card">
        <h2>Mis datos</h2>
        <div className="grid2">
          <label className="campo">Nombre<input type="text" value={f.nombre} onChange={set('nombre')} /></label>
          <label className="campo">Sexo
            <select value={f.sexo} onChange={set('sexo')}><option value="M">Hombre</option><option value="F">Mujer</option></select>
          </label>
          <label className="campo">Fecha de nacimiento<input type="date" value={f.fecha_nacimiento} onChange={set('fecha_nacimiento')} /></label>
          <label className="campo">Estatura (cm)<input type="number" inputMode="decimal" value={f.estatura_cm} onChange={set('estatura_cm')} placeholder="Ej.: 167" /></label>
        </div>
        {edad != null && <p className="sub">Edad: {edad} años (se actualiza sola en cada cumpleaños).</p>}

        <h3>Mi objetivo</h3>
        <div className="grid2">
          <label className="campo">Meta diaria de calorías<input type="number" inputMode="numeric" value={f.meta_kcal} onChange={set('meta_kcal')} /></label>
          <label className="campo">Medir mi avance desde<input type="date" value={f.inicio_etapa} onChange={set('inicio_etapa')} /></label>
        </div>
        <p className="sub">"Medir mi avance desde" es la fecha que se usa para mostrar cuántos kilos has bajado o subido.</p>

        <details className="mt">
          <summary className="sub" style={{ cursor: 'pointer' }}>Opciones avanzadas</summary>
          <label className="campo mt">Cómo calcular mi gasto basal
            <select value={f.formula_basal} onChange={set('formula_basal')}>
              <option value="mifflin_st_jeor">Recomendado (Mifflin-St Jeor)</option>
              <option value="harris_benedict">Clásico (Harris-Benedict)</option>
              <option value="katch_mcardle">Según masa magra (Katch-McArdle) · requiere % de grasa</option>
            </select>
          </label>
          <div className="grid2 mt">
            <label className="campo">Ajuste indicado por profesional (%)<input type="number" inputMode="decimal" value={f.ajuste_basal_pct} onChange={set('ajuste_basal_pct')} placeholder="Ej.: −10" /></label>
            <label className="campo">Motivo (opcional)<input type="text" maxLength={80} value={f.nota} onChange={set('nota')} /></label>
          </div>
          <p className="sub">Solo si tu médico o nutricionista te indicó que tu gasto es mayor o menor al normal (por ejemplo, por la tiroides o un medicamento). Si no, déjalo vacío.</p>
          <div className="grid3 mt">
            <label className="campo">FC en reposo<input type="number" inputMode="numeric" value={f.fc_reposo} onChange={set('fc_reposo')} /></label>
            <label className="campo">FC máxima<input type="number" inputMode="numeric" value={f.fc_maxima} onChange={set('fc_maxima')} /></label>
            <label className="campo">Carbos por hora de entreno (g)<input type="number" inputMode="numeric" value={f.carbos_por_hora} onChange={set('carbos_por_hora')} /></label>
          </div>
        </details>

        {msg && <div className={msg.error ? 'error mt' : 'exito mt'}>{msg.t}</div>}
        <button className="btn primario mt" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
      </section>

      {parametros.length > 1 && (
        <section className="card">
          <h2>Historial de mis datos <button className="btn chico" onClick={() => setVerHist(!verHist)}>{verHist ? 'Ocultar' : 'Ver'}</button></h2>
          <p className="sub" style={{ marginTop: 0 }}>Cada día se calcula con los datos que tenías en esa fecha.</p>
          {verHist && (
            <div className="tabla-wrap">
              <table className="tabla">
                <thead><tr><th>Desde</th><th>Estatura</th><th>Meta</th><th>Cálculo</th><th>Ajuste</th><th>Edad</th></tr></thead>
                <tbody>
                  {[...parametros].reverse().map((p) => (
                    <tr key={p.id}>
                      <td>{fechaCorta(p.vigente_desde)} {p === actual && <span className="chip ok">actual</span>}</td>
                      <td>{n(+p.estatura_cm)} cm</td><td>{n(+p.meta_kcal)}</td>
                      <td>{NOMBRE_FORMULA[p.formula_basal] ?? p.formula_basal}</td>
                      <td>{p.ajuste_basal_pct ? `${+p.ajuste_basal_pct > 0 ? '+' : ''}${n(+p.ajuste_basal_pct, 1)} %` : '—'}</td>
                      <td>{p.edad_fija ? `${p.edad_fija} (fija)` : 'por fecha nac.'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      <section className="card">
        <h2>Conexión</h2>
        <p className="sub" style={{ marginTop: 0 }}>Base de datos: {leerConfig()?.url}</p>
        {!import.meta.env.VITE_SUPABASE_URL && <button className="btn chico" onClick={() => { borrarConfig(); location.reload(); }}>Cambiar proyecto Supabase</button>}
      </section>
    </>
  );
}

// ---------------- Alimentos ----------------
function Alimentos() {
  const { alimentos, perfil, sesion, recargar } = useDatos();
  const [q, setQ] = useState('');
  const [editar, setEditar] = useState<Alimento | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [masiva, setMasiva] = useState(false);
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
        <div className="fila" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
          <button className="btn primario chico" onClick={() => setNuevo(true)}>+ Nuevo alimento</button>
          <button className="btn chico" onClick={() => setMasiva(true)}>Carga masiva desde Excel</button>
        </div>
        <input type="search" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
        <ul className="lista mt">
          {lista.slice(0, 200).map((a) => {
            const propio = a.propietario === sesion?.user.id;
            return (
              <li key={a.id}>
                <span className="nombre">{a.nombre}<br /><span className="sub">{n(+a.kcal, 1)} kcal · {n(+a.carbos_g, 1)} g carbos · por <strong>{a.porcion}</strong></span></span>
                <span className={`chip ${a.alcance === 'compartido' ? 'ok' : a.alcance === 'propuesto' ? 'aviso' : ''}`}>{a.alcance}</span>
                {propio && a.alcance === 'personal' && <button className="btn chico" onClick={() => cambiarAlcance(a, perfil?.es_admin ? 'compartido' : 'propuesto')}>{perfil?.es_admin ? 'Compartir' : 'Proponer'}</button>}
                {(propio && a.alcance !== 'compartido') || perfil?.es_admin ? <button className="icono-btn" onClick={() => setEditar(a)} aria-label="Editar">✎</button> : null}
              </li>
            );
          })}
        </ul>
      </section>
      {editar && <EditarAlimento a={editar} onCerrar={() => setEditar(null)} />}
      {nuevo && <NuevoAlimento onCerrar={() => setNuevo(false)} />}
      {masiva && <CargaMasiva onCerrar={() => setMasiva(false)} />}
    </>
  );
}

/** Destino de lo cargado: el administrador publica en el catálogo compartido; el resto, personal o propuesto */
function SelectorDestino({ valor, onCambio }: { valor: Alimento['alcance']; onCambio: (v: Alimento['alcance']) => void }) {
  const { perfil } = useDatos();
  return (
    <label className="campo mt">Destino
      <select value={valor} onChange={(e) => onCambio(e.target.value as Alimento['alcance'])}>
        {perfil?.es_admin && <option value="compartido">Catálogo compartido (todos los usuarios)</option>}
        <option value="personal">Solo mi catálogo</option>
        {!perfil?.es_admin && <option value="propuesto">Proponer al catálogo compartido</option>}
      </select>
    </label>
  );
}

function NuevoAlimento({ onCerrar }: { onCerrar: () => void }) {
  const { perfil, sesion, alimentos, recargar } = useDatos();
  const [f, setF] = useState({ nombre: '', kcal: '', carbos: '', porcion: '100 g', codigo: '' });
  const [destino, setDestino] = useState<Alimento['alcance']>(perfil?.es_admin ? 'compartido' : 'personal');
  const [msg, setMsg] = useState<string | null>(null);
  const [otro, setOtro] = useState(false);
  const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
  const existente = f.nombre.trim() ? alimentos.find((a) => normalizar(a.nombre) === normalizar(f.nombre.trim())) : undefined;

  async function guardar(seguir: boolean) {
    const kcal = num(f.kcal);
    if (!f.nombre.trim()) { setMsg('Ingrese el nombre.'); return; }
    if (kcal == null || !Number.isFinite(kcal) || kcal < 0) { setMsg('Ingrese las kcal por porción.'); return; }
    if (existente) { setMsg(`Ya existe "${existente.nombre}" (${n(+existente.kcal)} kcal). Edítelo desde la lista.`); return; }
    const { error } = await sb().from('alimentos').insert({
      propietario: sesion!.user.id, alcance: destino, nombre: f.nombre.trim().replace(/\s+/g, ' '), kcal,
      carbos_g: num(f.carbos) ?? 0, porcion: f.porcion.trim() || '100 g', fuente: 'propia', codigo_barra: f.codigo.trim() || null,
    });
    if (error) { setMsg(error.message); return; }
    await recargar();
    if (seguir) { setF({ nombre: '', kcal: '', carbos: '', porcion: '100 g', codigo: '' }); setMsg(`Guardado. Puede ingresar el siguiente.`); setOtro(true); }
    else onCerrar();
  }

  return (
    <Modal titulo="Nuevo alimento" onCerrar={onCerrar}>
      <label className="campo">Nombre<input type="text" value={f.nombre} onChange={(e) => { setF({ ...f, nombre: e.target.value }); setMsg(null); }} autoFocus placeholder="Ej.: Marraqueta (unidad)" /></label>
      {existente && <div className="aviso mt">Ya existe: {existente.nombre} · {n(+existente.kcal)} kcal · {n(+existente.carbos_g, 1)} g</div>}
      <div className="grid3 mt">
        <label className="campo">kcal por porción<input type="number" inputMode="decimal" value={f.kcal} onChange={(e) => setF({ ...f, kcal: e.target.value })} /></label>
        <label className="campo">Carbos (g)<input type="number" inputMode="decimal" value={f.carbos} onChange={(e) => setF({ ...f, carbos: e.target.value })} /></label>
        <label className="campo">Porción<input type="text" value={f.porcion} onChange={(e) => setF({ ...f, porcion: e.target.value })} /></label>
      </div>
      <label className="campo mt">Código de barras (opcional)<input type="text" inputMode="numeric" value={f.codigo} onChange={(e) => setF({ ...f, codigo: e.target.value })} /></label>
      <SelectorDestino valor={destino} onCambio={setDestino} />
      {msg && <div className={otro && msg.startsWith('Guardado') ? 'aviso mt' : 'error mt'}>{msg}</div>}
      <div className="fila entre mt">
        <button className="btn" onClick={() => guardar(true)}>Guardar y agregar otro</button>
        <button className="btn primario" onClick={() => guardar(false)}>Guardar</button>
      </div>
    </Modal>
  );
}

function CargaMasiva({ onCerrar }: { onCerrar: () => void }) {
  const { perfil, sesion, alimentos, recargar } = useDatos();
  const [lectura, setLectura] = useState<LecturaCatalogo | null>(null);
  const [cls, setCls] = useState<Clasificacion | null>(null);
  const [destino, setDestino] = useState<Alimento['alcance']>(perfil?.es_admin ? 'compartido' : 'personal');
  const [actualizar, setActualizar] = useState(true);
  const [estado, setEstado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [listo, setListo] = useState(false);

  async function leer(file: File) {
    setError(null); setLectura(null); setCls(null); setListo(false); setEstado('Leyendo archivo…');
    try {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const l = leerCatalogo(wb);
      setLectura(l);
      setCls(clasificar(l.filas, alimentos, sesion!.user.id, !!perfil?.es_admin));
      setEstado(null);
    } catch (e: any) { setError(e.message ?? String(e)); setEstado(null); }
  }

  async function cargar() {
    if (!cls || !sesion) return;
    setOcupado(true); setError(null);
    try {
      setEstado(`Agregando ${cls.nuevos.length} alimentos…`);
      await insertarLotes('alimentos', cls.nuevos.map((f) => ({
        propietario: sesion.user.id, alcance: destino, nombre: f.nombre, kcal: f.kcal, carbos_g: f.carbos_g,
        porcion: f.porcion, codigo_barra: f.codigo_barra, fuente: 'planilla',
      })));
      const aActualizar = actualizar ? cls.conCambios.filter((c) => c.editable) : [];
      let i = 0;
      for (const c of aActualizar) {
        setEstado(`Actualizando valores (${++i}/${aActualizar.length})…`);
        const { error } = await sb().from('alimentos').update({ kcal: c.fila.kcal, carbos_g: c.fila.carbos_g, porcion: c.fila.porcion,
          ...(c.fila.codigo_barra ? { codigo_barra: c.fila.codigo_barra } : {}) }).eq('id', c.actual.id!);
        if (error) throw new Error(`${c.fila.nombre}: ${error.message}`);
      }
      await recargar();
      setEstado(`Listo: ${cls.nuevos.length} agregados, ${aActualizar.length} actualizados.`);
      setListo(true);
    } catch (e: any) { setError(e.message ?? String(e)); setEstado(null); }
    finally { setOcupado(false); }
  }

  const editables = cls?.conCambios.filter((c) => c.editable).length ?? 0;
  return (
    <Modal titulo="Carga masiva de alimentos" onCerrar={onCerrar}>
      <p className="sub" style={{ marginTop: 0 }}>
        Use un Excel con el formato de la hoja <strong>BD Alimento</strong>: columnas <strong>Comida</strong>, <strong>Cal</strong> y <strong>Carbs</strong>{' '}
        (opcionales: Porción y Código de barras). Sirve su planilla original o la plantilla.
      </p>
      <button className="btn chico" onClick={() => descargarPlantilla()}>Descargar plantilla</button>
      <div className="mt"><input type="file" accept=".xlsx" onChange={(e) => e.target.files?.[0] && leer(e.target.files[0])} disabled={ocupado} /></div>
      {error && <div className="error mt">{error}</div>}
      {estado && <p className="sub">{estado}</p>}
      {lectura && cls && !listo && (
        <>
          <h3>Vista previa · hoja "{lectura.hoja}"</h3>
          <ul className="lista">
            <li><span className="nombre">Filas válidas leídas</span><span className="num">{lectura.filas.length}</span></li>
            <li><span className="nombre"><strong>Nuevos</strong> (se agregan)</span><span className="num"><strong>{cls.nuevos.length}</strong></span></li>
            <li><span className="nombre">Ya existen con los mismos valores (se omiten)</span><span className="num">{cls.sinCambios.length}</span></li>
            <li><span className="nombre">Ya existen con valores distintos</span><span className="num">{cls.conCambios.length}</span></li>
            {lectura.repetidasEnArchivo > 0 && <li><span className="nombre">Repetidos dentro del archivo (se usa la última fila)</span><span className="num">{lectura.repetidasEnArchivo}</span></li>}
            {lectura.errores.length > 0 && <li><span className="nombre">Filas con error (se omiten)</span><span className="num">{lectura.errores.length}</span></li>}
          </ul>
          {lectura.errores.length > 0 && (
            <details className="mt"><summary className="sub">Ver filas con error</summary>
              <ul className="lista">{lectura.errores.slice(0, 50).map((e) => <li key={e.fila}><span className="nombre">Fila {e.fila}: {e.texto}</span><span className="sub">{e.motivo}</span></li>)}</ul>
            </details>
          )}
          {cls.conCambios.length > 0 && (
            <details className="mt"><summary className="sub">Ver diferencias ({cls.conCambios.length})</summary>
              <div className="tabla-wrap"><table className="tabla">
                <thead><tr><th>Alimento</th><th>kcal actual</th><th>kcal archivo</th><th>Carbos actual</th><th>Carbos archivo</th></tr></thead>
                <tbody>{cls.conCambios.slice(0, 100).map((c) => (
                  <tr key={c.fila.fila}><td>{c.fila.nombre}{!c.editable && <span className="chip"> sin permiso</span>}</td>
                    <td>{n(+c.actual.kcal, 1)}</td><td>{n(c.fila.kcal, 1)}</td><td>{n(+c.actual.carbos_g, 1)}</td><td>{n(c.fila.carbos_g, 1)}</td></tr>
                ))}</tbody>
              </table></div>
            </details>
          )}
          {cls.conCambios.length > 0 && (
            <label className="fila mt"><input type="checkbox" checked={actualizar} onChange={(e) => setActualizar(e.target.checked)} />
              Actualizar los valores de los {editables} existentes que puedo editar</label>
          )}
          <SelectorDestino valor={destino} onCambio={setDestino} />
          <p className="sub">Los consumos ya registrados no cambian: cada uno guarda sus propios valores.</p>
          <button className="btn primario mt" onClick={cargar} disabled={ocupado || (cls.nuevos.length === 0 && (!actualizar || editables === 0))}>
            {ocupado ? 'Cargando…' : `Agregar ${cls.nuevos.length}${actualizar && editables ? ` y actualizar ${editables}` : ''}`}
          </button>
        </>
      )}
      {listo && <button className="btn primario mt" onClick={onCerrar}>Cerrar</button>}
    </Modal>
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
