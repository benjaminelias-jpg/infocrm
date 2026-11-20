import { useState } from 'react';
import { api } from '../../api';
import { Boton, Entrada, useAviso } from '../../ui';

// Lead rápido (como en Kommo): se carga a mano directo en una etapa.
// Regla clara: si empieza con "@" (o es un link de instagram.com) es un
// usuario de Instagram; si no, es un nombre. Se ve en vivo cómo se va a
// cargar y se puede cambiar con un toque. Si el @usuario ya existe, pregunta
// antes de moverlo (mover dispara las automatizaciones de la etapa).

function interpretar(v: string): { usuario?: string; nombre?: string } {
  const t = v.trim();
  const link = t.match(/instagram\.com\/([A-Za-z0-9._]+)/i);
  if (link) return { usuario: link[1] };
  if (t.startsWith('@')) return { usuario: t.slice(1).trim() };
  return { nombre: t };
}

export default function LeadRapido({ etapa, pipelineId, onCerrar, onCreado, compacto = true }: {
  etapa: { id: string; nombre: string };
  pipelineId: string | null;
  onCerrar: () => void;
  onCreado: (texto: string) => Promise<void> | void;
  /** true = formulario chico dentro de la columna; false = dentro de una hoja (celular). */
  compacto?: boolean;
}) {
  const aviso = useAviso();
  const [texto, setTexto] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [forzarNombre, setForzarNombre] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [yaExiste, setYaExiste] = useState<null | { etapa?: string; pipeline?: string }>(null);

  const base = interpretar(texto);
  const como = forzarNombre && base.usuario ? { nombre: texto.trim() } : base;
  const valido = Boolean(texto.trim()) && (!como.usuario || /^[A-Za-z0-9._]{1,30}$/.test(como.usuario));

  async function cargar(confirmado = false) {
    if (!valido) return;
    setOcupado(true);
    try {
      if (como.usuario && !confirmado) {
        const r = await api<any>(`/ux/pipeline/existe?usuario=${encodeURIComponent(como.usuario)}${pipelineId ? `&pipeline_id=${pipelineId}` : ''}`);
        if (r.existe && r.etapa) { setYaExiste({ etapa: r.etapa, pipeline: r.pipeline }); setOcupado(false); return; }
      }
      const r = await api<any>('/ux/pipeline/lead-rapido', {
        method: 'POST',
        json: { etapa_id: etapa.id, ...como, etiqueta: etiqueta.trim() || undefined },
      });
      const quien = como.usuario ? `@${como.usuario}` : como.nombre;
      setTexto(''); setEtiqueta(''); setYaExiste(null); setForzarNombre(false);
      await onCreado(r.ya_existia ? `${quien} pasó a «${etapa.nombre}».` : `${quien} cargado en «${etapa.nombre}».`);
    } catch (err: any) {
      aviso.error(err.message);
    } finally { setOcupado(false); }
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); cargar(false); }} onKeyDown={(e) => { if (e.key === 'Escape') onCerrar(); }}
      className={compacto ? 'ui-aparecer space-y-1.5 rounded-lg border p-2' : 'space-y-3'}
      style={compacto ? { background: 'var(--surface-1)', borderColor: 'var(--series-1)' } : undefined}>
      <Entrada autoFocus value={texto} onChange={(e) => { setTexto(e.target.value); setYaExiste(null); }}
        placeholder="@usuario de Instagram o nombre" aria-label="@usuario o nombre" autoComplete="off" autoCapitalize="none" />
      {texto.trim() && (
        <button type="button" onClick={() => base.usuario && setForzarNombre((f) => !f)} disabled={!base.usuario}
          className="ui-foco inline-flex max-w-full items-center gap-1 truncate rounded-[8px] px-2 py-0.5 text-[11px]"
          style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
          {como.usuario
            ? <>Se carga como Instagram: <b style={{ color: 'var(--series-1)' }}>@{como.usuario}</b>{!valido && ' (usuario inválido)'}<span className="opacity-70"> · cambiar</span></>
            : <>Se carga como nombre: <b>{como.nombre}</b>{base.usuario ? <span className="opacity-70"> · cambiar</span> : <span className="opacity-70"> · para Instagram empezá con @</span>}</>}
        </button>
      )}
      <Entrada value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Etiqueta (opcional)" aria-label="Etiqueta" />
      {yaExiste ? (
        <div className="space-y-2 rounded-lg p-2 text-[12px]" style={{ background: 'color-mix(in srgb, var(--status-warning) 12%, var(--surface-1))' }}>
          <p>@{como.usuario} ya está en «{yaExiste.etapa}»{yaExiste.pipeline ? ` (${yaExiste.pipeline})` : ''}. ¿Lo paso a «{etapa.nombre}»?</p>
          <div className="flex justify-end gap-1.5">
            <Boton tamano="xs" variante="fantasma" type="button" onClick={() => setYaExiste(null)}>Cancelar</Boton>
            <Boton tamano="xs" variante="primario" type="button" cargando={ocupado} onClick={() => cargar(true)}>Pasarlo</Boton>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-1.5">
          <Boton tamano={compacto ? 'xs' : 'sm'} variante="fantasma" type="button" onClick={onCerrar}>Cancelar</Boton>
          <Boton tamano={compacto ? 'xs' : 'sm'} variante="primario" type="submit" cargando={ocupado} disabled={!valido}>Agregar</Boton>
        </div>
      )}
    </form>
  );
}
