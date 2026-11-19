import { useEffect, useRef, useState } from 'react';
import { api, fmtFecha, fmtNum } from '../api';
import { Cargando } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';

function leerBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

export default function Recursos() {
  const [recursos, setRecursos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  // Grabadora
  const [grabando, setGrabando] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const grabadora = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);
  const blobGrabado = useRef<Blob | null>(null);

  async function cargar() {
    setRecursos(await api<any[]>('/recursos'));
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  async function empezarGrabacion() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      trozos.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size) trozos.current.push(e.data); };
      mr.onstop = () => {
        const blob = new Blob(trozos.current, { type: 'audio/webm' });
        blobGrabado.current = blob;
        setPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
      };
      mr.start();
      grabadora.current = mr;
      setGrabando(true);
    } catch {
      setAviso('No pude acceder al micrófono. Da permiso o sube un archivo.');
    }
  }
  function pararGrabacion() {
    grabadora.current?.stop();
    setGrabando(false);
  }

  async function guardarGrabacion() {
    if (!blobGrabado.current) return;
    if (!nombre.trim()) { setAviso('Ponle un nombre al audio.'); return; }
    setSubiendo(true);
    try {
      const b64 = await leerBase64(blobGrabado.current);
      await api('/recursos', { method: 'POST', json: {
        nombre, tipo: 'audio', mime: 'audio/webm', archivo_base64: b64,
      } });
      setNombre(''); setPreviewUrl(null); blobGrabado.current = null;
      setAviso('Audio del founder guardado. Ya lo pueden usar los setters y los flujos.');
      await cargar();
    } catch (err: any) { setAviso(err.message); } finally { setSubiendo(false); }
  }

  async function subirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_800_000) { setAviso('El archivo supera ~1,8 MB. Usa uno más corto o una URL.'); return; }
    setSubiendo(true);
    try {
      const b64 = await leerBase64(file);
      const tipo = file.type.startsWith('audio') ? 'audio'
        : file.type.startsWith('image') ? 'imagen'
        : file.type.startsWith('video') ? 'video'
        : file.type === 'application/pdf' ? 'pdf' : 'audio';
      await api('/recursos', { method: 'POST', json: {
        nombre: nombre || file.name, tipo, mime: file.type, archivo_base64: b64,
      } });
      setNombre('');
      setAviso('Recurso subido.');
      await cargar();
    } catch (err: any) { setAviso(err.message); } finally { setSubiendo(false); e.target.value = ''; }
  }

  async function borrar(id: string) {
    await api(`/recursos/${id}`, { method: 'DELETE' });
    await cargar();
  }

  if (cargando) return <Cargando />;
  const audios = recursos.filter((r) => r.tipo === 'audio');
  const otros = recursos.filter((r) => r.tipo !== 'audio');

  return (
    <div className="px-5 py-5 lg:px-8">
      <Cabecera
        titulo="Recursos"
        subtitulo="Audios del founder, PDFs y recursos que tus setters mandan en los DMs"
      />

      {aviso && (
        <div className="mt-3 rounded-md px-3 py-2 text-[12px]"
          style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>{aviso}</div>
      )}

      {/* Grabar / subir */}
      <section className="mt-5">
        <div className="tarjeta p-4">
          <div className="mb-2 text-[14px] font-semibold">Grabar un audio del founder 🎙️</div>
          <p className="mb-3 text-[12px] text-[var(--text-secondary)]">
            Graba aquí (o sube un archivo). Tus setters podrán mandarlo en cualquier DM y los flujos
            pueden enviarlo solos — el lead siempre siente que habla con vos.
          </p>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Nombre del audio (p. ej. Bienvenida founder)"
            className="mb-3 w-full max-w-md rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            {!grabando && !previewUrl && (
              <button onClick={empezarGrabacion}
                className="rounded-md px-4 py-2 text-[13px] font-semibold text-white"
                style={{ background: 'var(--status-critical)' }}>● Grabar</button>
            )}
            {grabando && (
              <button onClick={pararGrabacion}
                className="rounded-md px-4 py-2 text-[13px] font-semibold text-white animate-pulse"
                style={{ background: 'var(--status-critical)' }}>■ Detener grabación…</button>
            )}
            {previewUrl && (
              <>
                <audio controls src={previewUrl} className="h-9" />
                <button onClick={guardarGrabacion} disabled={subiendo || !nombre.trim()}
                  className="rounded-md px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
                  style={{ background: 'var(--series-1)' }}>{subiendo ? 'Guardando…' : 'Guardar audio'}</button>
                <button onClick={() => { setPreviewUrl(null); blobGrabado.current = null; }}
                  className="rounded-md border border-[var(--border-hairline)] px-3 py-2 text-[12px] hover:bg-[var(--page-plane)]">Descartar</button>
              </>
            )}
            <label className="cursor-pointer rounded-md border border-[var(--border-hairline)] px-3 py-2 text-[12px] hover:bg-[var(--page-plane)]">
              Subir archivo
              <input type="file" accept="audio/*,image/*,application/pdf,video/*" onChange={subirArchivo} className="hidden" />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">Máximo ~1,8 MB por archivo (audios de voz entran de sobra).</p>
        </div>
      </section>

      {/* Audios del founder */}
      <section className="mt-6">
        <h2 className="mb-2 text-[14px] font-semibold">Audios del founder ({audios.length})</h2>
        {audios.length === 0 ? (
          <div className="tarjeta p-6 text-center text-[13px] text-[var(--text-muted)]">
            Aún no hay audios. Graba el primero arriba.
          </div>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {audios.map((r) => (
              <div key={r.id} className="tarjeta p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium">{r.nombre}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                      {fmtFecha(r.creado_en)} · usado {fmtNum(r.veces_usado)} veces
                    </div>
                  </div>
                  <button onClick={() => borrar(r.id)}
                    className="shrink-0 rounded px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]"
                    style={{ color: 'var(--status-critical)' }}>Borrar</button>
                </div>
                {r.url_publica && <audio controls src={r.url_publica} className="mt-2 h-9 w-full" />}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Otros recursos */}
      {otros.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[14px] font-semibold">Otros recursos</h2>
          <div className="tarjeta divide-y divide-[var(--border-hairline)]">
            {otros.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{r.nombre}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{r.tipo} · usado {fmtNum(r.veces_usado)}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.url_publica && <a href={r.url_publica} target="_blank" rel="noreferrer" className="text-[12px] underline">Abrir</a>}
                  <button onClick={() => borrar(r.id)} className="rounded px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]" style={{ color: 'var(--status-critical)' }}>Borrar</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
