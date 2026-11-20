import { useRef, useState } from 'react';
import { api, fmtNum } from '../api';

// Biblioteca de recursos del Chat: audios del founder, PDFs, imágenes,
// enlaces y respuestas rápidas. Vive dentro del Chat (no es una pestaña):
// el orden de esta lista es el orden de los atajos del setter.

export const ICONO_RECURSO: Record<string, string> = {
  audio: '🎙️', imagen: '🖼️', video: '🎬', pdf: '📄', texto: '⚡', link: '🔗',
};

const LIMITE_BYTES = 3_200_000;

function aBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

/**
 * Convierte cualquier audio a WAV mono de 16 kHz. Instagram acepta WAV como
 * nota de voz; lo que graba Chrome (webm/opus) o un mp3 no siempre.
 * 16 kHz mono = voz clara y ~100 s por cada 3 MB.
 */
async function aWav(blob: Blob): Promise<Blob> {
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  try {
    const original = await ctx.decodeAudioData(await blob.arrayBuffer());
    const hz = 16000;
    const offline = new OfflineAudioContext(1, Math.ceil(original.duration * hz), hz);
    const src = offline.createBufferSource();
    src.buffer = original;
    src.connect(offline.destination);
    src.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const txt = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    txt(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); txt(8, 'WAVE');
    txt(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, hz, true); v.setUint32(28, hz * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    txt(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  } finally {
    ctx.close().catch(() => {});
  }
}

const RAPIDAS_SUGERIDAS = [
  ['Saludo', '¡Hola {{nombre}}! 👋 Gracias por escribir. ¿Qué te gustaría lograr?'],
  ['Te paso la info', 'Te paso la info 👇'],
  ['Proponer llamada', '¿Te viene bien una llamada corta para contarte cómo funciona?'],
  ['Pedir horario', '¿Qué día y hora te queda cómodo?'],
  ['Antes del link', '¡Genial! Te mando el link de pago 🙌'],
];

export default function GestorRecursos({
  recursos, onCambio, onCerrar,
}: { recursos: any[]; onCambio: () => Promise<void> | void; onCerrar?: () => void }) {
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [modo, setModo] = useState<null | 'audio' | 'link' | 'texto'>(null);
  const [nombre, setNombre] = useState('');
  const [valor, setValor] = useState('');
  const [grabando, setGrabando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<string | null>(null);
  const grabadora = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);
  const grabado = useRef<Blob | null>(null);
  const reloj = useRef<number | null>(null);

  function limpiar() {
    setModo(null); setNombre(''); setValor(''); setPreview(null); grabado.current = null;
  }

  async function crear(cuerpo: any, ok: string) {
    setOcupado(true);
    try {
      await api('/recursos', { method: 'POST', json: cuerpo });
      setAviso(ok); limpiar(); await onCambio();
    } catch (e: any) { setAviso(e.message); } finally { setOcupado(false); }
  }

  async function empezar() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      trozos.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size) trozos.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (reloj.current) window.clearInterval(reloj.current);
        try {
          const wav = await aWav(new Blob(trozos.current, { type: mr.mimeType || 'audio/webm' }));
          grabado.current = wav;
          setPreview(URL.createObjectURL(wav));
          if (wav.size > LIMITE_BYTES) setAviso('Quedó muy largo para Instagram (máx. ~1:40 min). Grabalo un poco más corto.');
        } catch {
          setAviso('No pude procesar la grabación. Probá de nuevo o subí un archivo.');
        }
      };
      mr.start();
      grabadora.current = mr;
      setSegundos(0);
      reloj.current = window.setInterval(() => setSegundos((s) => s + 1), 1000);
      setGrabando(true);
      setAviso(null);
    } catch {
      setAviso('No pude usar el micrófono. Dale permiso en el navegador o subí un archivo.');
    }
  }
  function parar() { grabadora.current?.stop(); setGrabando(false); }

  async function guardarAudio() {
    if (!grabado.current) return;
    if (!nombre.trim()) { setAviso('Ponele un nombre al audio (ej. "Bienvenida").'); return; }
    if (grabado.current.size > LIMITE_BYTES) { setAviso('El audio es muy largo (máx. ~1:40 min).'); return; }
    await crear({ nombre: nombre.trim(), tipo: 'audio', mime: 'audio/wav', archivo_base64: await aBase64(grabado.current) },
      'Audio guardado. Ya aparece como atajo en el Chat.');
  }

  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setOcupado(true);
    try {
      let blob: Blob = f;
      let mime = f.type || 'application/octet-stream';
      const tipo = mime.startsWith('audio') ? 'audio' : mime.startsWith('image') ? 'imagen'
        : mime.startsWith('video') ? 'video' : mime === 'application/pdf' ? 'pdf' : null;
      if (!tipo) { setAviso('Ese tipo de archivo no se puede mandar por Instagram. Usá audio, imagen, video o PDF.'); return; }
      // Instagram acepta audio aac/m4a/wav/mp4: lo demás se convierte a WAV.
      if (tipo === 'audio' && !/(aac|m4a|mp4|wav|x-wav)/.test(mime)) {
        blob = await aWav(f); mime = 'audio/wav';
      }
      if (blob.size > LIMITE_BYTES) { setAviso('El archivo pasa de ~3 MB. Usá uno más liviano o pegá un enlace.'); return; }
      await crear({ nombre: f.name.replace(/\.[^.]+$/, ''), tipo, mime, archivo_base64: await aBase64(blob) },
        'Archivo subido. Ya aparece como atajo en el Chat.');
    } catch (err: any) {
      setAviso(err?.message ?? 'No se pudo subir.');
    } finally { setOcupado(false); }
  }

  async function guardarLinkOTexto() {
    if (!nombre.trim() || !valor.trim()) { setAviso('Completá el nombre y el contenido.'); return; }
    if (modo === 'link') {
      if (!/^https?:\/\//.test(valor.trim())) { setAviso('El enlace tiene que empezar con https://'); return; }
      await crear({ nombre: nombre.trim(), tipo: 'link', url: valor.trim() }, 'Enlace guardado.');
    } else {
      await crear({ nombre: nombre.trim(), tipo: 'texto', texto: valor.trim() }, 'Respuesta rápida guardada.');
    }
  }

  async function sugeridas() {
    setOcupado(true);
    try {
      for (const [n, t] of [...RAPIDAS_SUGERIDAS].reverse()) {
        await api('/recursos', { method: 'POST', json: { nombre: n, tipo: 'texto', texto: t } });
      }
      setAviso('Listo: 5 respuestas rápidas creadas. Editalas o borralas cuando quieras.');
      await onCambio();
    } finally { setOcupado(false); }
  }

  async function mover(i: number, d: -1 | 1) {
    const ids = recursos.map((r) => r.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await api('/recursos/reordenar', { method: 'POST', json: { ids } });
    await onCambio();
  }
  async function renombrar(r: any, n: string) {
    setEditando(null);
    if (!n.trim() || n === r.nombre) return;
    await api(`/recursos/${r.id}`, { method: 'PATCH', json: { nombre: n.trim() } });
    await onCambio();
  }
  async function borrar(id: string) {
    setBorrando(null);
    await api(`/recursos/${id}`, { method: 'DELETE' });
    await onCambio();
  }

  const mmss = `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, '0')}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border-hairline)] px-3 py-2.5">
        <div>
          <div className="text-[13px] font-semibold">Recursos y atajos</div>
          <div className="text-[11px] text-[var(--text-muted)]">En este orden salen en el Chat</div>
        </div>
        {onCerrar && <button onClick={onCerrar} className="rounded px-2 py-1 text-[12px] hover:bg-[var(--surface-1)]" aria-label="Cerrar">✕</button>}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {aviso && (
          <div className="mb-2 rounded-md px-2.5 py-1.5 text-[11px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
            {aviso}
          </div>
        )}

        {/* Agregar */}
        {!modo && (
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => { limpiar(); setModo('audio'); }} disabled={ocupado}
              className="rounded-md px-2 py-2 text-[12px] font-medium text-white" style={{ background: 'var(--status-critical)' }}>
              🎙️ Grabar audio
            </button>
            <label className="cursor-pointer rounded-md border border-[var(--border-hairline)] px-2 py-2 text-center text-[12px] hover:bg-[var(--surface-1)]">
              ⬆ Subir archivo
              <input type="file" accept="audio/*,image/*,video/*,application/pdf" onChange={subir} className="hidden" />
            </label>
            <button onClick={() => { limpiar(); setModo('texto'); }} className="rounded-md border border-[var(--border-hairline)] px-2 py-2 text-[12px] hover:bg-[var(--surface-1)]">⚡ Respuesta rápida</button>
            <button onClick={() => { limpiar(); setModo('link'); }} className="rounded-md border border-[var(--border-hairline)] px-2 py-2 text-[12px] hover:bg-[var(--surface-1)]">🔗 Enlace</button>
          </div>
        )}

        {modo === 'audio' && (
          <div className="tarjeta p-3">
            <div className="mb-1 text-[12px] font-medium">Audio del founder</div>
            <p className="mb-2 text-[11px] text-[var(--text-secondary)]">
              Grabalo una vez: tus setters lo mandan con un clic y le llega al lead como nota de voz.
            </p>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder='Nombre (ej. "Bienvenida")'
              className="mb-2 w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1.5 text-[12px] outline-none" />
            <div className="flex flex-wrap items-center gap-1.5">
              {!grabando && !preview && (
                <button onClick={empezar} className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: 'var(--status-critical)' }}>● Grabar</button>
              )}
              {grabando && (
                <button onClick={parar} className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white" style={{ background: 'var(--status-critical)' }}>■ Detener · {mmss}</button>
              )}
              {preview && (
                <>
                  <audio controls src={preview} className="h-8 w-full" />
                  <button onClick={guardarAudio} disabled={ocupado} className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--series-1)' }}>
                    {ocupado ? 'Guardando…' : 'Guardar'}
                  </button>
                  <button onClick={() => { setPreview(null); grabado.current = null; }} className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px]">Grabar otro</button>
                </>
              )}
              <button onClick={limpiar} className="ml-auto text-[11px] text-[var(--text-muted)] underline">cancelar</button>
            </div>
            <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">Hasta ~1:40 min por audio.</p>
          </div>
        )}

        {(modo === 'link' || modo === 'texto') && (
          <div className="tarjeta p-3">
            <div className="mb-2 text-[12px] font-medium">{modo === 'link' ? 'Enlace (curso, calendario, PDF…)' : 'Respuesta rápida'}</div>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre corto del atajo"
              className="mb-2 w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1.5 text-[12px] outline-none" />
            {modo === 'link'
              ? <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="https://…"
                  className="mb-2 w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1.5 text-[12px] outline-none" />
              : <textarea value={valor} onChange={(e) => setValor(e.target.value)} rows={3} placeholder="Texto que se pega en el mensaje. Podés usar {{nombre}}"
                  className="mb-2 w-full resize-none rounded-md border border-[var(--border-hairline)] bg-transparent px-2 py-1.5 text-[12px] outline-none" />}
            <div className="flex items-center gap-1.5">
              <button onClick={guardarLinkOTexto} disabled={ocupado} className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--series-1)' }}>Guardar</button>
              <button onClick={limpiar} className="text-[11px] text-[var(--text-muted)] underline">cancelar</button>
            </div>
          </div>
        )}

        {/* Lista ordenable */}
        <div className="mt-3 space-y-1">
          {recursos.length === 0 && (
            <div className="rounded-md p-3 text-center text-[12px] text-[var(--text-muted)]" style={{ background: 'var(--page-plane)' }}>
              Todavía no hay recursos. Grabá tu primer audio de bienvenida 🎙️
            </div>
          )}
          {!recursos.some((r) => r.tipo === 'texto') && (
            <button onClick={sugeridas} disabled={ocupado} className="w-full rounded-md border border-dashed border-[var(--border-hairline)] px-2 py-1.5 text-[11px] hover:bg-[var(--surface-1)]">
              + Agregar 5 respuestas rápidas sugeridas
            </button>
          )}
          {recursos.map((r, i) => (
            <div key={r.id} className="rounded-md border border-[var(--border-hairline)] px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[14px]">{ICONO_RECURSO[r.tipo] ?? '📎'}</span>
                {editando === r.id ? (
                  <input autoFocus defaultValue={r.nombre}
                    onBlur={(e) => renombrar(r, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') renombrar(r, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setEditando(null); }}
                    className="min-w-0 flex-1 rounded border border-[var(--border-hairline)] bg-transparent px-1.5 py-0.5 text-[12px] outline-none" />
                ) : (
                  <button onClick={() => setEditando(r.id)} title="Cambiar nombre" className="min-w-0 flex-1 truncate text-left text-[12px]">{r.nombre}</button>
                )}
                <button onClick={() => mover(i, -1)} disabled={i === 0} className="rounded px-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-1)] disabled:opacity-30" aria-label="Subir">↑</button>
                <button onClick={() => mover(i, 1)} disabled={i === recursos.length - 1} className="rounded px-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-1)] disabled:opacity-30" aria-label="Bajar">↓</button>
                {borrando === r.id ? (
                  <button onClick={() => borrar(r.id)} className="rounded px-1.5 text-[11px] font-medium text-white" style={{ background: 'var(--status-critical)' }}>Borrar</button>
                ) : (
                  <button onClick={() => setBorrando(r.id)} className="rounded px-1 text-[11px] hover:bg-[var(--surface-1)]" style={{ color: 'var(--status-critical)' }} aria-label="Borrar">✕</button>
                )}
              </div>
              {r.tipo === 'audio' && r.url_publica && <audio controls preload="none" src={r.url_publica} className="mt-1 h-7 w-full" />}
              {r.tipo === 'texto' && <div className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{r.texto}</div>}
              {(r.tipo === 'link' || r.tipo === 'pdf' || r.tipo === 'imagen' || r.tipo === 'video') && r.url_publica && (
                <a href={r.url_publica} target="_blank" rel="noreferrer" className="mt-0.5 block truncate text-[11px] underline text-[var(--text-muted)]">ver</a>
              )}
              {Number(r.veces_usado) > 0 && <div className="text-[10px] text-[var(--text-muted)]">usado {fmtNum(r.veces_usado)} veces</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
