import { useMemo, useState } from 'react';
import { api, fmtNum, hace, plural } from '../../../api';
import {
  Boton, BotonIcono, Campo, Entrada, ErrorCarga, Esqueleto, Insignia, Interruptor, ItemMenu, Menu, Seleccion, SeparadorMenu,
  TituloSeccion, Vacio, useAviso, useCarga,
} from '../../../ui';
import Icono from '../../Iconos';
import { SelectorConexion } from './Conexiones';
import {
  ACCIONES_REGLA, EVENTOS, claveRegla, describirAccionRegla, describirCondicion, faltaEnRegla, textoEvento, urlValida,
  type Conexion, type Etapa, type Pipe,
} from './datos';

// Reglas automáticas: "cuando el lead hace X, hacé Y". Valen para todos los
// pipelines. Se leen como una frase completa (con sus condiciones), avisan
// lo que les falta y se editan tocándolas.

interface Borrador {
  id?: string; nombre?: string; evento: string; minimo: string; tipo: string; valor: string;
  suscripcion_id?: string | null; url?: string; otrasCondiciones: any[]; otrasAcciones: any[];
}

const VACIO: Borrador = { evento: 'venta', minimo: '', tipo: 'etiquetar', valor: '', otrasCondiciones: [], otrasAcciones: [] };

function aBorrador(r: any): Borrador {
  const conds: any[] = Array.isArray(r.condiciones) ? r.condiciones : [];
  const minimo = conds.find((c) => c.campo === 'evento.valor' && c.operador === 'mayor_que');
  const [primera, ...resto] = Array.isArray(r.acciones) ? r.acciones : [];
  const meta = ACCIONES_REGLA.find((a) => a.tipo === primera?.tipo);
  return {
    id: r.id, nombre: r.nombre,
    evento: r.disparador?.evento ?? 'venta',
    minimo: minimo ? String(minimo.valor ?? '') : '',
    tipo: primera?.tipo ?? 'etiquetar',
    valor: meta?.campo && meta.campo !== 'conexion' ? String(primera?.[meta.campo] ?? '') : '',
    suscripcion_id: primera?.suscripcion_id ?? null,
    url: primera?.url ?? '',
    otrasCondiciones: conds.filter((c) => c !== minimo),
    otrasAcciones: resto,
  };
}

function deBorrador(b: Borrador, ctx: { etapas: Etapa[]; conexiones: Conexion[] }) {
  const meta = ACCIONES_REGLA.find((a) => a.tipo === b.tipo)!;
  const accion: any = { tipo: b.tipo };
  if (meta.campo === 'conexion') {
    if (b.suscripcion_id) accion.suscripcion_id = b.suscripcion_id; else accion.url = (b.url ?? '').trim();
  } else if (meta.campo) accion[meta.campo] = b.valor.trim();
  const minimo = Number(String(b.minimo).replace(',', '.'));
  const condiciones = [
    ...(b.evento === 'venta' && b.minimo !== '' && Number.isFinite(minimo) && minimo > 0
      ? [{ campo: 'evento.valor', operador: 'mayor_que', valor: minimo }] : []),
    ...b.otrasCondiciones,
  ];
  const acciones = [accion, ...b.otrasAcciones];
  const frase = `Cuando el lead ${textoEvento(b.evento)}: ${acciones.map((a) => describirAccionRegla(a, ctx)).join(' y ')}`;
  return { nombre: frase.slice(0, 120), disparador: { evento: b.evento }, condiciones, acciones };
}

