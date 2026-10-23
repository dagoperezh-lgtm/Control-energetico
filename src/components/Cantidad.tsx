import { useEffect, useState } from 'react';
import { equivalencia, FRACCIONES, fraccion } from '../lib/porciones';

/** Selector de cantidad: accesos rápidos ¼ ½ ¾ 1 1½ 2 3 y campo libre */
export function SelectorCantidad({ valor, onCambio, porcion }: { valor: number; onCambio: (v: number) => void; porcion: string }) {
  const [texto, setTexto] = useState(String(valor).replace('.', ','));
  useEffect(() => { setTexto(String(valor).replace('.', ',')); }, [valor]);
  const eq = equivalencia(porcion, valor);
  return (
    <div>
      <div className="sub" style={{ marginBottom: 6 }}>Cantidad en porciones de <strong>{porcion}</strong></div>
      <div className="fila" style={{ flexWrap: 'wrap', gap: 6 }}>
        {FRACCIONES.map((f) => (
          <button key={f} type="button" className={`btn chico${Math.abs(valor - f) < 0.001 ? ' primario' : ''}`} style={{ minWidth: 44 }}
            onClick={() => onCambio(f)}>{fraccion(f)}</button>
        ))}
      </div>
      <div className="fila mt">
        <input type="text" inputMode="decimal" value={texto} style={{ maxWidth: 110 }} aria-label="Cantidad"
          onChange={(e) => {
            setTexto(e.target.value);
            const x = parseFloat(e.target.value.replace(',', '.'));
            if (Number.isFinite(x) && x >= 0) onCambio(x);
          }} />
        <span className="sub">× {porcion}{eq ? ` = ${eq}` : ''}</span>
      </div>
    </div>
  );
}
