import { useEffect, type ReactNode } from 'react';

export function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    // Con el teclado abierto (iOS) el área visible se achica: la ventana se ajusta a ese alto real
    const vv = window.visualViewport;
    const ajustar = () => {
      if (!vv) return;
      document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
      document.documentElement.style.setProperty('--vvt', `${vv.offsetTop}px`);
    };
    ajustar();
    vv?.addEventListener('resize', ajustar);
    vv?.addEventListener('scroll', ajustar);
    return () => {
      window.removeEventListener('keydown', k); document.body.style.overflow = '';
      vv?.removeEventListener('resize', ajustar); vv?.removeEventListener('scroll', ajustar);
    };
  }, [onCerrar]);
  return (
    <div className="modal-fondo" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titulo}>
        <h2>{titulo}<button className="icono-btn" onClick={onCerrar} aria-label="Cerrar">✕</button></h2>
        {children}
      </div>
    </div>
  );
}

export function Kpi({ valor, etiqueta, destacado, clase }: { valor: ReactNode; etiqueta: string; destacado?: boolean; clase?: string }) {
  return (
    <div className={`kpi${destacado ? ' destacado' : ''}`}>
      <div className={`v ${clase ?? ''}`}>{valor}</div>
      <div className="l">{etiqueta}</div>
    </div>
  );
}

const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const Icono = {
  hoy: () => <svg {...p}><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>,
  progreso: () => <svg {...p}><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>,
  historial: () => <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>,
  entreno: () => <svg {...p}><circle cx="6" cy="17" r="3.5" /><circle cx="18" cy="17" r="3.5" /><path d="M6 17l4-8h5l3 8M10 9l-1-3H7M15 9l1-3h2" /></svg>,
  mas: () => <svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.5-6 8-6s7 2 8 6" /></svg>,
};
