import { useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { guardarConfig, leerConfig, sb } from './lib/supabase';
import { ProveedorDatos, useDatos } from './lib/datos';
import { Icono } from './components/ui';
import Hoy from './pages/Hoy';
import Progreso from './pages/Progreso';
import Historial from './pages/Historial';
import Entreno from './pages/Entreno';
import Mas from './pages/Mas';

export default function App() {
  const [config, setConfig] = useState(leerConfig());
  if (!config) return <Configuracion onListo={() => setConfig(leerConfig())} />;
  return (
    <ProveedorDatos>
      <Puerta />
    </ProveedorDatos>
  );
}

function Puerta() {
  const { sesion, cargando, error, perfil } = useDatos();
  if (!sesion) return cargando ? <div className="centro sub">Cargando…</div> : <Login />;
  if (!perfil) return <div className="centro">{error ? <div className="error">{error}</div> : <span className="sub">Cargando datos…</span>}</div>;
  return (
    <HashRouter>
      <main className="app">
        {error && <div className="error">{error}</div>}
        <Routes>
          <Route path="/" element={<Hoy />} />
          <Route path="/progreso" element={<Progreso />} />
          <Route path="/historial" element={<Historial />} />
          <Route path="/entreno" element={<Entreno />} />
          <Route path="/mas" element={<Mas />} />
        </Routes>
      </main>
      <nav className="nav">
        <NavLink to="/" end><Icono.hoy />Hoy</NavLink>
        <NavLink to="/progreso"><Icono.progreso />Progreso</NavLink>
        <NavLink to="/historial"><Icono.historial />Historial</NavLink>
        <NavLink to="/entreno"><Icono.entreno />Entreno</NavLink>
        <NavLink to="/mas"><Icono.mas />Más</NavLink>
      </nav>
    </HashRouter>
  );
}

function Login() {
  const [modo, setModo] = useState<'entrar' | 'crear'>('entrar');
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [nombre, setNombre] = useState('');
  const [msg, setMsg] = useState<{ t: string; error?: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true); setMsg(null);
    const r = modo === 'entrar'
      ? await sb().auth.signInWithPassword({ email: email.trim().toLowerCase(), password: clave })
      : await sb().auth.signUp({ email: email.trim().toLowerCase(), password: clave, options: { data: { nombre }, emailRedirectTo: location.origin + location.pathname } });
    setOcupado(false);
    if (r.error) setMsg({ t: r.error.message, error: true });
    else if (modo === 'crear' && !r.data.session) setMsg({ t: 'Cuenta creada. Revise su correo para confirmarla y luego ingrese.' });
  }

  return (
    <div className="centro" style={{ padding: 16 }}>
      <form className="card login" onSubmit={enviar}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px' }}>Control de Peso</h1>
        <p className="sub" style={{ marginTop: 0 }}>Peso, balance energético y entrenamiento.</p>
        {modo === 'crear' && <label className="campo">Nombre<input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} /></label>}
        <label className="campo mt">Correo<input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="campo mt">Contraseña<input type="password" autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'} value={clave} onChange={(e) => setClave(e.target.value)} minLength={6} required /></label>
        {msg && <div className={msg.error ? 'error mt' : 'aviso mt'}>{msg.t}</div>}
        <button className="btn primario mt" style={{ width: '100%' }} disabled={ocupado}>{modo === 'entrar' ? 'Ingresar' : 'Crear cuenta'}</button>
        <button type="button" className="btn texto mt" onClick={() => { setModo(modo === 'entrar' ? 'crear' : 'entrar'); setMsg(null); }}>
          {modo === 'entrar' ? 'Crear una cuenta nueva' : 'Ya tengo cuenta'}
        </button>
      </form>
    </div>
  );
}

function Configuracion({ onListo }: { onListo: () => void }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  return (
    <div className="centro" style={{ padding: 16 }}>
      <form className="card login" onSubmit={(e) => { e.preventDefault(); guardarConfig(url, key); onListo(); }}>
        <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Conectar base de datos</h1>
        <p className="sub" style={{ marginTop: 0 }}>
          Ingrese los datos de su proyecto Supabase (Project Settings → API). Solo se necesita una vez por dispositivo,
          o nunca si se configuran como variables del despliegue en GitHub.
        </p>
        <label className="campo">Project URL<input type="text" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} required /></label>
        <label className="campo mt">Clave pública (anon / publishable)<input type="text" value={key} onChange={(e) => setKey(e.target.value)} required /></label>
        <button className="btn primario mt" style={{ width: '100%' }}>Conectar</button>
      </form>
    </div>
  );
}
