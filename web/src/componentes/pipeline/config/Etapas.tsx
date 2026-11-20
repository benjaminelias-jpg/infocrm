import { useEffect, useRef, useState } from 'react';
import { api, plural } from '../../../api';
import {
  Boton, BotonIcono, Campo, Chevron, Dialogo, Entrada, Insignia, ItemMenu, Menu, Seleccion, SeparadorMenu, useAviso, useEsMovil,
} from '../../../ui';
import Icono from '../../Iconos';
import { resumirAcciones, accionesDe } from '../acciones';
import EditorAcciones from './Acciones';
import { EVENTOS, PALETA, textoEvento, type Conexion, type Etapa, type Pipe } from './datos';

// Lista de etapas de un pipeline: cada una se abre para elegir con qué evento
// se mueve sola, su color y qué hace cuando entra un lead. Se ordenan
// arrastrando ⠿ (o con ↑ ↓ en el teclado, o desde el ⋯ en el celular).

export default function ListaEtapas({
  pipe, recursos, flujos, conexiones, onRecargar, onSucio, abrirInicial, onConexionCreada,
}: {
  pipe: Pipe; recursos: any[]; flujos: any[]; conexiones: Conexion[];
  onRecargar: () => Promise<void>; onSucio: (s: { etapa: string } | null) => void;
  abrirInicial?: string | null; onConexionCreada: (c: Conexion) => void;
}) {
  const aviso = useAviso();
  const movil = useEsMovil(768);
  const [etapas, setEtapas] = useState<Etapa[]>(pipe.etapas);
  const [abierta, setAbierta] = useState<string | null>(abrirInicial ?? null);
  const [sucia, setSucia] = useState<string | null>(null);
  const [conteos, setConteos] = useState<Record<string, number> | null>(null);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [destino, setDestino] = useState<{ id: string; antes: boolean } | null>(null);
  const [nuevaDebajo, setNuevaDebajo] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Etapa | null>(null);
  const [renombrando, setRenombrando] = useState<string | null>(null);

  useEffect(() => { setEtapas(pipe.etapas); }, [pipe.etapas]);
  useEffect(() => {
    let vivo = true;
    api<Record<string, number>>(`/ux/pipeline/conteos-etapas?pipeline_id=${pipe.id}`).then((c) => vivo && setConteos(c)).catch(() => {});
    return () => { vivo = false; };
  }, [pipe.id, pipe.etapas]);
  // La etapa pedida desde el tablero ("Editar esta etapa"): abierta y a la vista.
  useEffect(() => {
    if (!abrirInicial) return;
    setAbierta(abrirInicial);
    window.setTimeout(() => document.querySelector(`[data-etapa="${abrirInicial}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }, [abrirInicial]);

  function alternar(id: string) {
    if (sucia && sucia !== id) {
      aviso.info(`Primero guardá o descartá los cambios de «${etapas.find((e) => e.id === sucia)?.nombre}».`);
      document.querySelector(`[data-etapa="${sucia}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (sucia === id && abierta === id) {
      aviso.info('Tenés cambios sin guardar: tocá Guardar o Descartar.');
      return;
    }
    setAbierta((a) => (a === id ? null : id));
  }

  async function guardarOrden(nuevas: Etapa[], antes: Etapa[]) {
    setEtapas(nuevas);
    try {
      await api(`/pipelines/${pipe.id}/reordenar`, { method: 'POST', json: { orden: nuevas.map((e) => e.id) } });
      await onRecargar();
    } catch (e: any) { setEtapas(antes); aviso.error(e.message); }
  }
  function mover(id: string, dir: -1 | 1) {
    const i = etapas.findIndex((e) => e.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= etapas.length) return;
    const nuevas = [...etapas];
    [nuevas[i], nuevas[j]] = [nuevas[j], nuevas[i]];
    guardarOrden(nuevas, etapas);
  }
  function soltar() {
    if (!arrastrando || !destino || arrastrando === destino.id) { setArrastrando(null); setDestino(null); return; }
    const sin = etapas.filter((e) => e.id !== arrastrando);
    const movida = etapas.find((e) => e.id === arrastrando)!;
    let k = sin.findIndex((e) => e.id === destino.id);
    if (!destino.antes) k += 1;
    const nuevas = [...sin.slice(0, k), movida, ...sin.slice(k)];
    setArrastrando(null); setDestino(null);
    if (nuevas.map((e) => e.id).join() !== etapas.map((e) => e.id).join()) guardarOrden(nuevas, etapas);
  }

  async function patch(e: Etapa, cambios: Partial<Etapa>, ok?: string) {
    const antes = etapas;
    setEtapas((l) => l.map((x) => (x.id === e.id ? { ...x, ...cambios } : x)));
    try {
      await api(`/etapas/${e.id}`, { method: 'PATCH', json: cambios });
      if (ok) aviso.exito(ok);
      await onRecargar();
    } catch (err: any) { setEtapas(antes); aviso.error(err.message); }
  }

  async function duplicar(e: Etapa) {
    try {
      await api(`/etapas/${e.id}/duplicar`, { method: 'POST' });
      await onRecargar();
      aviso.exito(`Listo: «${e.nombre} (copia)» quedó debajo de «${e.nombre}».`);
    } catch (err: any) { aviso.error(err.message); }
  }

  const iCierre = etapas.findIndex((e) => e.tipo !== 'abierta');
  const otrasConEvento = (e: Etapa) => (ev: string) => etapas.find((x) => x.id !== e.id && x.evento_asociado === ev);

  return (
    <div>
      <p className="mb-2 text-[12px] text-[var(--text-muted)]">
        Tocá una etapa para elegir con qué se mueve sola y qué hace cuando entra un lead.{' '}
        {movil ? 'Para ordenarlas, tocá ⋯ → Subir o Bajar.' : <>Para ordenarlas, arrastrá <span aria-hidden>⠿</span>.</>}
      </p>
      <ul className="space-y-1.5" onDragEnd={() => { setArrastrando(null); setDestino(null); }}>
        {etapas.map((e, i) => (
          <li key={e.id}>
            {i === iCierre && (
              <NuevaEtapa pipeId={pipe.id} antesDe={e.id} onCreada={onRecargar} texto="Agregar etapa" />
            )}
            <FilaEtapa e={e} i={i} total={etapas.length} abierta={abierta === e.id} conteo={conteos?.[e.id]}
              arrastrando={arrastrando === e.id}
              indicador={destino?.id === e.id && arrastrando !== e.id ? (destino.antes ? 'antes' : 'despues') : null}
              renombrando={renombrando === e.id}
              onAlternar={() => alternar(e.id)}
              onRenombrar={(v) => { setRenombrando(null); if (v && v !== e.nombre) patch(e, { nombre: v }); }}
              onEmpezarRenombrar={() => setRenombrando(e.id)}
              onMover={(d) => mover(e.id, d)}
              onDuplicar={() => duplicar(e)}
              onBorrar={() => setBorrar(e)}
              onNuevaDebajo={() => setNuevaDebajo(e.id)}
              onDragStart={() => setArrastrando(e.id)}
              onDragOver={(antes) => setDestino({ id: e.id, antes })}
              onDrop={soltar}>
              <div className="space-y-4">
                <Campo etiqueta="Se mueve sola cuando el lead…"
                  ayuda={e.tipo === 'perdida' ? undefined : 'Si el lead está en una etapa anterior, pasa a esta solo. Para atrás solo lo mueven agendar, la llamada, la compra o la devolución.'}>
                  <Seleccion value={e.evento_asociado ?? ''} aria-label={`Evento que mueve «${e.nombre}»`}
                    onChange={(ev) => patch(e, { evento_asociado: ev.target.value || null }, ev.target.value ? `«${e.nombre}» ahora se mueve sola cuando el lead ${textoEvento(ev.target.value)}.` : `«${e.nombre}» solo se mueve a mano.`)}>
                    <option value="">Nunca: la muevo yo a mano</option>
                    {EVENTOS.map((ev) => {
                      const otra = otrasConEvento(e)(ev.id);
                      return <option key={ev.id} value={ev.id}>{ev.lead}{otra ? ` (ya la usa «${otra.nombre}»)` : ''}</option>;
                    })}
                  </Seleccion>
                </Campo>
                {e.evento_asociado && otrasConEvento(e)(e.evento_asociado) && (
                  <p className="-mt-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: 'color-mix(in srgb, var(--status-warning) 12%, var(--surface-1))' }}>
                    ⚠ «{otrasConEvento(e)(e.evento_asociado)!.nombre}» también se mueve cuando el lead {textoEvento(e.evento_asociado)}: va a usar la que esté más arriba.
                  </p>
                )}
                <div>
                  <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Color</div>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`Color de «${e.nombre}»`}>
                    {PALETA.map((c) => {
                      const activo = e.color?.toLowerCase() === c;
                      return (
                        <button key={c} type="button" role="radio" aria-checked={activo} aria-label={`Color ${c}`}
                          onClick={() => !activo && patch(e, { color: c })}
                          className="ui-foco flex h-9 w-9 items-center justify-center rounded-full md:h-8 md:w-8"
                          style={{ background: c, boxShadow: activo ? '0 0 0 2px var(--surface-1), 0 0 0 4px var(--text-primary)' : undefined }}>
                          {activo && <span className="text-[12px] text-white" aria-hidden>✓</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <EditorAcciones key={`${e.id}-${JSON.stringify(e.acciones ?? [])}`} etapa={e} recursos={recursos} flujos={flujos} conexiones={conexiones}
                  onConexionCreada={onConexionCreada}
                  onSucio={(s) => { setSucia((x) => (s ? e.id : x === e.id ? null : x)); onSucio(s ? { etapa: e.nombre } : null); }}
                  onGuardado={async (acc) => {
                    setEtapas((l) => l.map((x) => (x.id === e.id ? { ...x, acciones: acc } : x)));
                    aviso.exito(acc.length
                      ? `Listo: cada lead que entre a «${e.nombre}» va a disparar ${plural(acc.length, 'acción', 'acciones')}.`
                      : `«${e.nombre}» ya no hace nada sola.`);
                    await onRecargar();
                  }} />
              </div>
            </FilaEtapa>
            {nuevaDebajo === e.id && (
              <NuevaEtapa pipeId={pipe.id} antesDe={etapas[i + 1]?.id ?? null} autoFoco onCreada={async () => { setNuevaDebajo(null); await onRecargar(); }}
                onCancelar={() => setNuevaDebajo(null)} texto="Nueva etapa" />
            )}
          </li>
        ))}
      </ul>
      {iCierre === -1 && <div className="mt-1.5"><NuevaEtapa pipeId={pipe.id} antesDe={null} onCreada={onRecargar} texto="Agregar etapa" /></div>}

      {borrar && (
        <DialogoBorrarEtapa etapa={borrar} etapas={etapas} conteo={conteos?.[borrar.id] ?? null}
          onCerrar={() => setBorrar(null)}
          onBorrada={async (texto) => { setBorrar(null); if (abierta === borrar.id) setAbierta(null); aviso.exito(texto); await onRecargar(); }} />
      )}
    </div>
  );
}

function FilaEtapa({
  e, i, total, abierta, conteo, arrastrando, indicador, renombrando, children,
  onAlternar, onRenombrar, onEmpezarRenombrar, onMover, onDuplicar, onBorrar, onNuevaDebajo, onDragStart, onDragOver, onDrop,
}: {
  e: Etapa; i: number; total: number; abierta: boolean; conteo?: number; arrastrando: boolean;
  indicador: 'antes' | 'despues' | null; renombrando: boolean; children: React.ReactNode;
  onAlternar: () => void; onRenombrar: (v: string) => void; onEmpezarRenombrar: () => void; onMover: (d: -1 | 1) => void;
  onDuplicar: () => void; onBorrar: () => void; onNuevaDebajo: () => void;
  onDragStart: () => void; onDragOver: (antes: boolean) => void; onDrop: () => void;
}) {
  const acciones = accionesDe(e);
  const resumen = [
    e.evento_asociado ? `↻ se mueve cuando ${EVENTOS.find((x) => x.id === e.evento_asociado)?.corto ?? textoEvento(e.evento_asociado)}` : 'se mueve a mano',
    acciones.length ? `⚡ ${resumirAcciones(e)}` : null,
  ].filter(Boolean).join(' · ');
  const fila = useRef<HTMLDivElement>(null);
  return (
    <div ref={fila} data-etapa={e.id}
      onDragOver={(ev) => {
        ev.preventDefault();
        const r = fila.current?.getBoundingClientRect();
        if (r) onDragOver(ev.clientY < r.top + r.height / 2);
      }}
      onDrop={(ev) => { ev.preventDefault(); onDrop(); }}
      className={`tarjeta relative scroll-mt-20 transition-opacity ${arrastrando ? 'opacity-40' : ''}`}>
      {indicador && (
        <div className={`absolute inset-x-2 h-0.5 rounded-full ${indicador === 'antes' ? '-top-1' : '-bottom-1'}`} style={{ background: 'var(--series-1)' }} aria-hidden />
      )}
      <div className="flex items-center gap-1 py-1 pl-1 pr-1.5">
        <button type="button" draggable aria-label={`Mover «${e.nombre}» (arrastrá, o usá las flechas ↑ ↓)`}
          onDragStart={(ev) => { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', e.id); onDragStart(); }}
          onKeyDown={(ev) => {
            if (ev.key === 'ArrowUp') { ev.preventDefault(); onMover(-1); }
            if (ev.key === 'ArrowDown') { ev.preventDefault(); onMover(1); }
          }}
          className="ui-foco hidden h-10 w-7 shrink-0 cursor-grab items-center justify-center rounded-md text-[16px] text-[var(--text-muted)] hover:bg-[var(--page-plane)] active:cursor-grabbing md:flex">
          ⠿
        </button>
        {renombrando ? (
          <form className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-2" onSubmit={(ev) => { ev.preventDefault(); onRenombrar((new FormData(ev.currentTarget).get('nombre') as string ?? '').trim()); }}>
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: e.color }} aria-hidden />
            <Entrada name="nombre" defaultValue={e.nombre} autoFocus maxLength={40} aria-label="Nombre de la etapa"
              onBlur={(ev) => onRenombrar(ev.target.value.trim())}
              onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.preventDefault(); onRenombrar(e.nombre); } }} />
          </form>
        ) : (
          <button type="button" onClick={onAlternar} aria-expanded={abierta}
            className="ui-foco flex min-h-[52px] min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: e.color }} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-medium">{e.nombre}</span>
                {e.tipo === 'ganada' && <Insignia tono="verde">venta</Insignia>}
                {e.tipo === 'perdida' && <Insignia tono="neutro">perdido</Insignia>}
                {conteo !== undefined && conteo > 0 && <span className="cifras shrink-0 text-[11px] text-[var(--text-muted)]">{plural(conteo, 'lead')}</span>}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-[var(--text-muted)]">{resumen}</span>
            </span>
            <Chevron abierto={abierta} />
          </button>
        )}
        <Menu alinear="derecha" ancho={240} titulo={e.nombre} disparador={({ alternar, abierto, ref }) => (
          <BotonIcono ref={ref} etiqueta={`Más acciones de «${e.nombre}»`} variante="fantasma" tamano="md" onClick={alternar} aria-expanded={abierto}>
            <Icono nombre="puntos" tam={18} />
          </BotonIcono>
        )}>
          <ItemMenu icono="✏️" onClick={onEmpezarRenombrar}>Cambiar nombre</ItemMenu>
          <ItemMenu icono="↑" onClick={() => onMover(-1)} deshabilitado={i === 0}>Subir</ItemMenu>
          <ItemMenu icono="↓" onClick={() => onMover(1)} deshabilitado={i === total - 1}>Bajar</ItemMenu>
          <ItemMenu icono="+" onClick={onNuevaDebajo}>Agregar una etapa debajo</ItemMenu>
          <ItemMenu icono="⧉" onClick={onDuplicar}>Duplicar</ItemMenu>
          <SeparadorMenu />
          <ItemMenu icono="🗑" peligro onClick={onBorrar}>Borrar etapa</ItemMenu>
        </Menu>
      </div>
      {abierta && !renombrando && <div className="border-t border-[var(--border-hairline)] px-3 pb-3 pt-3">{children}</div>}
    </div>
  );
}

function NuevaEtapa({ pipeId, antesDe, onCreada, onCancelar, texto, autoFoco }: {
  pipeId: string; antesDe: string | null; onCreada: () => Promise<void> | void; onCancelar?: () => void; texto: string; autoFoco?: boolean;
}) {
  const aviso = useAviso();
  const [abierta, setAbierta] = useState(!!autoFoco);
  const [nombre, setNombre] = useState('');
  const [creando, setCreando] = useState(false);
  async function crear(ev?: React.FormEvent) {
    ev?.preventDefault();
    if (!nombre.trim()) return;
    setCreando(true);
    try {
      await api(`/pipelines/${pipeId}/etapas`, { method: 'POST', json: { nombre: nombre.trim(), ...(antesDe ? { antes_de: antesDe } : { antes_de: null }) } });
      aviso.exito(`Etapa «${nombre.trim()}» creada.`);
      setNombre(''); setAbierta(false);
      await onCreada();
    } catch (e: any) { aviso.error(e.message); } finally { setCreando(false); }
  }
  function cancelar() { setNombre(''); setAbierta(false); onCancelar?.(); }
  if (!abierta) {
    return (
      <button type="button" onClick={() => setAbierta(true)}
        className="ui-foco mb-1.5 flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--border-hairline)] text-[13px] text-[var(--text-secondary)] hover:bg-[var(--surface-1)]">
        <Icono nombre="mas" tam={15} /> {texto}
      </button>
    );
  }
  return (
    <form onSubmit={crear} className="mb-1.5 flex items-center gap-2 rounded-xl border border-dashed p-2" style={{ borderColor: 'var(--series-1)' }}>
      <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la etapa (ej. Seguimiento)" autoFocus maxLength={40}
        onKeyDown={(e) => { if (e.key === 'Escape') cancelar(); }} aria-label="Nombre de la nueva etapa" />
      <Boton type="submit" variante="primario" tamano="sm" cargando={creando} disabled={!nombre.trim()}>Crear</Boton>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={cancelar}>Cancelar</Boton>
    </form>
  );
}

function DialogoBorrarEtapa({ etapa, etapas, conteo, onCerrar, onBorrada }: {
  etapa: Etapa; etapas: Etapa[]; conteo: number | null; onCerrar: () => void; onBorrada: (texto: string) => void;
}) {
  const otras = etapas.filter((e) => e.id !== etapa.id);
  const anterior = [...etapas.slice(0, etapas.findIndex((e) => e.id === etapa.id))].reverse().find((e) => e.tipo === 'abierta');
  const [destino, setDestino] = useState(anterior?.id ?? otras.find((e) => e.tipo === 'abierta')?.id ?? '');
  const [borrando, setBorrando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unicaAbierta = etapa.tipo === 'abierta' && etapas.filter((e) => e.tipo === 'abierta').length <= 1;
  const n = conteo ?? 0;

  async function borrar() {
    setBorrando(true); setError(null);
    try {
      const r = await api<any>(`/etapas/${etapa.id}${n > 0 && destino ? `?mover_a=${destino}` : ''}`, { method: 'DELETE' });
      onBorrada(r?.movidas ? `Etapa «${etapa.nombre}» borrada. ${plural(r.movidas, 'lead pasó', 'leads pasaron')} a «${r.destino?.nombre}».` : `Etapa «${etapa.nombre}» borrada.`);
    } catch (e: any) { setError(e.message); } finally { setBorrando(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={`Borrar la etapa «${etapa.nombre}»`}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="peligro" onClick={borrar} cargando={borrando} disabled={unicaAbierta}>{n > 0 ? 'Borrar y pasar los leads' : 'Borrar etapa'}</Boton>
      </>}>
      <div className="space-y-3 text-[13px]">
        {unicaAbierta ? <p>Es la única etapa abierta del pipeline: hace falta al menos una para cargar leads.</p> : n > 0 ? (
          <Campo etiqueta={`Tiene ${plural(n, 'lead')}. ¿A qué etapa los pasamos?`}>
            <Seleccion value={destino} onChange={(e) => setDestino(e.target.value)}>
              {otras.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </Seleccion>
          </Campo>
        ) : <p>No tiene leads. {accionesDe(etapa).length > 0 ? 'Sus automatizaciones se borran con ella.' : ''}</p>}
        {error && <p className="text-[12px]" style={{ color: 'var(--status-critical)' }}>{error}</p>}
      </div>
    </Dialogo>
  );
}
