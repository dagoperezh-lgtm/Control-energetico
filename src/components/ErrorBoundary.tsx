import { Component, type ReactNode } from 'react';

/**
 * Evita la pantalla en blanco: si una pestaña falla al dibujarse, muestra el error
 * (para poder informarlo) y permite reintentar sin cerrar la app.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; nombre: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(`[${this.props.nombre}]`, error, info.componentStack);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="card">
        <h2>No se pudo mostrar {this.props.nombre}</h2>
        <p className="sub" style={{ marginTop: 0 }}>Ocurrió un error al dibujar esta pestaña. El resto de la app sigue funcionando y tus datos no se perdieron.</p>
        <div className="error" style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, wordBreak: 'break-word' }}>
          {error.name}: {error.message}
          {error.stack && <div style={{ marginTop: 6, opacity: 0.8 }}>{error.stack.split('\n').slice(0, 4).join(' · ')}</div>}
        </div>
        <p className="sub">Si se repite, envía una captura de este mensaje.</p>
        <button className="btn primario" onClick={() => this.setState({ error: null })}>Reintentar</button>
      </section>
    );
  }
}
