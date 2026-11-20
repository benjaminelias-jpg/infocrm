import { Fragment, useEffect, useState } from 'react';
import { useAviso } from '../../ui';
import { IconoChat } from './iconos';
import { copiar, etiquetaDia, fechaCompleta, horaCorta, mismoDia, NO_SALIO } from './util';
import type { Mensaje, MensajeLocal } from './tipos';

// Mensajes del hilo: separadores de día (Hoy, Ayer, lun 16 nov), burbujas
// agrupadas por autor con la hora sola, automensajes distinguibles, lo que no
// le llegó al lead marcado en rojo (con Copiar para pegarlo en Instagram) y
// los mensajes propios que todavía están saliendo (con Deshacer o Reintentar).

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Texto con los enlaces tocables. */
function ConEnlaces({ texto, claro }: { texto: string; claro?: boolean }) {
  const partes = texto.split(URL_RE);
  return (
    <>
      {partes.map((p, i) => (i % 2 === 1
        ? <a key={i} href={p} target="_blank" rel="noreferrer" className={`break-all underline ${claro ? 'text-white' : ''}`}>{p}</a>
        : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

export function SeparadorDia({ iso }: { iso: string }) {
  return (
    <div className="my-2 flex justify-center" role="separator" aria-label={etiquetaDia(iso)}>
      <span className="rounded-full px-2.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
        style={{ background: 'var(--gridline)' }}>{etiquetaDia(iso)}</span>
    </div>
  );
}

type Estilo = 'lead' | 'propio' | 'auto' | 'fallo' | 'prueba';

function estiloDe(m: Mensaje): Estilo {
  if (m.direccion === 'entrante') return 'lead';
  if (m.estado === 'simulado') return 'prueba';
  if (NO_SALIO.has(m.estado)) return 'fallo';
  if (m.autor_tipo === 'automatico') return 'auto';
  return 'propio';
}

const FONDOS: Record<Estilo, React.CSSProperties> = {
  lead: { background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' },
  propio: { background: 'var(--series-1)', color: 'white' },
  auto: { background: 'color-mix(in srgb, var(--series-1) 13%, var(--surface-1))', border: '1px solid color-mix(in srgb, var(--series-1) 28%, transparent)' },
  fallo: { background: 'var(--surface-1)', border: '1.5px dashed var(--status-critical)' },
  prueba: { background: 'var(--surface-1)', border: '1.5px dashed var(--status-warning)' },
};

function Contenido({ m, claro }: { m: Pick<Mensaje, 'tipo' | 'texto' | 'recurso_url_publica' | 'recurso_nombre'>; claro: boolean }) {
  if (m.tipo === 'audio' && m.recurso_url_publica) {
    return (
      <span className="block">
        {m.recurso_nombre && <span className={`mb-1 block text-[11px] ${claro ? 'text-white/80' : 'text-[var(--text-muted)]'}`}>🎙️ {m.recurso_nombre}</span>}
        <audio controls preload="none" src={m.recurso_url_publica} className="h-9 w-[240px] max-w-full" />
      </span>
    );
  }
  if (m.tipo === 'imagen' && m.recurso_url_publica) {
    return <img src={m.recurso_url_publica} alt={m.recurso_nombre ?? 'Imagen'} className="max-h-60 rounded-lg" loading="lazy" />;
  }
  return (
    <span className="block whitespace-pre-wrap break-words">
      <ConEnlaces texto={m.texto ?? ''} claro={claro} />
      {m.tipo === 'recurso' && m.recurso_url_publica && (
        <a href={m.recurso_url_publica} target="_blank" rel="noreferrer" className={`mt-1 block text-[12px] underline ${claro ? 'text-white' : ''}`}>
          Abrir «{m.recurso_nombre ?? 'archivo'}»
        </a>
      )}
    </span>
  );
}

/** Mensajes del servidor, agrupados (mismo autor, mismo día, menos de 5 min entre uno y otro). */
export function ListaMensajes({ mensajes }: { mensajes: Mensaje[] }) {
  const aviso = useAviso();
  return (
    <>
      {mensajes.map((m, i) => {
        const prev = mensajes[i - 1];
        const sig = mensajes[i + 1];
        const cuando = m.ocurrido_en ?? m.creado_en;
        const nuevoDia = !prev || !mismoDia(prev.ocurrido_en ?? prev.creado_en, cuando);
        const mismoAutor = (a?: Mensaje) => !!a && a.direccion === m.direccion && a.autor_tipo === m.autor_tipo
          && a.autor === m.autor && (a.flujo ?? '') === (m.flujo ?? '')
          && Math.abs(new Date(a.ocurrido_en).getTime() - new Date(cuando).getTime()) < 5 * 60_000;
        const inicio = nuevoDia || !mismoAutor(prev);
        const fin = !sig || !mismoAutor(sig) || !mismoDia(sig.ocurrido_en ?? sig.creado_en, cuando);
        const estilo = estiloDe(m);
        const sale = m.direccion === 'saliente';
        const claro = estilo === 'propio';
        return (
          <Fragment key={m.id}>
            {nuevoDia && <SeparadorDia iso={cuando} />}
            <div className={`flex flex-col ${sale ? 'items-end' : 'items-start'} ${inicio ? 'mt-2' : 'mt-0.5'}`}>
              {inicio && estilo === 'auto' && (
                <span className="mb-0.5 px-1 text-[11px] font-medium" style={{ color: 'var(--series-1)' }}>
                  🤖 {m.flujo ? <>Automensaje «{m.flujo}»</> : 'Automático'}
                </span>
              )}
              {inicio && sale && m.autor_tipo === 'equipo' && estilo !== 'auto' && (
                <span className="mb-0.5 px-1 text-[11px] text-[var(--text-muted)]">{m.autor}</span>
              )}
              <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-[14px] leading-snug md:max-w-[75%] md:text-[13px] ${sale ? (fin ? 'rounded-br-md' : '') : (fin ? 'rounded-bl-md' : '')}`}
                style={FONDOS[estilo]}>
                <Contenido m={m} claro={claro} />
                <span className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${claro ? 'text-white/75' : 'text-[var(--text-muted)]'}`}
                  title={fechaCompleta(cuando)}>
                  {horaCorta(cuando)}
                  {sale && estilo !== 'fallo' && estilo !== 'prueba' && <span aria-label="Enviado">✓</span>}
                </span>
                {estilo === 'fallo' && (
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--border-hairline)] pt-1">
                    <span className="text-[11px] font-semibold" style={{ color: 'var(--status-critical)' }}>No le llegó</span>
                    {m.error && <span className="min-w-0 text-[11px] text-[var(--text-secondary)]">{m.error}</span>}
                    {m.texto && (
                      <button type="button" className="ui-foco ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--series-1)] hover:bg-[var(--page-plane)]"
                        onClick={async () => { if (await copiar(m.texto ?? '')) aviso.exito('Copiado. Pegalo en Instagram.'); else aviso.error('No se pudo copiar.'); }}>
                        <IconoChat nombre="copiar" tam={13} /> Copiar
                      </button>
                    )}
                  </span>
                )}
                {estilo === 'prueba' && (
                  <span className="mt-1 block text-[11px] font-medium" style={{ color: 'color-mix(in srgb, var(--status-warning) 55%, var(--text-primary))' }}>
                    Prueba: no salió a Instagram
                  </span>
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

function Cuenta({ hasta }: { hasta: number }) {
  const [ahora, setAhora] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 250);
    return () => window.clearInterval(t);
  }, []);
  return <>{Math.max(1, Math.ceil((hasta - ahora) / 1000))} s</>;
}

/** Barra fina que se vacía mientras el mensaje espera para salir. */
function Plazo({ hasta, total }: { hasta: number; total: number }) {
  const [lleno, setLleno] = useState(true);
  const restante = Math.max(0, hasta - Date.now());
  useEffect(() => { const t = window.setTimeout(() => setLleno(false), 30); return () => window.clearTimeout(t); }, []);
  return (
    <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-white/30" aria-hidden>
      <span className="block h-full rounded-full bg-white"
        style={{ width: lleno ? `${(restante / total) * 100}%` : '0%', transition: lleno ? 'none' : `width ${restante}ms linear` }} />
    </span>
  );
}

/** Lo que el setter mandó y todavía no confirmó el servidor. */
export function BurbujaLocal({ m, onDeshacer, onReintentar, onDescartar }: {
  m: MensajeLocal; onDeshacer: () => void; onReintentar: () => void; onDescartar: () => void;
}) {
  const aviso = useAviso();
  const fallo = m.estado === 'fallo';
  const esperando = m.estado === 'esperando';
  const icono = m.vista.tipo === 'audio' ? '🎙️ ' : m.vista.tipo === 'pago' ? '💳 ' : m.vista.tipo && m.vista.tipo !== 'texto' ? '🔗 ' : '';
  return (
    <div className="mt-2 flex flex-col items-end">
      <div className={`max-w-[85%] rounded-2xl rounded-br-md px-3 py-1.5 text-[14px] leading-snug md:max-w-[75%] md:text-[13px] ${m.estado === 'enviando' ? 'opacity-70' : ''}`}
        style={fallo ? FONDOS.fallo : { background: 'var(--series-1)', color: 'white' }}>
        <span className="block whitespace-pre-wrap break-words">
          {icono}{m.vista.nombre && m.vista.tipo !== 'texto' ? <strong className="font-medium">{m.vista.nombre}</strong> : <ConEnlaces texto={m.vista.texto} claro={!fallo} />}
        </span>
        {esperando && m.venceEn && (
          <>
            <span className="mt-1 flex items-center justify-end gap-2 text-[11px] text-white/90">
              <span>Se manda en <Cuenta hasta={m.venceEn} /></span>
              <button type="button" onClick={onDeshacer}
                className="ui-foco rounded-md bg-white/20 px-2 py-0.5 text-[12px] font-semibold text-white hover:bg-white/30">
                Deshacer
              </button>
            </span>
            <Plazo hasta={m.venceEn} total={m.plazoMs ?? 4000} />
          </>
        )}
        {m.estado === 'enviando' && (
          <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-white/80">
            <IconoChat nombre="reloj" tam={11} /> Enviando…
          </span>
        )}
        {m.estado === 'enviado' && <span className="mt-0.5 block text-right text-[10px] text-white/75">✓</span>}
        {fallo && (
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-[var(--border-hairline)] pt-1">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--status-critical)' }}>No le llegó</span>
            {m.error && <span className="min-w-0 text-[11px] text-[var(--text-secondary)]">{m.error}</span>}
            <span className="ml-auto flex items-center gap-1">
              <button type="button" onClick={onReintentar} className="ui-foco rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--series-1)] hover:bg-[var(--page-plane)]">Reintentar</button>
              {m.payload.texto && (
                <button type="button" className="ui-foco rounded-md px-1.5 py-0.5 text-[11px] font-medium text-[var(--series-1)] hover:bg-[var(--page-plane)]"
                  onClick={async () => { if (await copiar(m.payload.texto ?? '')) aviso.exito('Copiado.'); }}>Copiar</button>
              )}
              <button type="button" onClick={onDescartar} aria-label="Descartar" className="ui-foco rounded-md px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--page-plane)]">✕</button>
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
