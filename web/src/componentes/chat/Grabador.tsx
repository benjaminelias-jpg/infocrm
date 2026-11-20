import { useEffect, useRef, useState } from 'react';
import { Boton, useAviso } from '../../ui';
import { aWav, LIMITE_BYTES, MAX_SEGUNDOS_AUDIO, mmss } from './recursos';

// Grabador de audios del founder: muestra el nivel de la voz, el avance
// hasta el máximo (1:40) y corta solo al llegar. Devuelve un WAV mono de
// 16 kHz (lo que Instagram acepta como nota de voz).

export function Grabador({ onListo, autoEmpezar }: { onListo: (wav: Blob | null) => void; autoEmpezar?: boolean }) {
  const aviso = useAviso();
  const [grabando, setGrabando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [nivel, setNivel] = useState(0);
  const [vista, setVista] = useState<string | null>(null);
  const grabadora = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);
  const reloj = useRef<number | null>(null);
  const cuadro = useRef<number | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const flujo = useRef<MediaStream | null>(null);
  const inicio = useRef(0);

  function limpiar() {
    if (reloj.current) window.clearInterval(reloj.current);
    if (cuadro.current) cancelAnimationFrame(cuadro.current);
    reloj.current = null; cuadro.current = null;
    flujo.current?.getTracks().forEach((t) => t.stop());
    flujo.current = null;
    ctx.current?.close().catch(() => {});
    ctx.current = null;
  }
  useEffect(() => () => { limpiar(); if (grabadora.current?.state === 'recording') grabadora.current.stop(); }, []);
  useEffect(() => () => { if (vista) URL.revokeObjectURL(vista); }, [vista]);

  async function empezar() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      flujo.current = stream;
      trozos.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size) trozos.current.push(e.data); };
      mr.onstop = async () => {
        limpiar();
        setGrabando(false);
        setProcesando(true);
        try {
          const wav = await aWav(new Blob(trozos.current, { type: mr.mimeType || 'audio/webm' }));
          if (wav.size > LIMITE_BYTES) { aviso.error('Quedó muy largo para Instagram (máximo 1:40). Grabalo un poco más corto.'); onListo(null); return; }
          setVista(URL.createObjectURL(wav));
          onListo(wav);
        } catch {
          aviso.error('No pudimos procesar la grabación. Probá de nuevo o subí un archivo.');
          onListo(null);
        } finally { setProcesando(false); }
      };
      // Nivel de la voz en vivo (para saber que el micrófono te está escuchando).
      const C = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      const ac = new C();
      ctx.current = ac;
      const an = ac.createAnalyser();
      an.fftSize = 512;
      ac.createMediaStreamSource(stream).connect(an);
      const datos = new Uint8Array(an.fftSize);
      const medir = () => {
        an.getByteTimeDomainData(datos);
        let s = 0;
        for (const v of datos) s += ((v - 128) / 128) ** 2;
        setNivel(Math.min(1, Math.sqrt(s / datos.length) * 3.2));
        cuadro.current = requestAnimationFrame(medir);
      };
      medir();
      mr.start();
      grabadora.current = mr;
      inicio.current = Date.now();
      setSegundos(0);
      setVista(null);
      onListo(null);
      reloj.current = window.setInterval(() => {
        const s = Math.floor((Date.now() - inicio.current) / 1000);
        setSegundos(s);
        if (s >= MAX_SEGUNDOS_AUDIO && grabadora.current?.state === 'recording') {
          grabadora.current.stop();
          aviso.info('Llegaste al máximo (1:40): el audio quedó grabado hasta ahí.');
        }
      }, 250);
      setGrabando(true);
    } catch {
      limpiar();
      aviso.error('No pudimos usar el micrófono. Dale permiso en el navegador o subí un archivo de audio.');
    }
  }
  function parar() { if (grabadora.current?.state === 'recording') grabadora.current.stop(); }

  useEffect(() => { if (autoEmpezar) empezar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const avance = Math.min(1, segundos / MAX_SEGUNDOS_AUDIO);
  return (
    <div className="space-y-2">
      {grabando ? (
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'color-mix(in srgb, var(--status-critical) 8%, var(--surface-1))' }}>
          <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
            <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: 'var(--status-critical)' }} />
            <span className="relative h-3 w-3 rounded-full" style={{ background: 'var(--status-critical)' }} />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="font-medium">Grabando… <span className="cifras">{mmss(segundos)}</span></span>
              <span className="cifras text-[var(--text-muted)]">máx. {mmss(MAX_SEGUNDOS_AUDIO)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--gridline)' }} role="progressbar"
              aria-valuemin={0} aria-valuemax={MAX_SEGUNDOS_AUDIO} aria-valuenow={segundos} aria-label="Tiempo grabado">
              <div className="h-full rounded-full" style={{ width: `${avance * 100}%`, background: avance > 0.85 ? 'var(--status-warning)' : 'var(--status-critical)' }} />
            </div>
            <div className="flex h-3 items-end gap-[2px]" aria-hidden>
              {Array.from({ length: 24 }, (_, i) => (
                <span key={i} className="w-1 rounded-full transition-[height] duration-75"
                  style={{ height: `${Math.max(12, Math.min(100, nivel * 100 * (0.6 + ((i * 7) % 5) / 10)))}%`, background: 'var(--series-1)', opacity: 0.35 + nivel * 0.65 }} />
              ))}
            </div>
          </div>
          <Boton tamano="sm" variante="peligro" onClick={parar}>■ Listo</Boton>
        </div>
      ) : procesando ? (
        <div className="rounded-xl px-3 py-2.5 text-[12px] text-[var(--text-muted)]" style={{ background: 'var(--page-plane)' }}>Preparando el audio…</div>
      ) : vista ? (
        <div className="space-y-1.5">
          <audio controls src={vista} className="h-9 w-full" />
          <Boton tamano="sm" variante="fantasma" onClick={empezar}>Grabar de nuevo</Boton>
        </div>
      ) : (
        <Boton variante="primario" onClick={empezar} icono={<span aria-hidden>🎙️</span>}>Grabar</Boton>
      )}
    </div>
  );
}
