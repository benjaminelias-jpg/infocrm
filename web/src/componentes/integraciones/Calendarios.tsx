import { useEffect, useState } from 'react';
import { api, fmtFecha } from '../../api';
import { Boton, BotonConfirmar, Campo, Entrada, Esqueleto, Seleccion, useAviso } from '../../ui';

// Calendario propio del CRM: el lead agenda desde un link (personal si sale
// de la pizarra con «📅 Mandar calendario») y queda en verde «Reunión
// agendada» solo. Se puede clonar un evento de Calendly pegando su link.

type Cal = {
  id: string; nombre: string; slug: string; url: string; feed_url: string; descripcion: string | null;
  duracion_min: number; intervalo_min: number; zona_horaria: string; horario: Record<string, Array<[string, string]>>;
  antelacion_min: number; dias_max: number; fecha_fin: string | null; buffer_antes: number; buffer_despues: number;
  max_por_dia: number | null; preguntas: Array<{ nombre: string; obligatoria?: boolean }>; ubicacion: string | null;
  ics_ocupado: string | null; activo: boolean; proximas?: number; origen?: any;
};

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const ZONAS = ['Europe/Madrid', 'America/Argentina/Buenos_Aires', 'America/Mexico_City', 'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Montevideo', 'America/New_York', 'America/Los_Angeles', 'UTC'];
const NUEVO: Partial<Cal> = {
  nombre: 'Llamada de diagnóstico', duracion_min: 30, intervalo_min: 30, zona_horaria: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid',
  horario: { 1: [['09:00', '18:00']], 2: [['09:00', '18:00']], 3: [['09:00', '18:00']], 4: [['09:00', '18:00']], 5: [['09:00', '18:00']] } as any,
  antelacion_min: 60, dias_max: 60, buffer_antes: 0, buffer_despues: 0, preguntas: [], descripcion: '', ubicacion: '',
};

export default function Calendarios() {
  const aviso = useAviso();
  const [lista, setLista] = useState<Cal[] | null>(null);
  const [editando, setEditando] = useState<Partial<Cal> | null>(null);
  const [link, setLink] = useState('');
  const [importando, setImportando] = useState(false);

  const cargar = () => api<{ calendarios: Cal[] }>('/calendarios').then((r) => setLista(r.calendarios)).catch(() => setLista([]));
  useEffect(() => { cargar(); }, []);

  async function importar() {
    setImportando(true);
    try {
      const datos = await api<Partial<Cal>>('/calendarios/importar', { method: 'POST', json: { url: link } });
      setEditando({ ...NUEVO, ...datos, horario: datos.horario ?? NUEVO.horario });
      aviso.exito('Listo: copiamos tu evento de Calendly. Revisalo y guardá.');
    } catch (e: any) { aviso.error(e?.message ?? 'No pudimos leer ese link.'); } finally { setImportando(false); }
  }

  if (editando) return <Editor cal={editando} onCerrar={() => { setEditando(null); cargar(); }} />;
  if (!lista) return <Esqueleto className="h-40" />;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[15px] font-semibold">📅 Tu calendario</h2>
        <p className="text-[13px] text-[var(--text-muted)]">
          Tu propia página para agendar, dentro del CRM. En la pizarra, «📅 Mandar calendario» le manda a cada lead un link personal:
          al mandarlo queda en rojo «Calendario enviado» y, si agenda, pasa solo a verde «Reunión agendada».
        </p>
      </div>

      <div className="rounded-[10px] border border-[var(--border)] p-3 space-y-2">
        <div className="text-[13px] font-semibold">Clonar desde Calendly</div>
        <p className="text-[12px] text-[var(--text-muted)]">Pegá el link de tu evento y copiamos nombre, duración, horarios por día, intervalo, zona horaria, preguntas y hasta cuándo se puede agendar.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Entrada value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://calendly.com/tu-usuario/30min" aria-label="Link de Calendly" />
          <Boton variante="primario" onClick={importar} cargando={importando} disabled={!/calendly\.com\/[^/]+\/[^/]+/i.test(link)}>Clonar</Boton>
        </div>
      </div>

      {lista.map((c) => (
        <div key={c.id} className="rounded-[10px] border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-semibold">{c.nombre} {!c.activo && <span className="text-[12px] text-[var(--text-muted)]">(pausado)</span>}</div>
              <div className="text-[12px] text-[var(--text-muted)]">{c.duracion_min} min · {c.zona_horaria} · {c.proximas ?? 0} próximas</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Boton tamano="sm" onClick={() => { navigator.clipboard?.writeText(c.url); aviso.exito('Link copiado'); }}>Copiar link</Boton>
              <Boton tamano="sm" onClick={() => window.open(c.url, '_blank')}>Ver página</Boton>
              <Boton tamano="sm" variante="primario" onClick={() => setEditando(c)}>Editar</Boton>
            </div>
          </div>
          <Reservas id={c.id} />
        </div>
      ))}
      <Boton onClick={() => setEditando(NUEVO)}>+ Crear calendario desde cero</Boton>
    </div>
  );
}

