import { useEffect, useRef, useState } from 'react';
import { api, hace } from '../api';
import { Cargando } from '../componentes/Graficas';

const RAPIDAS = [
  '¡Hola! 👋 Gracias por escribir. ¿Qué te gustaría lograr?',
  'Te paso la info 👇',
  '¿Te viene bien una llamada corta para contarte cómo funciona?',
  '¿Qué día y hora te queda cómodo?',
  '¡Genial! Te mando el link de pago 🙌',
];

export default function Chat() {
  const [convs, setConvs] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [hilo, setHilo] = useState<any>(null);
  const [recursos, setRecursos] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState('');
  const finRef = useRef<HTMLDivElement>(null);

  async function cargarConvs() {
    const [c, r, pr] = await Promise.all([
      api<any[]>('/chat/conversaciones'),
      api<any[]>('/recursos').catch(() => []),
      api<any[]>('/productos').catch(() => []),
    ]);
    setConvs(c); setRecursos(r); setProductos(pr); setCargando(false);
    if (!sel && c.length) abrir(c[0].id);
  }
  async function abrir(leadId: string) {
    setSel(leadId);
    const h = await api<any>(`/chat/${leadId}`);
    setHilo(h);
    setConvs((cs) => cs.map((c) => c.id === leadId ? { ...c, mensajes_sin_leer: 0 } : c));
    setTimeout(() => finRef.current?.scrollIntoView(), 50);
  }
  async function enviar(payload: { texto?: string; recurso_id?: string }) {
    if (!sel) return;
    try {
      await api(`/chat/${sel}/enviar`, { method: 'POST', json: payload });
      setTexto('');
      const h = await api<any>(`/chat/${sel}`);
      setHilo(h);
      setTimeout(() => finRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (err: any) { alert(err.message); }
  }
  useEffect(() => { cargarConvs(); }, []);

  if (cargando) return <Cargando />;
  const audios = recursos.filter((r) => r.tipo === 'audio');
  const cursosLink = productos.filter((p) => p.link_pago);
  const convsFiltradas = q
    ? convs.filter((c) => `${c.nombre ?? ''} ${c.ig_username ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    : convs;

  return (
    <div className="flex h-screen">
      {/* Lista de conversaciones */}
      <div className="flex w-[300px] shrink-0 flex-col border-r border-[var(--border-hairline)]">
        <div className="border-b border-[var(--border-hairline)] p-3">
          <div className="text-[15px] font-semibold">Chat</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar lead…"
            className="mt-2 w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none" />
        </div>
        <div className="flex-1 overflow-y-auto">
          {convsFiltradas.map((c) => (
            <button key={c.id} onClick={() => abrir(c.id)}
              className={`flex w-full flex-col gap-0.5 border-b border-[var(--border-hairline)] px-3 py-2.5 text-left ${sel === c.id ? 'bg-[var(--surface-1)]' : 'hover:bg-[var(--surface-1)]'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{c.nombre ?? (c.ig_username ? '@' + c.ig_username : 'Lead')}</span>
                {Number(c.mensajes_sin_leer) > 0 && (
                  <span className="rounded-full px-1.5 text-[10px] font-semibold text-white" style={{ background: 'var(--series-1)' }}>{c.mensajes_sin_leer}</span>
                )}
              </div>
              <span className="truncate text-[11px] text-[var(--text-muted)]">
                {c.ultimo_dir === 'entrante' ? '' : '↩ '}{c.ultimo_texto ?? (c.contenido ? `vino de: ${c.contenido}` : 'nuevo lead')}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">{c.etapa ?? 'sin etapa'} · {hace(c.actividad)}</span>
            </button>
          ))}
          {convsFiltradas.length === 0 && <div className="p-6 text-center text-[12px] text-[var(--text-muted)]">Sin conversaciones.</div>}
        </div>
      </div>

      {/* Hilo */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!hilo ? (
          <div className="flex flex-1 items-center justify-center text-[13px] text-[var(--text-muted)]">Elegí una conversación</div>
        ) : (
          <>
            {/* Cabecera del lead */}
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-4 py-3">
              <div className="min-w-0">
                <div className="text-[14px] font-semibold">{hilo.lead.nombre ?? (hilo.lead.ig_username ? '@' + hilo.lead.ig_username : 'Lead')}</div>
                <div className="truncate text-[11px] text-[var(--text-muted)]">
                  {hilo.lead.contenido ? `vino de: ${hilo.lead.contenido}` : 'origen desconocido'}
                  {hilo.lead.etapa ? ` · ${hilo.lead.etapa}` : ''}
                  {hilo.lead.score != null ? ` · score ${hilo.lead.score}` : ''}
                </div>
              </div>
            </div>

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto px-4 py-4" style={{ background: 'var(--page-plane)' }}>
              {hilo.mensajes.length === 0 && (
                <div className="mt-6 text-center text-[12px] text-[var(--text-muted)]">
                  Aún no hay mensajes. Escribe el primero o manda un audio del founder 👇
                </div>
              )}
              <div className="mx-auto flex max-w-[640px] flex-col gap-2">
                {hilo.mensajes.map((m: any) => (
                  <div key={m.id} className={`max-w-[80%] rounded-2xl px-3 py-2 text-[13px] ${m.direccion === 'saliente' ? 'self-end text-white' : 'self-start'}`}
                    style={{ background: m.direccion === 'saliente' ? 'var(--series-1)' : 'var(--surface-1)' }}>
                    {m.tipo === 'audio' && m.recurso_url_publica
                      ? <audio controls src={m.recurso_url_publica} className="h-8" />
                      : <span className="whitespace-pre-wrap">{m.texto}</span>}
                    <div className={`mt-0.5 text-[10px] ${m.direccion === 'saliente' ? 'text-white/70' : 'text-[var(--text-muted)]'}`}>
                      {m.autor ?? ''} · {hace(m.creado_en)}{m.estado === 'pendiente' ? ' · pendiente' : ''}
                    </div>
                  </div>
                ))}
                <div ref={finRef} />
              </div>
            </div>

            {/* Atajos: audios del founder */}
            {audios.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-t border-[var(--border-hairline)] px-4 pt-2">
                <span className="self-center text-[11px] text-[var(--text-muted)]">🎙️ Audios:</span>
                {audios.map((a) => (
                  <button key={a.id} onClick={() => enviar({ recurso_id: a.id })}
                    className="rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] hover:bg-[var(--surface-1)]">
                    {a.nombre}
                  </button>
                ))}
              </div>
            )}
            {/* Atajos: link de pago (venta directa) */}
            {cursosLink.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-4 pt-2">
                <span className="self-center text-[11px] text-[var(--text-muted)]">💳 Link de pago:</span>
                {cursosLink.map((p) => (
                  <button key={p.id} onClick={() => enviar({ texto: `${p.nombre}${p.precio_lista ? ` — ${p.precio_lista} ${p.moneda || 'EUR'}` : ''}\n${p.link_pago}` })}
                    className="rounded-full border px-2.5 py-1 text-[11px] text-white" style={{ background: 'var(--status-good)', borderColor: 'var(--status-good)' }}>
                    {p.nombre}
                  </button>
                ))}
              </div>
            )}
            {/* Atajos: respuestas rápidas */}
            <div className="flex flex-wrap gap-1.5 px-4 pt-2">
              <span className="self-center text-[11px] text-[var(--text-muted)]">⚡ Rápidas:</span>
              {RAPIDAS.map((r, i) => (
                <button key={i} onClick={() => setTexto(r)}
                  className="rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] hover:bg-[var(--surface-1)]">
                  {r.slice(0, 28)}{r.length > 28 ? '…' : ''}
                </button>
              ))}
            </div>

            {/* Caja de texto */}
            <form onSubmit={(e) => { e.preventDefault(); if (texto.trim()) enviar({ texto }); }}
              className="flex items-end gap-2 border-t border-[var(--border-hairline)] p-3">
              <textarea value={texto} onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (texto.trim()) enviar({ texto }); } }}
                rows={1} placeholder="Escribe un mensaje… (Enter para enviar)"
                className="min-h-[38px] flex-1 resize-none rounded-md border border-[var(--border-hairline)] bg-transparent px-3 py-2 text-[13px] outline-none" />
              <button type="submit" disabled={!texto.trim()}
                className="rounded-md px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--series-1)' }}>
                Enviar
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
