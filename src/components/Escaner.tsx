import { useEffect, useRef, useState } from 'react';

/** Escáner de código de barras con la cámara (ZXing; funciona en Safari iOS). */
export function Escaner({ onCodigo }: { onCodigo: (codigo: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let controles: { stop: () => void } | null = null;
    let activo = true;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const lector = new BrowserMultiFormatReader();
        controles = await lector.decodeFromConstraints(
          { video: { facingMode: 'environment' } }, video.current!,
          (res) => { if (res && activo) { activo = false; controles?.stop(); onCodigo(res.getText()); } },
        );
      } catch (e: any) {
        setError(e?.name === 'NotAllowedError' ? 'Permiso de cámara denegado.' : `No se pudo abrir la cámara: ${e?.message ?? e}`);
      }
    })();
    return () => { activo = false; controles?.stop(); };
  }, [onCodigo]);

  return (
    <div>
      {error ? <div className="error">{error}</div> : <video ref={video} className="video-escaner" muted playsInline />}
      <p className="sub">Apunte al código de barras del envase.</p>
    </div>
  );
}