function Reservas({ id }: { id: string }) {
  const [rs, setRs] = useState<any[] | null>(null);
  useEffect(() => { api<{ reservas: any[] }>(`/calendarios/${id}/reservas`).then((r) => setRs(r.reservas)).catch(() => setRs([])); }, [id]);
  const prox = (rs ?? []).filter((r) => r.estado === 'confirmada' && new Date(r.fin) > new Date()).slice(0, 5);
  if (!prox.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-[12px]">
      {prox.map((r) => (
        <li key={r.id}>📅 {fmtFecha(r.inicio)} {new Date(r.inicio).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · <b>{r.nombre}</b>{r.ig_username ? ` (@${r.ig_username})` : ''}</li>
      ))}
    </ul>
  );
}

function Editor({ cal, onCerrar }: { cal: Partial<Cal>; onCerrar: () => void }) {
  const aviso = useAviso();
  const [c, setC] = useState<Partial<Cal>>(cal);
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof Cal, v: any) => setC((x) => ({ ...x, [k]: v }));
  const horario = (c.horario ?? {}) as Record<string, Array<[string, string]>>;
  const setDia = (d: number, tramos: Array<[string, string]>) => {
    const h = { ...horario }; if (tramos.length) h[String(d)] = tramos; else delete h[String(d)]; set('horario', h);
  };
  const num = (v: string) => (v === '' ? 0 : Math.max(0, Math.round(Number(v))));

  async function guardar() {
    setGuardando(true);
    try {
      const cuerpo = {
        nombre: c.nombre, descripcion: c.descripcion || null, duracion_min: c.duracion_min, intervalo_min: c.intervalo_min, zona_horaria: c.zona_horaria,
        horario: c.horario, antelacion_min: c.antelacion_min, dias_max: c.dias_max, fecha_fin: c.fecha_fin || null,
        buffer_antes: c.buffer_antes, buffer_despues: c.buffer_despues, max_por_dia: c.max_por_dia || null,
        preguntas: (c.preguntas ?? []).filter((p) => p.nombre.trim()), ubicacion: c.ubicacion || null, ics_ocupado: c.ics_ocupado || null,
        activo: c.activo ?? true, ...(c.id ? {} : { origen: c.origen ?? null }),
      };
      if (c.id) await api(`/calendarios/${c.id}`, { method: 'PATCH', json: cuerpo });
      else await api('/calendarios', { method: 'POST', json: cuerpo });
      aviso.exito('Calendario guardado.');
      onCerrar();
    } catch (e: any) { aviso.error(e?.message ?? 'No se pudo guardar.'); } finally { setGuardando(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{c.id ? 'Editar calendario' : 'Nuevo calendario'}</h2>
        <Boton tamano="sm" variante="fantasma" onClick={onCerrar}>← Volver</Boton>
      </div>
      {c.origen?.calendly && <p className="text-[12px] text-[var(--text-muted)]">Clonado de {c.origen.calendly}. Calendly no comparte los márgenes entre reuniones: ajustalos abajo si los usabas.</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre"><Entrada value={c.nombre ?? ''} onChange={(e) => set('nombre', e.target.value)} /></Campo>
        <Campo etiqueta="Zona horaria">
          <Seleccion value={c.zona_horaria} onChange={(e) => set('zona_horaria', e.target.value)}>
            {[...new Set([c.zona_horaria!, ...ZONAS])].map((z) => <option key={z} value={z}>{z}</option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Duración (minutos)"><Entrada type="number" value={c.duracion_min ?? 30} onChange={(e) => set('duracion_min', num(e.target.value))} /></Campo>
        <Campo etiqueta="Un horario cada (minutos)"><Entrada type="number" value={c.intervalo_min ?? 30} onChange={(e) => set('intervalo_min', num(e.target.value))} /></Campo>
        <Campo etiqueta="Aviso mínimo (minutos antes)"><Entrada type="number" value={c.antelacion_min ?? 60} onChange={(e) => set('antelacion_min', num(e.target.value))} /></Campo>
        <Campo etiqueta="Se puede agendar hasta (días adelante)"><Entrada type="number" value={c.dias_max ?? 60} onChange={(e) => set('dias_max', num(e.target.value))} /></Campo>
        <Campo etiqueta="Margen antes (min)"><Entrada type="number" value={c.buffer_antes ?? 0} onChange={(e) => set('buffer_antes', num(e.target.value))} /></Campo>
        <Campo etiqueta="Margen después (min)"><Entrada type="number" value={c.buffer_despues ?? 0} onChange={(e) => set('buffer_despues', num(e.target.value))} /></Campo>
        <Campo etiqueta="Máximo de reuniones por día (opcional)"><Entrada type="number" value={c.max_por_dia ?? ''} onChange={(e) => set('max_por_dia', e.target.value === '' ? null : num(e.target.value))} /></Campo>
        <Campo etiqueta="O hasta una fecha fija (opcional)"><Entrada type="date" value={c.fecha_fin ?? ''} onChange={(e) => set('fecha_fin', e.target.value || null)} /></Campo>
        <Campo etiqueta="Dónde (Zoom, Meet… opcional)"><Entrada value={c.ubicacion ?? ''} onChange={(e) => set('ubicacion', e.target.value)} placeholder="https://meet.google.com/…" /></Campo>
      </div>
      <Campo etiqueta="Descripción (opcional)"><Entrada value={c.descripcion ?? ''} onChange={(e) => set('descripcion', e.target.value)} /></Campo>

      <div className="space-y-2">
        <div className="text-[13px] font-semibold">Horario por día</div>
        {[1, 2, 3, 4, 5, 6, 0].map((d) => {
          const tramos = horario[String(d)] ?? [];
          return (
            <div key={d} className="flex flex-wrap items-center gap-2 text-[13px]">
              <label className="flex w-16 items-center gap-1">
                <input type="checkbox" checked={tramos.length > 0} onChange={(e) => setDia(d, e.target.checked ? [['09:00', '18:00']] : [])} /> {DIAS[d]}
              </label>
              {tramos.map((t, i) => (
                <span key={i} className="flex items-center gap-1">
                  <Entrada type="time" className="!w-28" value={t[0]} onChange={(e) => setDia(d, tramos.map((x, j) => (j === i ? [e.target.value, x[1]] : x)) as any)} aria-label="Desde" />–
                  <Entrada type="time" className="!w-28" value={t[1]} onChange={(e) => setDia(d, tramos.map((x, j) => (j === i ? [x[0], e.target.value] : x)) as any)} aria-label="Hasta" />
                  {tramos.length > 1 && <Boton tamano="xs" variante="fantasma" onClick={() => setDia(d, tramos.filter((_, j) => j !== i))} aria-label="Quitar tramo">✕</Boton>}
                </span>
              ))}
              {tramos.length > 0 && <Boton tamano="xs" variante="fantasma" onClick={() => setDia(d, [...tramos, ['15:00', '18:00']])}>+ tramo</Boton>}
              {!tramos.length && <span className="text-[var(--text-muted)]">No disponible</span>}
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="text-[13px] font-semibold">Preguntas del formulario</div>
        <p className="text-[12px] text-[var(--text-muted)]">Nombre, email y usuario de Instagram ya se piden siempre.</p>
        {(c.preguntas ?? []).map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <Entrada value={p.nombre} onChange={(e) => set('preguntas', c.preguntas!.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} aria-label="Pregunta" />
            <label className="flex shrink-0 items-center gap-1 text-[12px]"><input type="checkbox" checked={!!p.obligatoria} onChange={(e) => set('preguntas', c.preguntas!.map((x, j) => (j === i ? { ...x, obligatoria: e.target.checked } : x)))} /> Obligatoria</label>
            <Boton tamano="xs" variante="fantasma" onClick={() => set('preguntas', c.preguntas!.filter((_, j) => j !== i))} aria-label="Borrar pregunta">✕</Boton>
          </div>
        ))}
        <Boton tamano="sm" onClick={() => set('preguntas', [...(c.preguntas ?? []), { nombre: '', obligatoria: false }])}>+ Pregunta</Boton>
      </div>

      <div className="space-y-2 rounded-[10px] border border-[var(--border)] p-3">
        <div className="text-[13px] font-semibold">Tu Google Calendar / Outlook</div>
        <Campo etiqueta="No pisar lo que ya tengo (dirección secreta iCal)" ayuda="Google Calendar → Configuración → tu calendario → «Dirección secreta en formato iCal». Los horarios ocupados ahí no se ofrecen.">
          <Entrada value={c.ics_ocupado ?? ''} onChange={(e) => set('ics_ocupado', e.target.value)} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
        </Campo>
        {c.feed_url && (
          <p className="text-[12px] text-[var(--text-muted)]">
            Para ver las reuniones del CRM en tu calendario: en Google Calendar → «Otros calendarios» → «+» → «Desde URL», pegá
            <code className="mx-1 break-all">{c.feed_url}</code>
            <Boton tamano="xs" variante="fantasma" onClick={() => { navigator.clipboard?.writeText(c.feed_url!); aviso.exito('Copiado'); }}>Copiar</Boton>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={c.activo ?? true} onChange={(e) => set('activo', e.target.checked)} /> Activo (se puede agendar)</label>
        <div className="flex gap-2">
          {c.id && <BotonConfirmar tamano="sm" variante="fantasma" confirmar="¿Borrar? Tocá de nuevo" onConfirmar={async () => { await api(`/calendarios/${c.id}`, { method: 'DELETE' }); onCerrar(); }}>Borrar</BotonConfirmar>}
          <Boton variante="primario" onClick={guardar} cargando={guardando}>Guardar</Boton>
        </div>
      </div>
    </div>
  );
}
