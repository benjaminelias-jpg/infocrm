import { useEffect, useRef, useState } from 'react';
import { api, fmtNum } from '../api';
import {
  AreaTexto, BotonConfirmar, BotonIcono, Boton, Campo, Dialogo, Entrada, Interruptor, ItemMenu, Menu, SeparadorMenu, TituloSeccion, useAviso,
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

export type TipoNuevo = 'audio' | 'texto' | 'link' | 'archivo' | 'secuencia';

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
  if (r.tipo === 'secuencia') return resumenSecuencia(r, leerRecursos());
  if (r.tipo === 'link') return `${r.es_agenda || esUrlAgenda(r.url) ? '📅 Agenda · ' : ''}${urlCorta(r.url)}`;
  if (r.tipo === 'audio') return 'Nota de voz';
  return r.tipo === 'pdf' ? 'PDF' : r.tipo === 'imagen' ? 'Imagen' : 'Video';
}

// ---------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------

const URL_AGENDA = /calendly\.com|(^|\/\/|\.)cal\.com\/|tidycal\.com|zcal\.co|savvycal\.com|calendar\.app\.google|calendar\.google\.com\/calendar\/appointments|meetings\.hubspot\.com|koalendar\.com|youcanbook\.me|acuityscheduling\.com|setmore\.com/i;
export const esUrlAgenda = (u?: string | null) => URL_AGENDA.test(u ?? '');

function fmtEspera(seg: number) {
  if (!seg) return 'al toque';
  if (seg < 60) return `${seg} s`;
  if (seg % 3600 === 0) return `${seg / 3600} h`;
  return `${Math.round(seg / 60)} min`;
}

function resumenSecuencia(r: Recurso, todos: Recurso[]) {
  const pasos = r.pasos ?? [];
  const porId = new Map(todos.map((x) => [x.id, x]));
  const nombres = pasos.map((p) => porId.get(p.recurso_id)?.nombre ?? '(borrado)');
  const esperas = pasos.slice(1).map((p) => p.espera_seg);
  const igual = esperas.length && esperas.every((e) => e === esperas[0]);
  return `${pasos.length} atajos${igual ? `, uno cada ${fmtEspera(esperas[0])}` : ''} · ${nombres.join(' → ')}`;
}

/** Crear o editar una secuencia: atajos en orden con la espera antes de cada uno. */
function FormSecuencia({ inicial, onListo, onCancelar }: {
  inicial?: Recurso; onListo: (texto: string) => void; onCancelar: () => void;
}) {
  const { recursos } = useAtajosDatos();
  const elegibles = recursos.filter((r) => r.tipo !== 'secuencia' && r.id !== inicial?.id);
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [pasos, setPasos] = useState<Array<{ recurso_id: string; min: string }>>(
    inicial?.pasos?.length
      ? inicial.pasos.map((p) => ({ recurso_id: p.recurso_id, min: String(Math.round((p.espera_seg ?? 0) / 60 * 10) / 10) }))
      : [{ recurso_id: '', min: '0' }, { recurso_id: '', min: '2' }]);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cambiar = (i: number, x: Partial<{ recurso_id: string; min: string }>) => setPasos((ps) => ps.map((p, j) => (j === i ? { ...p, ...x } : p)));

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    const n = nombre.trim();
    const validos = pasos.filter((p) => p.recurso_id);
    if (!n) { setError('Ponele un nombre (ej. Secuencia A).'); return; }
    if (validos.length < 2) { setError('Elegí al menos 2 atajos.'); return; }
    const cuerpo = {
      nombre: n, tipo: 'secuencia',
      pasos: validos.map((p, i) => ({ recurso_id: p.recurso_id, espera_seg: i === 0 ? 0 : Math.max(0, Math.round(Number(p.min.replace(',', '.')) * 60) || 0) })),
    };
    setOcupado(true); setError(null);
    try {
      if (inicial) await api(`/recursos/${inicial.id}`, { method: 'PATCH', json: { nombre: n, pasos: cuerpo.pasos } });
      else await api('/recursos', { method: 'POST', json: cuerpo });
      await recargarRecursos();
      onListo(inicial ? `Secuencia «${n}» actualizada.` : `Secuencia «${n}» creada: aparece en los atajos del Chat.`);
    } catch (err: any) { setError(err.message); } finally { setOcupado(false); }
  }

  return (
    <form onSubmit={guardar} className="tarjeta mb-2 space-y-3 p-3">
      <Campo etiqueta="Nombre" htmlFor="sec-nombre">
        <Entrada id="sec-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej. Secuencia A" maxLength={80} autoFocus={!inicial} />
      </Campo>
      <div className="space-y-2">
        {pasos.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <span className="w-5 text-center text-[12px] text-[var(--text-muted)]">{i + 1}</span>
            <select value={p.recurso_id} onChange={(e) => cambiar(i, { recurso_id: e.target.value })} aria-label={`Atajo ${i + 1}`}
              className="ui-control ui-foco h-9 min-w-0 flex-1 rounded-md px-2 text-[13px]">
              <option value="">Elegí un atajo…</option>
              {elegibles.map((r) => <option key={r.id} value={r.id}>{ICONO_RECURSO[r.tipo] ?? '📎'} {r.nombre}</option>)}
            </select>
            {i > 0 ? (
              <label className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)]">
                después de
                <Entrada value={p.min} onChange={(e) => cambiar(i, { min: e.target.value })} inputMode="decimal" className="!w-16" aria-label={`Minutos antes del atajo ${i + 1}`} />
                min
              </label>
            ) : <span className="text-[12px] text-[var(--text-muted)]">sale al toque</span>}
            {pasos.length > 2 && (
              <BotonIcono etiqueta={`Quitar el atajo ${i + 1}`} tamano="sm" onClick={() => setPasos((ps) => ps.filter((_, j) => j !== i))}>
                <Icono nombre="cerrar" tam={14} />
              </BotonIcono>
            )}
          </div>
        ))}
        {pasos.length < 10 && (
          <Boton type="button" tamano="sm" variante="secundario" onClick={() => setPasos((ps) => [...ps, { recurso_id: '', min: ps[ps.length - 1]?.min ?? '2' }])}>
            + Agregar otro atajo
          </Boton>
        )}
      </div>
      <p className="text-[12px] text-[var(--text-muted)]">
        El primero sale al tocar la secuencia en el Chat; los demás salen solos con esa espera (se pueden cancelar desde la conversación).
        Instagram solo deja escribir dentro de las 24 h desde el último mensaje del lead.
      </p>
      {error && <p className="text-[12px]" style={{ color: 'var(--status-critical)' }}>{error}</p>}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="fantasma" tamano="sm" onClick={onCancelar}>Cancelar</Boton>
        <Boton type="submit" variante="primario" tamano="sm" cargando={ocupado}>Guardar</Boton>
      </div>
    </form>
  );
}

