import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, hace } from '../api';
import { Cargando } from '../componentes/Graficas';
import FichaLead from '../componentes/FichaLead';
import GestorRecursos, { ICONO_RECURSO } from '../componentes/GestorRecursos';

// Chat del setter: conversaciones a la izquierda, hilo a la derecha, y abajo
// los atajos (audios del founder, recursos, respuestas rápidas, links de
// pago) en el orden que el founder eligió. Todo lo que no llegó a Instagram
// se pinta distinto y lo dice: la pantalla nunca miente sobre el estado real.

const MAX_TEXTO = 1000; // límite de Instagram por mensaje
type Filtro = 'todos' | 'sin_leer' | 'flujo';

function rellenar(texto: string, lead: any) {
  const nombre = (lead?.nombre ? String(lead.nombre).split(' ')[0] : '') || lead?.ig_username || '';
  return texto.replace(/\{\{\s*nombre\s*\}\}/gi, nombre)
    .replace(/\{\{\s*usuario\s*\}\}/gi, lead?.ig_username ? `@${lead.ig_username}` : '');
}

function restante(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

const NO_SALIO = new Set(['no_enviado', 'pendiente', 'simulado']);

export default function Chat() {
  const [params, setParams] = useSearchParams();
  const [convs, setConvs] = useState<any[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [hilo, setHilo] = useState<any>(null);
  const [recursos, setRecursos] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);
  const [texto, setTexto] = useState('');
  const [cargando, setCargando] = useState(true);
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [panelRecursos, setPanelRecursos] = useState(params.get('recursos') === '1');
  const [ficha, setFicha] = useState(false);
  const [prueba, setPrueba] = useState(false);
  const [pruebaTipo, setPruebaTipo] = useState('dm');
  const [pruebaTexto, setPruebaTexto] = useState('');
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const finRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<string | null>(null);
  selRef.current = sel;

  async function cargarRecursos() {
    setRecursos(await api<any[]>('/recursos').catch(() => []));
  }
  async function cargarConvs() {
    const c = await api<any[]>('/chat/conversaciones');
    setConvs(c);
    return c;
  }
  async function cargarHilo(leadId: string, bajar = false) {
    const h = await api<any>(`/chat/${leadId}`);
    if (selRef.current !== leadId) return;
    setHilo(h);
    if (bajar) setTimeout(() => finRef.current?.scrollIntoView(), 30);
  }

  useEffect(() => {
    (async () => {
      const [c] = await Promise.all([
        cargarConvs(),
        cargarRecursos(),
        api<any[]>('/productos').then(setProductos).catch(() => {}),
      ]);
      setCargando(false);
      const pedido = params.get('lead');
      if (pedido) abrir(pedido);
      else if (c.length && window.innerWidth >= 768) abrir(c[0].id);
    })();
    // Sin websockets: refresco liviano mientras la pestaña está visible.
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      cargarConvs().catch(() => {});
      if (selRef.current) cargarHilo(selRef.current).catch(() => {});
    }, 12_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function abrir(leadId: string) {
    setSel(leadId);
    selRef.current = leadId;
    setFicha(false);
    setAviso(null);
    setConvs((cs) => cs.map((c) => (c.id === leadId ? { ...c, mensajes_sin_leer: 0 } : c)));
    await cargarHilo(leadId, true);
  }

  async function enviar(payload: { texto?: string; recurso_id?: string }) {
    if (!sel || enviando) return;
    setEnviando(true);
    try {
      const r = await api<any>(`/chat/${sel}/enviar`, { method: 'POST', json: payload });
      if (payload.texto) setTexto('');
      setAviso(r.aviso ? `No salió a Instagram: ${r.aviso}. Quedó guardado en el Chat.` : null);
      await cargarHilo(sel, true);
      cargarConvs().catch(() => {});
    } catch (err: any) {
      setAviso(err.message);
    } finally {
      setEnviando(false);
    }
  }

  function usarAtajo(r: any) {
    // Las respuestas rápidas se pegan para poder editarlas; lo demás sale directo.
    if (r.tipo === 'texto') {
      setTexto((t) => (t ? `${t} ` : '') + rellenar(r.texto ?? '', hilo?.lead));
      return;
    }
    enviar({ recurso_id: r.id });
  }

  async function simularLead(e: React.FormEvent) {
    e.preventDefault();
    if (!sel) return;
    try {
      const r = await api<any>('/instagram/simular-evento', {
        method: 'POST', json: { lead_id: sel, tipo: pruebaTipo, texto: pruebaTexto || undefined },
      });
      setPruebaTexto('');
      setAviso(r.reanudado ? '🧪 El lead respondió y su flujo siguió donde estaba.'
        : r.flujo ? `🧪 Se disparó el automensaje «${r.flujo}»${r.omitido ? ` (${r.omitido})` : ''}.`
        : '🧪 Mensaje del lead simulado. Ningún automensaje coincide.');
      await cargarHilo(sel, true);
      cargarConvs().catch(() => {});
    } catch (err: any) { setAviso(err.message); }
  }

  const visibles = useMemo(() => {
    let l = convs;
    if (filtro === 'sin_leer') l = l.filter((c) => Number(c.mensajes_sin_leer) > 0);
    if (filtro === 'flujo') l = l.filter((c) => c.flujo_esperando);
    if (q) l = l.filter((c) => `${c.nombre ?? ''} ${c.ig_username ?? ''}`.toLowerCase().includes(q.toLowerCase()));
    return l;
  }, [convs, filtro, q]);

  if (cargando) return <Cargando />;
  const cursosLink = productos.filter((p) => p.link_pago);
  const sinLeer = convs.filter((c) => Number(c.mensajes_sin_leer) > 0).length;
  const largo = texto.length;
  const ventana = hilo?.ventana;

  return (
    <div className="flex h-[calc(100vh-49px)] md:h-screen">
      {/* Conversaciones */}
      <div className={`${sel ? 'hidden md:flex' : 'flex'} w-full shrink-0 flex-col border-r border-[var(--border-hairline)] md:w-[300px]`}>
        <div className="border-b border-[var(--border-hairline)] p-3">
          <div className="flex items-center justify-between">
            <div className="text-[15px] font-semibold">Chat</div>
            <button onClick={() => setPanelRecursos((v) => !v)}
              className="rounded-md border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--surface-1)]">
              🎙️ Recursos
            </button>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar lead…"
            className="mt-2 w-full rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none" />
          <div className="mt-2 flex gap-1 text-[11px]">
            {([['todos', 'Todos'], ['sin_leer', `Sin leer${sinLeer ? ` (${sinLeer})` : ''}`], ['flujo', 'En automensaje']] as const).map(([v, t]) => (
              <button key={v} onClick={() => setFiltro(v)}
                className={`rounded-full px-2 py-0.5 ${filtro === v ? 'font-medium text-white' : 'border border-[var(--border-hairline)] text-[var(--text-secondary)]'}`}
                style={filtro === v ? { background: 'var(--series-1)' } : {}}>{t}</button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visibles.map((c) => (
            <button key={c.id} onClick={() => abrir(c.id)}
              className={`flex w-full flex-col gap-0.5 border-b border-[var(--border-hairline)] px-3 py-2.5 text-left ${sel === c.id ? 'bg-[var(--surface-1)]' : 'hover:bg-[var(--surface-1)]'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`truncate text-[13px] ${Number(c.mensajes_sin_leer) > 0 ? 'font-semibold' : 'font-medium'}`}>
                  {c.nombre ?? (c.ig_username ? `@${c.ig_username}` : 'Lead')}
                </span>
                {Number(c.mensajes_sin_leer) > 0 && (
                  <span className="rounded-full px-1.5 text-[10px] font-semibold text-white" style={{ background: 'var(--series-1)' }}>{c.mensajes_sin_leer}</span>
                )}
              </div>
              <span className="truncate text-[11px] text-[var(--text-muted)]">
                {c.flujo_esperando ? '⏸ ' : ''}{c.ultimo_dir === 'saliente' ? '↩ ' : ''}{c.ultimo_texto ?? (c.contenido ? `vino de: ${c.contenido}` : 'nuevo lead')}
              </span>
              <span className="text-[10px] text-[var(--text-muted)]">
                {c.etapa ?? 'sin etapa'}{c.responsable ? ` · ${c.responsable}` : ''} · {hace(c.actividad)}
              </span>
            </button>
          ))}
          {visibles.length === 0 && (
            <div className="p-6 text-center text-[12px] text-[var(--text-muted)]">
              {convs.length === 0
                ? 'Todavía no hay conversaciones. Cuando un lead comente o te escriba, aparece acá.'
                : 'Nada con este filtro.'}
            </div>
          )}
        </div>
      </div>

      {/* Hilo */}
      <div className={`${sel ? 'flex' : 'hidden md:flex'} min-w-0 flex-1 flex-col`}>
        {!hilo ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-[13px] text-[var(--text-muted)]">
            Elegí una conversación de la izquierda
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-[var(--border-hairline)] px-3 py-2.5 md:px-4">
              <button onClick={() => { setSel(null); setHilo(null); }} className="rounded px-1.5 py-1 text-[13px] md:hidden" aria-label="Volver">←</button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">
                  {hilo.lead.nombre ?? (hilo.lead.ig_username ? `@${hilo.lead.ig_username}` : 'Lead')}
                  {hilo.lead.ig_username && hilo.lead.nombre && <span className="ml-1.5 text-[12px] font-normal text-[var(--text-muted)]">@{hilo.lead.ig_username}</span>}
                </div>
                <div className="truncate text-[11px] text-[var(--text-muted)]">
                  {hilo.lead.contenido ? `vino de: ${hilo.lead.contenido}` : 'origen desconocido'}
                  {hilo.lead.etapa ? ` · ${hilo.lead.etapa}` : ''}
                  {hilo.lead.responsable ? ` · lo atiende ${hilo.lead.responsable}` : ''}
                </div>
              </div>
              <button onClick={() => setPrueba((v) => !v)} title="Simular que el lead escribe (para probar tus automensajes)"
                className="hidden rounded-md border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--surface-1)] sm:block">🧪 Probar</button>
              <button onClick={() => setFicha(true)} className="rounded-md border border-[var(--border-hairline)] px-2 py-1 text-[11px] hover:bg-[var(--surface-1)]">Ficha</button>
            </div>

            {(hilo.esperas ?? []).length > 0 && (
              <div className="border-b border-[var(--border-hairline)] px-4 py-1.5 text-[11px]" style={{ background: 'var(--page-plane)' }}>
                ⏸ {hilo.esperas.map((e: any) => `Automensaje «${e.flujo}» ${e.esperando === 'tiempo' ? 'en pausa programada' : 'esperando su respuesta'}`).join(' · ')}
              </div>
            )}

            {prueba && (
              <form onSubmit={simularLead} className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-hairline)] px-4 py-2" style={{ background: 'var(--page-plane)' }}>
                <span className="text-[11px] text-[var(--text-secondary)]">🧪 Simular que el lead</span>
                <select value={pruebaTipo} onChange={(e) => setPruebaTipo(e.target.value)}
                  className="rounded border border-[var(--border-hairline)] bg-[var(--surface-1)] px-1.5 py-1 text-[11px]">
                  <option value="dm">te escribe por DM</option>
                  <option value="comentario">comenta un reel</option>
                  <option value="historia">responde tu historia</option>
                  <option value="mencion">te menciona</option>
                  <option value="reaccion">reacciona</option>
                  <option value="anuncio">viene de un anuncio</option>
                </select>
                <input value={pruebaTexto} onChange={(e) => setPruebaTexto(e.target.value)} placeholder="qué escribe (ej. GUIA)"
                  className="min-w-[140px] flex-1 rounded border border-[var(--border-hairline)] bg-transparent px-2 py-1 text-[11px] outline-none" />
                <button className="rounded px-2 py-1 text-[11px] font-medium text-white" style={{ background: 'var(--series-1)' }}>Simular</button>
                <span className="w-full text-[10px] text-[var(--text-muted)]">Corre tus automensajes de verdad en el CRM, sin mandar nada a Instagram.</span>
              </form>
            )}

            {/* Mensajes */}
            <div className="flex-1 overflow-y-auto px-3 py-4 md:px-4" style={{ background: 'var(--page-plane)' }}>
              {hilo.mensajes.length === 0 && (
                <div className="mt-6 text-center text-[12px] text-[var(--text-muted)]">
                  Todavía no hay mensajes. Escribí el primero o mandá un audio del founder 👇
                </div>
              )}
              <div className="mx-auto flex max-w-[680px] flex-col gap-2">
                {hilo.mensajes.map((m: any) => {
                  const sale = m.direccion === 'saliente';
                  const noSalio = sale && NO_SALIO.has(m.estado);
                  return (
                    <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] ${sale ? 'self-end' : 'self-start'}`}
                      style={sale
                        ? (noSalio
                          ? { background: 'var(--surface-1)', border: '1.5px dashed var(--status-warning)' }
                          : { background: 'var(--series-1)', color: 'white' })
                        : { background: 'var(--surface-1)' }}>
                      {m.tipo === 'audio' && m.recurso_url_publica
                        ? <audio controls preload="none" src={m.recurso_url_publica} className="h-8 max-w-full" />
                        : m.tipo === 'imagen' && m.recurso_url_publica
                          ? <img src={m.recurso_url_publica} alt={m.recurso_nombre ?? ''} className="max-h-60 rounded-lg" />
                          : <span className="whitespace-pre-wrap break-words">{m.texto}</span>}
                      {m.tipo === 'recurso' && m.recurso_url_publica && (
                        <a href={m.recurso_url_publica} target="_blank" rel="noreferrer" className="mt-0.5 block text-[11px] underline">abrir {m.recurso_nombre}</a>
                      )}
                      <div className={`mt-0.5 text-[10px] ${sale && !noSalio ? 'text-white/75' : 'text-[var(--text-muted)]'}`}>
                        {m.autor ?? ''} · {hace(m.ocurrido_en ?? m.creado_en)}
                      </div>
                      {noSalio && (
                        <div className="mt-0.5 text-[10px] font-medium" style={{ color: 'var(--status-warning)' }}>
                          {m.estado === 'simulado' ? 'simulado, no salió a Instagram' : `no salió a Instagram${m.error ? `: ${m.error}` : ''}`}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={finRef} />
              </div>
            </div>

            {/* Ventana de 24 h */}
            {ventana && (
              <div className="border-t border-[var(--border-hairline)] px-4 py-1 text-[11px]"
                style={{ color: ventana.abierta ? 'var(--status-good)' : 'var(--text-muted)' }}>
                {ventana.abierta
                  ? `● Ventana abierta: quedan ${restante(ventana.cierra_en)} para responderle por Instagram`
                  : ventana.nunca_escribio
                    ? '○ Todavía no te escribió por DM: Instagram deja responder cuando él escribe primero (o al comentar, por respuesta privada).'
                    : '○ Pasaron más de 24 h desde su último mensaje: Instagram no deja escribirle hasta que vuelva a escribir.'}
              </div>
            )}

            {aviso && (
              <div className="border-t border-[var(--border-hairline)] px-4 py-1.5 text-[11px]" style={{ background: 'var(--page-plane)' }}>
                {aviso} <button onClick={() => setAviso(null)} className="ml-1 underline">ok</button>
              </div>
            )}

            {/* Atajos: recursos en el orden del founder + links de pago */}
            <div className="flex max-h-[96px] flex-wrap gap-1.5 overflow-y-auto border-t border-[var(--border-hairline)] px-3 pt-2 md:px-4">
              {recursos.map((r) => (
                <button key={r.id} onClick={() => usarAtajo(r)} disabled={enviando}
                  title={r.tipo === 'texto' ? 'Pega el texto para editarlo antes de mandar' : 'Se manda al instante'}
                  className="rounded-full border border-[var(--border-hairline)] px-2.5 py-1 text-[11px] hover:bg-[var(--surface-1)] disabled:opacity-50"
                  style={r.tipo === 'audio' ? { borderColor: '#9b5de5' } : {}}>
                  {ICONO_RECURSO[r.tipo] ?? '📎'} {r.nombre}
                </button>
              ))}
              {cursosLink.map((p) => (
                <button key={p.id} disabled={enviando}
                  onClick={() => enviar({ texto: `${p.nombre}${p.precio_lista ? ` — ${p.precio_lista} ${p.moneda || 'EUR'}` : ''}\n${p.link_pago}` })}
                  className="rounded-full px-2.5 py-1 text-[11px] text-white disabled:opacity-50" style={{ background: 'var(--status-good)' }}>
                  💳 {p.nombre}
                </button>
              ))}
              <button onClick={() => setPanelRecursos(true)} className="rounded-full border border-dashed border-[var(--border-hairline)] px-2.5 py-1 text-[11px] text-[var(--text-muted)] hover:bg-[var(--surface-1)]">
                {recursos.length ? '⚙ Ordenar / agregar' : '+ Grabar audio o agregar atajos'}
              </button>
            </div>

            {/* Caja de texto */}
            <form onSubmit={(e) => { e.preventDefault(); if (texto.trim() && largo <= MAX_TEXTO) enviar({ texto }); }}
              className="flex items-end gap-2 p-3">
              <div className="relative min-w-0 flex-1">
                <textarea value={texto} onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (texto.trim() && largo <= MAX_TEXTO) enviar({ texto }); } }}
                  rows={Math.min(5, Math.max(1, texto.split('\n').length))}
                  placeholder="Escribí un mensaje… (Enter manda, Shift+Enter baja de línea)"
                  className="min-h-[38px] w-full resize-none rounded-md border border-[var(--border-hairline)] bg-transparent px-3 py-2 pr-16 text-[13px] outline-none" />
                <span className="pointer-events-none absolute bottom-2 right-2 text-[10px]"
                  style={{ color: largo > MAX_TEXTO ? 'var(--status-critical)' : 'var(--text-muted)' }}>
                  {largo}/{MAX_TEXTO}
                </span>
              </div>
              <button type="submit" disabled={!texto.trim() || largo > MAX_TEXTO || enviando}
                className="rounded-md px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--series-1)' }}>
                {enviando ? '…' : 'Enviar'}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Recursos (panel lateral dentro del Chat, no una pestaña aparte) */}
      {panelRecursos && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/20 md:static md:z-auto md:bg-transparent">
          <div className="h-full w-[320px] max-w-[90vw] border-l border-[var(--border-hairline)]" style={{ background: 'var(--page-plane)' }}>
            <GestorRecursos recursos={recursos} onCambio={cargarRecursos}
              onCerrar={() => { setPanelRecursos(false); if (params.get('recursos')) { params.delete('recursos'); setParams(params, { replace: true }); } }} />
          </div>
        </div>
      )}

      {ficha && sel && <FichaLead leadId={sel} alCerrar={() => { setFicha(false); cargarHilo(sel); }} />}
    </div>
  );
}