export default function ReglasAutomaticas({ pipes, conexiones, onConexionCreada }: {
  pipes: Pipe[]; conexiones: Conexion[]; onConexionCreada: (c: Conexion) => void;
}) {
  const aviso = useAviso();
  const { datos: reglas, error, recargar, setDatos } = useCarga(() => api<any[]>('/reglas'), []);
  const [editando, setEditando] = useState<Borrador | null>(null);

  const etapas = useMemo(() => pipes.flatMap((p) => p.etapas), [pipes]);
  const ctx = { etapas, conexiones };
  const repetidas = useMemo(() => {
    const vistas = new Map<string, string>();
    const r = new Set<string>();
    for (const x of reglas ?? []) {
      const k = claveRegla(x);
      if (vistas.has(k)) r.add(x.id); else vistas.set(k, x.id);
    }
    return r;
  }, [reglas]);

  async function activar(r: any, activo: boolean) {
    setDatos((l) => l?.map((x) => (x.id === r.id ? { ...x, activo } : x)) ?? l);
    try {
      await api(`/reglas/${r.id}`, { method: 'PATCH', json: { activo } });
      aviso.exito(activo ? 'Regla activada.' : 'Regla en pausa.');
    } catch (e: any) { aviso.error(e.message); await recargar(true); }
  }

  async function borrar(r: any) {
    try {
      await api(`/reglas/${r.id}`, { method: 'DELETE' });
      await recargar(true);
      const copia = { nombre: r.nombre, disparador: r.disparador, condiciones: r.condiciones ?? [], acciones: r.acciones ?? [], activo: r.activo };
      aviso.exito('Regla borrada.', {
        texto: 'Deshacer',
        onClick: async () => {
          try { await api('/reglas', { method: 'POST', json: copia }); await recargar(true); } catch (e: any) { aviso.error(e.message); }
        },
      });
    } catch (e: any) { aviso.error(e.message); }
  }

  if (error && !reglas) return <ErrorCarga error={error} titulo="No pudimos cargar las reglas" onReintentar={() => recargar()} />;

  return (
    <div>
      <TituloSeccion titulo="Tus reglas" onMas={editando ? undefined : () => setEditando({ ...VACIO })} textoMas="Nueva regla"
        subtitulo="Valen para todos tus pipelines. Pasan solas cuando el lead hace algo, esté en la etapa que esté." />

      {editando && !editando.id && (
        <EditorRegla borrador={editando} pipes={pipes} conexiones={conexiones} onConexionCreada={onConexionCreada}
          onCancelar={() => setEditando(null)}
          onGuardar={async (cuerpo) => {
            await api('/reglas', { method: 'POST', json: cuerpo });
            setEditando(null); aviso.exito('Regla creada.'); await recargar(true);
          }} />
      )}

      {!reglas ? (
        <div className="space-y-2" aria-busy="true"><Esqueleto alto={64} /><Esqueleto alto={64} /><Esqueleto alto={64} /></div>
      ) : reglas.length === 0 && !editando ? (
        <Vacio icono="⚙️" titulo="Todavía no tenés reglas"
          texto="Por ejemplo: cuando el lead compra, ponerle la etiqueta «cliente»; cuando no se presenta a la llamada, dejarle una nota para recuperarlo."
          accion={<Boton variante="primario" onClick={() => setEditando({ ...VACIO })}>Crear mi primera regla</Boton>} />
      ) : (
        <ul className="space-y-1.5">
          {reglas.map((r) => {
            if (editando && editando.id === r.id) {
              return (
                <li key={r.id}>
                  <EditorRegla borrador={editando} pipes={pipes} conexiones={conexiones} onConexionCreada={onConexionCreada}
                    onCancelar={() => setEditando(null)}
                    onGuardar={async (cuerpo) => {
                      await api(`/reglas/${r.id}`, { method: 'PATCH', json: cuerpo });
                      setEditando(null); aviso.exito('Regla guardada.'); await recargar(true);
                    }} />
                </li>
              );
            }
            const falta = faltaEnRegla(r, ctx);
            const conds: any[] = Array.isArray(r.condiciones) ? r.condiciones : [];
            const errores = Number(r.ejecuciones_error) || 0;
            return (
              <li key={r.id} className="tarjeta flex items-start gap-2 p-2.5">
                <div className="pt-1" onClick={(e) => e.stopPropagation()}>
                  <Interruptor activo={!!r.activo && !falta.length} deshabilitado={falta.length > 0}
                    onCambiar={(v) => activar(r, v)} etiqueta={<span className="sr-only">{r.activo ? 'Activa' : 'En pausa'}</span>} />
                </div>
                <button type="button" onClick={() => setEditando(aBorrador(r))} className="ui-foco min-w-0 flex-1 rounded-lg px-1 py-0.5 text-left">
                  <span className={`block text-[13px] leading-snug ${r.activo ? '' : 'text-[var(--text-secondary)]'}`}>
                    Cuando el lead <b>{textoEvento(r.disparador?.evento) || '…'}</b>
                    {conds.length > 0 && <> y {conds.map(describirCondicion).join(' y ')}</>}
                    {' → '}<b>{(r.acciones ?? []).map((a: any) => describirAccionRegla(a, ctx)).join(' y ') || '…'}</b>
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                    {!r.activo && !falta.length && <Insignia tono="neutro">En pausa</Insignia>}
                    {falta.length > 0 && <Insignia tono="amarillo">⚠ Falta completar: {falta.join(', ')}</Insignia>}
                    {repetidas.has(r.id) && <Insignia tono="amarillo">Repetida: hace lo mismo que otra</Insignia>}
                    <span className="cifras">
                      {Number(r.ejecuciones_ok) > 0 ? `Pasó ${plural(Number(r.ejecuciones_ok), 'vez', 'veces')}` : 'Todavía no pasó'}
                      {r.ultima_ejecucion_en ? ` · la última ${hace(r.ultima_ejecucion_en)}` : ''}
                    </span>
                    {errores > 0 && <span style={{ color: 'var(--status-critical)' }}>· {fmtNum(errores)} con error</span>}
                  </span>
                </button>
                <MenuRegla onEditar={() => setEditando(aBorrador(r))} onPausar={() => activar(r, !r.activo)} activa={!!r.activo}
                  puedeActivar={!falta.length} onBorrar={() => borrar(r)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MenuRegla({ onEditar, onPausar, activa, puedeActivar, onBorrar }: {
  onEditar: () => void; onPausar: () => void; activa: boolean; puedeActivar: boolean; onBorrar: () => void;
}) {
  const [seguro, setSeguro] = useState(false);
  return (
    <Menu alinear="derecha" ancho={220} disparador={({ alternar, abierto, ref }) => (
      <BotonIcono ref={ref} etiqueta="Más acciones de la regla" variante="fantasma" tamano="md" onClick={() => { setSeguro(false); alternar(); }} aria-expanded={abierto}>
        <Icono nombre="puntos" tam={18} />
      </BotonIcono>
    )}>
      <ItemMenu icono="✏️" onClick={onEditar}>Editar</ItemMenu>
      <ItemMenu icono={activa ? '⏸' : '▶'} onClick={onPausar} deshabilitado={!activa && !puedeActivar}>{activa ? 'Pausar' : 'Activar'}</ItemMenu>
      <SeparadorMenu />
      <ItemMenu icono="🗑" peligro cerrarAlTocar={seguro} onClick={() => { if (seguro) onBorrar(); else setSeguro(true); }}>
        {seguro ? '¿Seguro? Tocá de nuevo' : 'Borrar'}
      </ItemMenu>
    </Menu>
  );
}

function EditorRegla({ borrador, pipes, conexiones, onCancelar, onGuardar, onConexionCreada }: {
  borrador: Borrador; pipes: Pipe[]; conexiones: Conexion[];
  onCancelar: () => void; onGuardar: (cuerpo: any) => Promise<void>; onConexionCreada: (c: Conexion) => void;
}) {
  const [b, setB] = useState<Borrador>(borrador);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [intento, setIntento] = useState(false);
  const meta = ACCIONES_REGLA.find((a) => a.tipo === b.tipo)!;
  const etapas = pipes.flatMap((p) => p.etapas);
  const ctx = { etapas, conexiones };

  // Etapas por nombre (la regla busca la etapa por su "slug" en el pipeline donde esté el lead).
  const porSlug = useMemo(() => {
    const m = new Map<string, { nombre: string; pipes: string[] }>();
    for (const p of pipes) for (const e of p.etapas) {
      const x = m.get(e.slug) ?? { nombre: e.nombre, pipes: [] };
      x.pipes.push(p.nombre); m.set(e.slug, x);
    }
    return [...m.entries()];
  }, [pipes]);

  const faltaValor = meta.campo === 'conexion' ? !b.suscripcion_id && !urlValida(b.url) : !!meta.campo && !b.valor.trim();
  const minimoMal = b.evento === 'venta' && b.minimo !== '' && !(Number(String(b.minimo).replace(',', '.')) > 0);

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    setIntento(true);
    if (faltaValor || minimoMal) return;
    setGuardando(true); setError(null);
    try { await onGuardar(deBorrador(b, ctx)); } catch (err: any) { setError(err.message); } finally { setGuardando(false); }
  }

  const etiquetaValor = meta.campo === 'etiqueta' ? 'Etiqueta' : meta.campo === 'texto' ? 'Texto de la nota' : meta.campo === 'motivo' ? 'Motivo' : '';

  return (
    <form onSubmit={guardar} className="tarjeta mb-2 space-y-3 p-3" style={{ borderColor: 'var(--series-1)' }}>
      <div className="text-[13px] font-semibold">{b.id ? 'Editar regla' : 'Nueva regla'}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Cuando el lead…">
          <Seleccion value={b.evento} onChange={(e) => setB({ ...b, evento: e.target.value })}>
            {EVENTOS.map((ev) => <option key={ev.id} value={ev.id}>{ev.lead}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Hacé esto">
          <Seleccion value={b.tipo} onChange={(e) => setB({ ...b, tipo: e.target.value, valor: '' })}>
            {ACCIONES_REGLA.map((a) => <option key={a.tipo} value={a.tipo}>{a.etiqueta}</option>)}
          </Seleccion>
        </Campo>
      </div>
      {b.evento === 'venta' && (
        <Campo etiqueta="Solo si la venta es de más de… (opcional)" error={intento && minimoMal ? 'Poné un monto mayor que cero, o dejalo vacío' : undefined}>
          <Entrada value={b.minimo} onChange={(e) => setB({ ...b, minimo: e.target.value })} inputMode="decimal" placeholder="ej. 1000" className="sm:!w-48" />
        </Campo>
      )}
      {meta.campo === 'etapa_slug' ? (
        <Campo etiqueta="¿A qué etapa?" ayuda="Se aplica en el pipeline donde esté el lead. Si ese pipeline no tiene esa etapa, no hace nada."
          error={intento && faltaValor ? 'Elegí la etapa' : undefined}>
          <Seleccion value={b.valor} onChange={(e) => setB({ ...b, valor: e.target.value })} aria-invalid={(intento && faltaValor) || undefined}>
            <option value="">Elegí la etapa…</option>
            {porSlug.map(([slug, x]) => (
              <option key={slug} value={slug}>{x.nombre}{pipes.length > 1 ? ` (${x.pipes.length === pipes.length ? 'en todos' : x.pipes.join(', ')})` : ''}</option>
            ))}
          </Seleccion>
        </Campo>
      ) : meta.campo === 'conexion' ? (
        <SelectorConexion valor={b.suscripcion_id} url={b.url} conexiones={conexiones} invalido={intento && faltaValor}
          onElegir={(id) => setB({ ...b, suscripcion_id: id, ...(id ? { url: '' } : {}) })}
          onUrl={(u) => setB({ ...b, url: u })} onConexionCreada={onConexionCreada} />
      ) : meta.campo ? (
        <Campo etiqueta={etiquetaValor} error={intento && faltaValor ? `Escribí ${etiquetaValor.toLowerCase()}` : undefined}>
          <Entrada value={b.valor} onChange={(e) => setB({ ...b, valor: e.target.value })} placeholder={meta.ph} invalido={intento && faltaValor}
            list={meta.campo === 'etiqueta' ? 'etiquetas-config' : undefined} />
        </Campo>
      ) : null}
      {(b.otrasCondiciones.length > 0 || b.otrasAcciones.length > 0) && (
        <p className="text-[12px] text-[var(--text-muted)]">
          Esta regla además {b.otrasCondiciones.length ? `pide que ${b.otrasCondiciones.map(describirCondicion).join(' y ')}` : ''}
          {b.otrasCondiciones.length && b.otrasAcciones.length ? ' y ' : ''}
          {b.otrasAcciones.length ? `después va a ${b.otrasAcciones.map((a) => describirAccionRegla(a, ctx)).join(' y ')}` : ''}: se mantiene igual.
        </p>
      )}
      {error && <p className="text-[12px]" style={{ color: 'var(--status-critical)' }}>{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Boton type="button" variante="fantasma" onClick={onCancelar}>Cancelar</Boton>
        <Boton type="submit" variante="primario" cargando={guardando}>{b.id ? 'Guardar cambios' : 'Crear regla'}</Boton>
      </div>
    </form>
  );
}