function FormNuevo({ tipo, onListo, onCancelar, onCambiarTipo }: {
  tipo: TipoNuevo; onListo: (texto: string) => void; onCancelar: () => void; onCambiarTipo: (t: TipoNuevo) => void;
}) {
  if (tipo === 'secuencia') return <FormSecuencia onListo={onListo} onCancelar={onCancelar} />;
  return <FormNuevoSimple tipo={tipo} onListo={onListo} onCancelar={onCancelar} onCambiarTipo={onCambiarTipo} />;
}

function FormNuevoSimple({ tipo, onListo, onCancelar, onCambiarTipo }: {
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

  const titulo = { audio: 'Nuevo audio del founder', texto: 'Nueva respuesta rápida', link: 'Nuevo enlace', archivo: 'Subir un archivo', secuencia: 'Nueva secuencia' }[tipo];
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
  const [agenda, setAgenda] = useState(Boolean(r.es_agenda));
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
      const cambioAgenda = r.tipo === 'link' && agenda !== Boolean(r.es_agenda);
      if (!Object.keys(cuerpo).length && !cambioAgenda) { onCerrar(); return; }
      if (cambioAgenda) await api(`/recursos/${r.id}`, { method: 'PATCH', json: { es_agenda: agenda } });
      if (Object.keys(cuerpo).length) await api(`/ux/chat/recursos/${r.id}`, { method: 'PATCH', json: cuerpo });
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
          <>
            <Campo etiqueta="Enlace" htmlFor="editar-url">
              <Entrada id="editar-url" value={valor} onChange={(e) => setValor(e.target.value)} inputMode="url" />
            </Campo>
            {esUrlAgenda(valor) ? (
              <p className="text-[12px] text-[var(--text-muted)]">📅 Es un link de agenda: al mandarlo, el lead queda en rojo con «Calendario enviado» hasta que agenda.</p>
            ) : (
              <Interruptor activo={agenda} onCambiar={setAgenda}
                etiqueta="Es mi link de agenda (al mandarlo, el lead queda en rojo con «Calendario enviado» hasta que agenda)" />
            )}
          </>
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

  const formDeGrupo = (g: GrupoId): TipoNuevo[] => (g === 'audio' ? ['audio'] : g === 'secuencias' ? ['secuencia'] : g === 'texto' ? ['texto'] : ['link', 'archivo']);

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
      {editando && editando.tipo === 'secuencia' ? (
        <Dialogo abierto titulo="Editar secuencia" onCerrar={() => setEditando(null)}>
          <FormSecuencia inicial={editando} onCancelar={() => setEditando(null)} onListo={(t) => { setEditando(null); aviso.exito(t); }} />
        </Dialogo>
      ) : editando && <EditarAtajo r={editando} onCerrar={() => setEditando(null)} onBorrar={borrar} />}
    </div>
  );
}
