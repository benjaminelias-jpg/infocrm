import { useEffect, useState } from 'react';
import { api, plural } from '../../../api';
import { Boton, Campo, Dialogo, Entrada, Seleccion, useAviso } from '../../../ui';
import type { Pipe } from './datos';

// Crear un pipeline (con etapas básicas, copiando otro o vacío) y borrarlo
// sin esconder sus leads (se pasan a otro, con "Deshacer").

type Inicio = 'basicas' | 'copiar' | 'vacio';

export function DialogoNuevoPipeline({ abierto, pipes, actualId, onCerrar, onCreado }: {
  abierto: boolean; pipes: Pipe[]; actualId?: string | null; onCerrar: () => void;
  onCreado: (p: { id: string; nombre: string }) => void;
}) {
  const aviso = useAviso();
  const [nombre, setNombre] = useState('');
  const [inicio, setInicio] = useState<Inicio>('basicas');
  const [copiarDe, setCopiarDe] = useState<string>(actualId ?? pipes[0]?.id ?? '');
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (abierto) { setNombre(''); setInicio('basicas'); setError(null); setCopiarDe(actualId ?? pipes[0]?.id ?? ''); }
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

  const limpio = nombre.trim();
  const repetido = pipes.some((p) => p.nombre.trim().toLowerCase() === limpio.toLowerCase());
  const origen = pipes.find((p) => p.id === copiarDe);

  async function crear(e?: React.FormEvent) {
    e?.preventDefault();
    if (!limpio || repetido) return;
    setCreando(true); setError(null);
    try {
      const p = await api<any>('/pipelines', {
        method: 'POST',
        json: { nombre: limpio, ...(inicio === 'copiar' && copiarDe ? { copiar_de: copiarDe } : {}), ...(inicio === 'vacio' ? { vacio: true } : {}) },
      });
      aviso.exito(inicio === 'copiar' && origen
        ? `Pipeline «${limpio}» creado con las etapas de «${origen.nombre}».`
        : inicio === 'vacio' ? `Pipeline «${limpio}» creado. Agregale sus etapas.` : `Pipeline «${limpio}» creado con 5 etapas básicas.`);
      onCreado(p);
    } catch (err: any) { setError(err.message); } finally { setCreando(false); }
  }

  const opcion = (id: Inicio, titulo: string, detalle: React.ReactNode) => (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px]"
      style={{ borderColor: inicio === id ? 'var(--series-1)' : 'var(--border-hairline)', background: inicio === id ? 'color-mix(in srgb, var(--series-1) 7%, var(--surface-1))' : undefined }}>
      <input type="radio" name="inicio-pipeline" checked={inicio === id} onChange={() => setInicio(id)} className="mt-0.5 h-4 w-4 accent-[var(--series-1)]" />
      <span className="min-w-0">
        <span className="block font-medium">{titulo}</span>
        <span className="block text-[12px] text-[var(--text-muted)]">{detalle}</span>
      </span>
    </label>
  );

  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo="Nuevo pipeline"
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={() => crear()} cargando={creando} disabled={!limpio || repetido}>Crear pipeline</Boton>
      </>}>
      <form onSubmit={crear} className="space-y-3">
        <Campo etiqueta="Nombre" error={repetido ? 'Ya tenés un pipeline con ese nombre' : error ?? undefined}>
          <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Cierre high-ticket" invalido={repetido} maxLength={60} />
        </Campo>
        <div className="space-y-1.5" role="radiogroup" aria-label="Empezar con">
          <div className="text-[12px] font-medium text-[var(--text-secondary)]">Empezar con</div>
          {opcion('basicas', 'Etapas básicas', 'Interesado → En conversación → Llamada agendada → Cliente · Perdido. Ya se mueven solas.')}
          {pipes.length > 0 && opcion('copiar', 'Copiar las etapas de otro pipeline', inicio === 'copiar' ? (
            <Seleccion value={copiarDe} onChange={(e) => setCopiarDe(e.target.value)} className="mt-1.5" aria-label="Pipeline a copiar"
              onClick={(e) => e.stopPropagation()}>
              {pipes.map((p) => <option key={p.id} value={p.id}>{p.nombre} ({plural(p.etapas.length, 'etapa')})</option>)}
            </Seleccion>
          ) : 'Mismos nombres, colores y automatizaciones.')}
          {opcion('vacio', 'Vacío', 'Una sola etapa; armás el resto vos.')}
        </div>
        <button type="submit" hidden aria-hidden />
      </form>
    </Dialogo>
  );
}

export interface ResultadoBorrado {
  borrado: { id: string; nombre: string; era_predeterminado: boolean };
  destino: { id: string; nombre: string };
  movidas: Array<{ id: string; pipeline_id: string; etapa_id: string }>;
  ya_estaban: number;
  predeterminado_id: string | null;
}

export function DialogoBorrarPipeline({ pipe, pipes, abiertos, onCerrar, onBorrado }: {
  pipe: Pipe | null; pipes: Pipe[]; abiertos: number | null; onCerrar: () => void;
  onBorrado: (r: ResultadoBorrado) => void;
}) {
  const otros = pipes.filter((p) => p.id !== pipe?.id);
  const [destino, setDestino] = useState('');
  const [nuevoPred, setNuevoPred] = useState('');
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const pred = otros.find((p) => p.es_predeterminado) ?? otros[0];
    setDestino(pred?.id ?? ''); setNuevoPred(pred?.id ?? ''); setError(null);
  }, [pipe?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pipe) return null;
  const conLeads = (abiertos ?? 0) > 0;

  async function borrar() {
    if (!pipe) return;
    setBorrando(true); setError(null);
    try {
      const qs = new URLSearchParams();
      if (destino) qs.set('mover_a', destino);
      if (pipe.es_predeterminado && nuevoPred) qs.set('predeterminado', nuevoPred);
      const r = await api<ResultadoBorrado>(`/pipelines/${pipe.id}?${qs}`, { method: 'DELETE' });
      onBorrado(r);
    } catch (err: any) { setError(err.message); } finally { setBorrando(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={`Borrar «${pipe.nombre}»`}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="peligro" onClick={borrar} cargando={borrando} disabled={otros.length === 0}>
          {conLeads ? 'Borrar y pasar los leads' : 'Borrar pipeline'}
        </Boton>
      </>}>
      <div className="space-y-3 text-[13px]">
        {otros.length === 0 ? (
          <p>Es tu único pipeline: no se puede borrar.</p>
        ) : (
          <>
            {abiertos === null ? <p className="text-[var(--text-muted)]">Contando sus leads…</p> : conLeads ? (
              <Campo etiqueta={`Tiene ${plural(abiertos ?? 0, 'lead abierto', 'leads abiertos')}. ¿A qué pipeline los pasamos?`}
                ayuda="Van a la etapa con el mismo nombre; si no existe, a la primera.">
                <Seleccion value={destino} onChange={(e) => setDestino(e.target.value)}>
                  {otros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </Seleccion>
              </Campo>
            ) : <p>No tiene leads abiertos.</p>}
            {pipe.es_predeterminado && (
              <Campo etiqueta="Acá entraban los leads nuevos. ¿A dónde entran ahora?">
                <Seleccion value={nuevoPred} onChange={(e) => setNuevoPred(e.target.value)}>
                  {otros.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </Seleccion>
              </Campo>
            )}
            <p className="text-[12px] text-[var(--text-muted)]">Después vas a poder tocar «Deshacer».</p>
          </>
        )}
        {error && <p className="text-[12px]" style={{ color: 'var(--status-critical)' }}>{error}</p>}
      </div>
    </Dialogo>
  );
}
