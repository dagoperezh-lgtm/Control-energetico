import { useCallback, useMemo, useState } from 'react';
import { Modal } from './ui';
import { Escaner } from './Escaner';
import { useDatos } from '../lib/datos';
import { sb } from '../lib/supabase';
import { aAlimento, buscarCodigoBarra, buscarOFF, buscarUSDA, normalizar, type ResultadoExterno } from '../lib/fuentesAlimentos';
import { COMIDAS, type Alimento, type Comida } from '../lib/types';
import { n } from '../lib/formato';
import { PORCION_BASE } from '../lib/porciones';
import { SelectorCantidad } from './Cantidad';

type Pestana = 'mis' | 'web' | 'escanear' | 'nuevo';
type Elegido = { alimento: Alimento; externo?: ResultadoExterno };

export function SelectorAlimento({ fecha, comida: comidaIni, onCerrar }: { fecha: string; comida: Comida; onCerrar: () => void }) {
  const { alimentos, consumos, sesion, recargar } = useDatos();
  const [pestana, setPestana] = useState<Pestana>('mis');
  const [q, setQ] = useState('');
  const [comida, setComida] = useState<Comida>(comidaIni);
  const [elegido, setElegido] = useState<Elegido | null>(null);
  const [cantidad, setCantidad] = useState(1);
  const [web, setWeb] = useState<ResultadoExterno[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [nuevo, setNuevo] = useState({ nombre: '', kcal: '', carbos: '', porcion: PORCION_BASE });

  // Frecuencia de uso para ordenar "Mis alimentos"
  const frecuencia = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of consumos) if (c.alimento_id) m.set(c.alimento_id, (m.get(c.alimento_id) ?? 0) + 1);
    return m;
  }, [consumos]);

  const locales = useMemo(() => {
    const t = normalizar(q.trim());
    return alimentos
      .filter((a) => !t || normalizar(a.nombre).includes(t))
      .sort((a, b) => (frecuencia.get(b.id!) ?? 0) - (frecuencia.get(a.id!) ?? 0) || a.nombre.localeCompare(b.nombre))
      .slice(0, 60);
  }, [alimentos, q, frecuencia]);

  async function buscarWeb() {
    if (!q.trim()) return;
    setBuscando(true); setMsg(null); setWeb([]);
    const [off, usda] = await Promise.allSettled([buscarOFF(q), buscarUSDA(q)]);
    const res = [...(off.status === 'fulfilled' ? off.value : []), ...(usda.status === 'fulfilled' ? usda.value : [])];
    setWeb(res);
    if (!res.length) setMsg(off.status === 'rejected' && usda.status === 'rejected' ? 'Las fuentes externas no respondieron. Intente de nuevo.' : 'Sin resultados.');
    setBuscando(false);
  }

  const alCodigo = useCallback(async (codigo: string) => {
    const local = alimentos.find((a) => a.codigo_barra === codigo);
    if (local) { setElegido({ alimento: local }); return; }
    setMsg(`Buscando ${codigo}…`);
    const r = await buscarCodigoBarra(codigo);
    if (r) { setMsg(null); setElegido({ alimento: aAlimento(r), externo: r }); }
    else { setMsg(`El código ${codigo} no está en Open Food Facts. Créelo en "Nuevo".`); setPestana('nuevo'); }
  }, [alimentos]);

  async function guardar() {
    if (!elegido || !sesion) return;
    setGuardando(true); setMsg(null);
    try {
      let a = elegido.alimento;
      // Un alimento externo o nuevo queda en el catálogo personal: el catálogo crece con el uso
      if (!a.id) {
        const existente = alimentos.find((x) => normalizar(x.nombre) === normalizar(a.nombre) && x.propietario === sesion.user.id);
        if (existente) a = existente;
        else {
          const { data, error } = await sb().from('alimentos').insert({ ...a, propietario: sesion.user.id, alcance: 'personal' }).select().single();
          if (error) throw error;
          a = data as Alimento;
        }
      }
      const cant = cantidad;
      if (!(cant > 0)) throw new Error('Cantidad inválida');
      const { error } = await sb().from('consumos').insert({
        usuario_id: sesion.user.id, fecha, comida, alimento_id: a.id ?? null, nombre: a.nombre,
        kcal_unidad: a.kcal, carbos_unidad: a.carbos_g, cantidad: cant,
      });
      if (error) throw error;
      await recargar();
      onCerrar();
    } catch (e: any) {
      setMsg(e.message ?? String(e));
    } finally {
      setGuardando(false);
    }
  }

  if (elegido) {
    const a = elegido.alimento;
    const cant = cantidad || 0;
    return (
      <Modal titulo="Agregar consumo" onCerrar={onCerrar}>
        <div className="card" style={{ marginBottom: 12 }}>
          <strong>{a.nombre}</strong>
          <div className="sub">{n(a.kcal, 1)} kcal · {n(a.carbos_g, 1)} g carbos por {a.porcion}{elegido.externo?.detalle ? ` · ${elegido.externo.detalle}` : ''}</div>
        </div>
        <SelectorCantidad valor={cantidad} onCambio={setCantidad} porcion={a.porcion || PORCION_BASE} />
        <div className="mt">
          <label className="campo">Comida
            <select value={comida} onChange={(e) => setComida(e.target.value as Comida)}>
              {COMIDAS.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
        </div>
        <p className="sub">Total: <strong>{n(a.kcal * cant, 0)} kcal</strong> · {n(a.carbos_g * cant, 1)} g carbos</p>
        {msg && <div className="error">{msg}</div>}
        <div className="fila entre mt">
          <button className="btn" onClick={() => setElegido(null)}>Volver</button>
          <button className="btn primario" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Agregar'}</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo="Buscar alimento" onCerrar={onCerrar}>
      <div className="tabs">
        {([['mis', 'Mis alimentos'], ['web', 'Internet'], ['escanear', 'Escanear'], ['nuevo', 'Nuevo']] as [Pestana, string][]).map(([k, t]) => (
          <button key={k} className={pestana === k ? 'activo' : ''} onClick={() => { setPestana(k); setMsg(null); }}>{t}</button>
        ))}
      </div>

      {(pestana === 'mis' || pestana === 'web') && (
        <form className="fila" onSubmit={(e) => { e.preventDefault(); if (pestana === 'web') buscarWeb(); }}>
          <input type="search" placeholder={pestana === 'mis' ? 'Filtrar catálogo…' : 'Ej.: yogur natural, avena…'} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {pestana === 'web' && <button className="btn primario" disabled={buscando}>{buscando ? '…' : 'Buscar'}</button>}
        </form>
      )}
      {msg && <div className="aviso mt">{msg}</div>}

      {pestana === 'mis' && (
        <ul className="lista mt">
          {locales.map((a) => (
            <li key={a.id} onClick={() => setElegido({ alimento: a })} style={{ cursor: 'pointer' }}>
              <span className="nombre">{a.nombre} {a.alcance === 'compartido' && <span className="chip ok">compartido</span>}</span>
              <span className="num sub">{n(a.kcal, 0)} kcal / {a.porcion}</span>
            </li>
          ))}
          {!locales.length && <li className="vacio">Sin coincidencias. Pruebe en "Internet".</li>}
        </ul>
      )}

      {pestana === 'web' && (
        <ul className="lista mt">
          {web.map((r) => (
            <li key={r.fuente + r.ref_externa} onClick={() => setElegido({ alimento: aAlimento(r), externo: r })} style={{ cursor: 'pointer' }}>
              <span className="nombre">{r.nombre} <span className="chip">{r.fuente === 'usda' ? 'USDA' : 'Open Food Facts'}</span></span>
              <span className="num sub">{n(r.kcal, 0)} kcal/{r.porcion}</span>
            </li>
          ))}
        </ul>
      )}

      {pestana === 'escanear' && <Escaner onCodigo={alCodigo} />}

      {pestana === 'nuevo' && (
        <form onSubmit={(e) => {
          e.preventDefault();
          const kcal = parseFloat(nuevo.kcal.replace(',', '.'));
          if (!nuevo.nombre.trim() || !(kcal >= 0)) { setMsg('Ingrese nombre y kcal.'); return; }
          setElegido({ alimento: { alcance: 'personal', nombre: nuevo.nombre.trim(), kcal, carbos_g: parseFloat(nuevo.carbos.replace(',', '.')) || 0, porcion: nuevo.porcion || PORCION_BASE, fuente: 'propia' } });
        }}>
          <label className="campo">Nombre<input type="text" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></label>
          <div className="grid3 mt">
            <label className="campo">kcal<input type="number" inputMode="decimal" value={nuevo.kcal} onChange={(e) => setNuevo({ ...nuevo, kcal: e.target.value })} /></label>
            <label className="campo">Carbos (g)<input type="number" inputMode="decimal" value={nuevo.carbos} onChange={(e) => setNuevo({ ...nuevo, carbos: e.target.value })} /></label>
            <label className="campo">Porción<input type="text" value={nuevo.porcion} onChange={(e) => setNuevo({ ...nuevo, porcion: e.target.value })} /></label>
          </div>
          <button className="btn primario mt">Continuar</button>
        </form>
      )}
    </Modal>
  );
}
