import { useEffect, useRef, useState } from 'react';
import { api, fmtNum } from '../api';
import {
  AreaTexto, BotonConfirmar, BotonIcono, Boton, Campo, Dialogo, Entrada, ItemMenu, Menu, SeparadorMenu, TituloSeccion, useAviso,
} from '../ui';
import Icono from './Iconos';
import { fijarRecursos, leerRecursos, recargarRecursos, useAtajosDatos } from './chat/datos';
import { Grabador } from './chat/Grabador';
import { IconoChat } from './chat/iconos';
import { ListaOrdenable } from './chat/ListaOrdenable';
import { aBase64, aWav, GRUPOS, grupoDe, ICONO_RECURSO, LIMITE_BYTES, urlCorta, type GrupoId } from './chat/recursos';
import type { Recurso } from './chat/tipos';

// Biblioteca de atajos del Chat: audios del founder, respuestas rápidas,
// enlaces y archivos. Vive dentro del Chat (no es una pestaña): cada grupo
// tiene su "+" para crear ahí mismo, cada atajo se edita tocándolo (nombre y
// contenido), se ordena arrastrando del asa y se borra con "Deshacer".

export { ICONO_RECURSO };

export type TipoNuevo = 'audio' | 'texto' | 'link' | 'archivo';

const RAPIDAS_SUGERIDAS = [
  ['Saludo', '¡Hola {{nombre}}! 👋 Gracias por escribir. ¿Qué te gustaría lograr?'],
  ['Te paso la info', 'Te paso la info 👇'],
  ['Proponer llamada', '¿Te viene bien una llamada corta para contarte cómo funciona?'],
  ['Pedir horario', '¿Qué día y hora te queda cómodo?'],
  ['Antes del link', '¡Genial! Te mando el link de pago 🙌'],
];

const ACEPTA_ARCHIVO = 'image/*,video/*,application/pdf';

/** Tipo del atajo según el archivo (null si Instagram no lo acepta). */
function tipoDeArchivo(mime: string): Recurso['tipo'] | null {
  if (mime.startsWith('audio')) return 'audio';
  if (mime.startsWith('image')) return 'imagen';
  if (mime.startsWith('video')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  return null;
}

/** Prepara un archivo para subirlo (los audios que Instagram no acepta pasan a WAV). */
async function prepararArchivo(f: File): Promise<{ tipo: Recurso['tipo']; mime: string; base64: string }> {
  let mime = f.type || 'application/octet-stream';
  const tipo = tipoDeArchivo(mime);
  if (!tipo) throw new Error('Ese archivo no se puede mandar por Instagram. Usá audio, imagen, video o PDF.');
  let blob: Blob = f;
  if (tipo === 'audio' && !/(aac|m4a|mp4|wav|x-wav)/.test(mime)) { blob = await aWav(f); mime = 'audio/wav'; }
  if (blob.size > LIMITE_BYTES) throw new Error('El archivo pasa de ~3 MB. Usá uno más liviano o pegá un enlace.');
  return { tipo, mime, base64: await aBase64(blob) };
}

// Borrados con "Deshacer": el atajo desaparece ya y se borra de verdad a los 6 s.
const borrados = new Map<string, number>();

function segundaLinea(r: Recurso) {
  if (r.tipo === 'texto') return r.texto ?? '';
  if (r.tipo === 'link') return urlCorta(r.url);
  if (r.tipo === 'audio') return 'Nota de voz';
  return r.tipo === 'pdf' ? 'PDF' : r.tipo === 'imagen' ? 'Imagen' : 'Video';
}

// ---------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------

function FormNuevo({ tipo, onListo, onCancelar, onCambiarTipo }: {
  tipo: TipoNuevo; onListo: (texto: string) => void; onCancelar: () => void; onCambiarTipo: (t: TipoNuevo) => void;
}) {
  const aviso = useAviso();
  const [nombre, setNombre] = useState('');
  const [valor, setValor] = useState('');
  const [audio, setAudio] = useState<Blob | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => { caja.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, []);

  async function crear(cuerpo: Record<string, unknown>, ok: string) {
    setOcupado(true);
    setError(null);
    try {
      await api('/recursos', { method: 'POST', json: cuerpo });
      await recargarRecursos();
      onListo(ok);
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  }

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    const n = nombre.trim();
    if (tipo === 'audio') {
      if (!audio && !archivo) { setError('Grabá el audio o subí un archivo.'); return; }
      if (!n) { setError('Ponele un nombre (ej. «Bienvenida»).'); return; }
      try {
        if (audio) {
          await crear({ nombre: n, tipo: 'audio', mime: 'audio/wav', archivo_base64: await aBase64(audio) }, `Audio «${n}» guardado. Ya aparece en los atajos del chat.`);
        } else if (archivo) {
          const p = await prepararArchivo(archivo);
          if (p.tipo !== 'audio') { setError('Elegí un archivo de audio.'); return; }
          await crear({ nombre: n, tipo: 'audio', mime: p.mime, archivo_base64: p.base64 }, `Audio «${n}» guardado.`);
        }
      } catch (err: any) { setError(err.message); }
      return;
    }
    if (tipo === 'archivo') {
      if (!archivo) { setError('Elegí un archivo (PDF, imagen o video).'); return; }
      try {
        setOcupado(true);
        const p = await prepararArchivo(archivo);
        const nom = n || archivo.name.replace(/\.[^.]+$/, '');
        await crear({ nombre: nom, tipo: p.tipo, mime: p.mime, archivo_base64: p.base64 }, `«${nom}» subido. Ya aparece en los atajos del chat.`);
      } catch (err: any) { setError(err.message); setOcupado(false); }
      return;
    }
    if (!n || !valor.trim()) { setError('Completá el nombre y el contenido.'); return; }
    if (tipo === 'link') {
      if (!/^https?:\/\/\S+\.\S+/i.test(valor.trim())) { setError('El enlace tiene que empezar con https://'); return; }
      await crear({ nombre: n, tipo: 'link', url: valor.trim() }, `Enlace «${n}» guardado.`);
    } else {
      await crear({ nombre: n, tipo: 'texto', texto: valor.trim() }, `Respuesta rápida «${n}» guardada.`);
    }
  }

  const titulo = { audio: 'Nuevo audio del founder', texto: 'Nueva respuesta rápida', link: 'Nuevo enlace', archivo: 'Subir un archivo' }[tipo];
  return (
    <div ref={caja} className="tarjeta mb-2 space-y-2.5 p-3">
      <div className="text-[13px] font-semibold">{titulo}</div>
      <form onSubmit={guardar} className="space-y-2.5">
        {tipo === 'audio' && (
          <>
            <p className="text-[12px] text-[var(--text-secondary)]">Grabalo una vez: tus setters lo mandan con un toque y le llega al lead como nota de voz.</p>
            <Grabador onListo={(b) => { setAudio(b); setError(null); }} />
            {!audio && (
              <label className="ui-foco inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--series-1)] underline">
                o subí un archivo de audio
                <input type="file" accept="audio/*" className="sr-only" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = ''; }} />
              </label>
            )}
            {archivo && !audio && <p className="text-[12px] text-[var(--text-secondary)]">Archivo: {archivo.name}</p>}
          </>
        )}
        {tipo === 'archivo' && (
          <label className="ui-foco flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[var(--baseline)] px-3 py-3 text-[13px] hover:bg-[var(--page-plane)]">
            <IconoChat nombre="subirArchivo" tam={18} />
            <span className="min-w-0 flex-1 truncate">{archivo ? archivo.name : 'Elegí un PDF, una imagen o un video (hasta ~3 MB)'}</span>
            <input type="file" accept={ACEPTA_ARCHIVO} className="sr-only" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); setError(null); e.target.value = ''; }} />
          </label>
        )}
        <Campo etiqueta="Nombre del atajo" htmlFor="nuevo-nombre">
          <Entrada id="nuevo-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80}
            placeholder={tipo === 'audio' ? 'Ej. Bienvenida' : tipo === 'link' ? 'Ej. Calendario de llamadas' : tipo === 'archivo' ? 'Si lo dejás vacío, usa el del archivo' : 'Ej. Proponer llamada'}
            autoFocus={tipo === 'texto' || tipo === 'link'} />
        </Campo>
        {tipo === 'link' && (
          <Campo etiqueta="Enlace" htmlFor="nuevo-url">
            <Entrada id="nuevo-url" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="https://…" inputMode="url" />
          </Campo>
        )}
        {(tipo === 'link' || tipo === 'archivo') && (
          <button type="button" onClick={() => onCambiarTipo(tipo === 'link' ? 'archivo' : 'link')}
            className="ui-foco text-[12px] text-[var(--series-1)] underline">
            {tipo === 'link' ? 'o subí un archivo (PDF, imagen o video)' : 'o pegá un enlace'}
          </button>
        )}
        {tipo === 'texto' && (
          <Campo etiqueta="Texto" htmlFor="nuevo-texto" ayuda="Se pega en la caja para que lo edites antes de mandar. {{nombre}} se cambia por el nombre del lead.">
            <AreaTexto id="nuevo-texto" value={valor} onChange={(e) => setValor(e.target.value)} rows={3} maxLength={1000} placeholder="¡Hola {{nombre}}! …" />
          </Campo>
        )}
        {error && <p role="alert" className="text-[12px]" style={{ color: 'var(--status-critical)' }}>{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <Boton variante="fantasma" tamano="sm" onClick={onCancelar}>Cancelar</Boton>
          <Boton type="submit" variante="primario" tamano="sm" cargando={ocupado}>{ocupado && tipo === 'archivo' ? 'Subiendo…' : 'Guardar'}</Boton>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------

function EditarAtajo({ r, onCerrar, onBorrar }: { r: Recurso; onCerrar: () => void; onBorrar: (r: Recurso) => void }) {
  const aviso = useAviso();
  const [nombre, setNombre] = useState(r.nombre);
  const [valor, setValor] = useState(r.tipo === 'texto' ? r.texto ?? '' : r.tipo === 'link' ? r.url ?? '' : '');
  const [regrabar, setRegrabar] = useState(false);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function guardar() {
    const cuerpo: Record<string, unknown> = {};
    if (nombre.trim() && nombre.trim() !== r.nombre) cuerpo.nombre = nombre.trim();
    if (r.tipo === 'texto' && valor.trim() !== (r.texto ?? '')) cuerpo.texto = valor.trim();
    if (r.tipo === 'link' && valor.trim() !== (r.url ?? '')) {
      if (!/^https?:\/\/\S+\.\S+/i.test(valor.trim())) { setError('El enlace tiene que empezar con https://'); return; }
      cuerpo.url = valor.trim();
    }
    setOcupado(true);
    setError(null);
    try {
      if (audio) { cuerpo.archivo_base64 = await aBase64(audio); cuerpo.mime = 'audio/wav'; }
      else if (archivo) {
        const p = await prepararArchivo(archivo);
        if (p.tipo !== r.tipo) throw new Error(`Elegí un archivo del mismo tipo (${r.tipo === 'pdf' ? 'PDF' : r.tipo}).`);
        cuerpo.archivo_base64 = p.base64; cuerpo.mime = p.mime;
      }
      if (!Object.keys(cuerpo).length) { onCerrar(); return; }
      await api(`/ux/chat/recursos/${r.id}`, { method: 'PATCH', json: cuerpo });
      await recargarRecursos();
      aviso.exito(`«${(cuerpo.nombre as string) ?? r.nombre}» guardado.`);
      onCerrar();
    } catch (e: any) { setError(e.message); } finally { setOcupado(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo="Editar atajo" ancho={480} autoFoco={false}
      descripcion={Number(r.veces_usado) > 0 ? `Se usó ${fmtNum(r.veces_usado)} ${Number(r.veces_usado) === 1 ? 'vez' : 'veces'}. Mantiene su lugar en la lista.` : 'Mantiene su lugar en la lista.'}
      pie={<>
        <span className="mr-auto"><BotonConfirmar onConfirmar={() => { onCerrar(); onBorrar(r); }}>Borrar</BotonConfirmar></span>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={guardar} cargando={ocupado}>Guardar</Boton>
      </>}>
      <div className="space-y-3">
        <Campo etiqueta="Nombre" htmlFor="editar-nombre">
          <Entrada id="editar-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} />
        </Campo>
        {r.tipo === 'texto' && (
          <Campo etiqueta="Texto" htmlFor="editar-texto" ayuda="{{nombre}} se cambia por el nombre del lead.">
            <AreaTexto id="editar-texto" value={valor} onChange={(e) => setValor(e.target.value)} rows={5} maxLength={1000} />
          </Campo>
        )}
        {r.tipo === 'link' && (
          <Campo etiqueta="Enlace" htmlFor="editar-url">
            <Entrada id="editar-url" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="url" />
          </Campo>
        )}
        {r.tipo === 'audio' && (
          <div className="space-y-2">
            <div className="text-[12px] font-medium text-[var(--text-secondary)]">Audio</div>
            {!regrabar ? (
              <>
                {r.url_publica && <audio controls preload="none" src={r.url_publica} className="h-9 w-full" />}
                <Boton tamano="sm" onClick={() => setRegrabar(true)} icono={<span aria-hidden>🎙️</span>}>Volver a grabar</Boton>
              </>
            ) : (
              <Grabador autoEmpezar onListo={setAudio} />
            )}
          </div>
        )}
        {(r.tipo === 'pdf' || r.tipo === 'imagen' || r.tipo === 'video') && (
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            {r.url_publica && <a href={r.url_publica} target="_blank" rel="noreferrer" className="text-[var(--series-1)] underline">Ver el archivo</a>}
            <label className="ui-foco inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-hairline)] px-2.5 py-1.5 hover:bg-[var(--page-plane)]">
              <IconoChat nombre="subirArchivo" tam={14} /> {archivo ? archivo.name : 'Reemplazar archivo'}
              <input type="file" accept={ACEPTA_ARCHIVO} className="sr-only" onChange={(e) => { setArchivo(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            </label>
          </div>
        )}
        {error && <p role="alert" className="text-[12px]" style={{ color: 'var(--status-critical)' }}>{error}</p>}
      </div>
    </Dialogo>
  );
}

// ---------------------------------------------------------------------
// Fila
// ---------------------------------------------------------------------

function FilaRecurso({ r, asa, primero, ultimo, onEditar, onSubir, onBajar, onDuplicar, onBorrar }: {
  r: Recurso; asa: React.ReactNode; primero: boolean; ultimo: boolean;
  onEditar: () => void; onSubir: () => void; onBajar: () => void; onDuplicar: () => void; onBorrar: () => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-[var(--border-hairline)] py-0.5 pl-0.5 pr-1" style={{ background: 'var(--surface-1)' }}>
      {asa}
      <button type="button" onClick={onEditar} className="ui-foco flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-left hover:bg-[var(--page-plane)]">
        <span className="text-[16px]" aria-hidden>{ICONO_RECURSO[r.tipo] ?? '📎'}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{r.nombre}</span>
          <span className="block truncate text-[11px] text-[var(--text-muted)]">{segundaLinea(r)}</span>
        </span>
      </button>
      <Menu alinear="derecha" ancho={230} titulo={r.nombre} disparador={({ alternar, abierto }) => (
        <BotonIcono etiqueta={`Opciones de «${r.nombre}»`} onClick={alternar} aria-expanded={abierto} aria-haspopup="menu">
          <Icono nombre="puntos" tam={18} />
        </BotonIcono>
      )}>
        <ItemMenu icono={<IconoChat nombre="editar" tam={15} />} onClick={onEditar}>Editar</ItemMenu>
        <ItemMenu icono={<IconoChat nombre="subir" tam={15} />} onClick={onSubir} deshabilitado={primero}>Subir al principio</ItemMenu>
        <ItemMenu icono={<IconoChat nombre="bajar" tam={15} />} onClick={onBajar} deshabilitado={ultimo}>Bajar al final</ItemMenu>
        <ItemMenu icono={<IconoChat nombre="duplicar" tam={15} />} onClick={onDuplicar}>Duplicar</ItemMenu>
        <SeparadorMenu />
        <div className="px-1 pb-0.5">
          <BotonConfirmar onConfirmar={onBorrar} className="w-full">Borrar</BotonConfirmar>
        </div>
      </Menu>
    </div>
  );
}

// ---------------------------------------------------------------------
// Panel completo
// ---------------------------------------------------------------------

export default function GestorRecursos({ onCerrar, crear, onCrearVisto }: {
  onCerrar?: () => void;
  /** Abre directamente el formulario para crear ese tipo de atajo. */
  crear?: TipoNuevo | null; onCrearVisto?: () => void;
}) {
  const aviso = useAviso();
  const { recursos, cargados, error, recargar } = useAtajosDatos();
  const [form, setForm] = useState<TipoNuevo | null>(crear ?? null);
  const [editando, setEditando] = useState<Recurso | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { if (crear) { setForm(crear); onCrearVisto?.(); } }, [crear]); // eslint-disable-line react-hooks/exhaustive-deps

  const grupos = GRUPOS.map((g) => ({ ...g, items: recursos.filter((r) => grupoDe(r) === g.id) }));

  async function guardarOrden(nuevo: Recurso[]) {
    const antes = leerRecursos();
    fijarRecursos(nuevo);
    try {
      await api('/recursos/reordenar', { method: 'POST', json: { ids: nuevo.map((r) => r.id) } });
    } catch (e: any) {
      fijarRecursos(antes);
      aviso.error(`No se pudo guardar el orden: ${e.message}`);
    }
  }

  function reordenarGrupo(g: GrupoId, ids: string[]) {
    const porId = new Map(recursos.map((r) => [r.id, r]));
    const nuevo = GRUPOS.flatMap((x) => (x.id === g ? ids.map((id) => porId.get(id)!).filter(Boolean) : recursos.filter((r) => grupoDe(r) === x.id)));
    guardarOrden(nuevo);
  }
  function mover(r: Recurso, aDonde: 'principio' | 'final') {
    const g = grupoDe(r);
    const ids = recursos.filter((x) => grupoDe(x) === g).map((x) => x.id).filter((id) => id !== r.id);
    reordenarGrupo(g, aDonde === 'principio' ? [r.id, ...ids] : [...ids, r.id]);
  }

  async function duplicar(r: Recurso) {
    try {
      await api(`/ux/chat/recursos/${r.id}/duplicar`, { method: 'POST' });
      await recargarRecursos();
      aviso.exito(`Listo: «${r.nombre} (copia)» quedó justo debajo.`);
    } catch (e: any) { aviso.error(e.message); }
  }

  function borrar(r: Recurso) {
    const antes = leerRecursos();
    fijarRecursos(antes.filter((x) => x.id !== r.id));
    const t = window.setTimeout(async () => {
      borrados.delete(r.id);
      try { await api(`/recursos/${r.id}`, { method: 'DELETE' }); } catch (e: any) { aviso.error(e.message); recargarRecursos(); }
    }, 6000);
    borrados.set(r.id, t);
    aviso.exito(`Borraste «${r.nombre}».`, {
      texto: 'Deshacer',
      onClick: () => {
        const x = borrados.get(r.id);
        if (x) window.clearTimeout(x);
        borrados.delete(r.id);
        const ahora = leerRecursos();
        const pos = antes.findIndex((y) => y.id === r.id);
        const copia = [...ahora];
        copia.splice(Math.min(pos, copia.length), 0, r);
        fijarRecursos(copia);
      },
    });
  }

  async function sugeridas() {
    setOcupado(true);
    try {
      for (const [n, t] of [...RAPIDAS_SUGERIDAS].reverse()) {
        await api('/recursos', { method: 'POST', json: { nombre: n, tipo: 'texto', texto: t } });
      }
      await recargarRecursos();
      aviso.exito('Listo: 5 respuestas rápidas creadas. Editalas o borralas cuando quieras.');
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(false); }
  }

  const formDeGrupo = (g: GrupoId): TipoNuevo[] => (g === 'audio' ? ['audio'] : g === 'texto' ? ['texto'] : ['link', 'archivo']);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-2 border-b border-[var(--border-hairline)] px-4 pb-2.5 pt-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">Recursos y atajos</h2>
          <p className="text-[12px] text-[var(--text-muted)]">Salen en el chat en este orden. Arrastrá ⠿ para ordenar.</p>
        </div>
        {onCerrar && (
          <BotonIcono etiqueta="Cerrar" onClick={onCerrar} tamano="md" className="-mr-1.5 shrink-0">
            <Icono nombre="cerrar" tam={18} />
          </BotonIcono>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
        {error && !cargados && (
          <div className="text-center text-[12px]">
            <p className="mb-2 text-[var(--text-muted)]">{error.message}</p>
            <Boton tamano="sm" onClick={recargar}>Reintentar</Boton>
          </div>
        )}
        {grupos.map((g) => {
          const tipos = formDeGrupo(g.id);
          const formAca = form && tipos.includes(form) ? form : null;
          return (
            <section key={g.id} aria-label={g.titulo}>
              <TituloSeccion titulo={<>{g.icono} {g.titulo}</>} textoMas={`Agregar en ${g.titulo}`}
                onMas={() => setForm(formAca ? null : tipos[0])} />
              {formAca && (
                <FormNuevo key={formAca} tipo={formAca} onCancelar={() => setForm(null)} onCambiarTipo={setForm}
                  onListo={(t) => { setForm(null); aviso.exito(t); }} />
              )}
              {!cargados && !error ? (
                <div className="h-12 rounded-xl ui-esqueleto" aria-hidden />
              ) : g.items.length === 0 ? (
                !formAca && (
                  <div className="rounded-xl px-3 py-3 text-[12px] text-[var(--text-muted)]" style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-hairline)' }}>
                    {g.vacio}
                    {g.id === 'texto' && (
                      <div className="mt-2">
                        <Boton tamano="sm" onClick={sugeridas} cargando={ocupado}>Agregar 5 sugeridas</Boton>
                      </div>
                    )}
                  </div>
                )
              ) : (
                <ListaOrdenable items={g.items} clave={(r) => r.id} onReordenar={(ids) => reordenarGrupo(g.id, ids)}
                  render={(r, asa) => {
                    const i = g.items.findIndex((x) => x.id === r.id);
                    return (
                      <FilaRecurso r={r} asa={asa} primero={i === 0} ultimo={i === g.items.length - 1}
                        onEditar={() => setEditando(r)} onSubir={() => mover(r, 'principio')} onBajar={() => mover(r, 'final')}
                        onDuplicar={() => duplicar(r)} onBorrar={() => borrar(r)} />
                    );
                  }} />
              )}
            </section>
          );
        })}
      </div>
      {editando && <EditarAtajo r={editando} onCerrar={() => setEditando(null)} onBorrar={borrar} />}
    </div>
  );
}
