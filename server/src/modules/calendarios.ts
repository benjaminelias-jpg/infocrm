import { pool, query, queryOne } from '../db/pool.js';
import { config } from '../config.js';
import { registrarEvento } from './eventos.js';

// Calendario propio del CRM: el lead agenda desde un link (personal si se lo
// mandó la pizarra) y queda marcado solo, sin depender de Calendly.

export interface Calendario {
  id: string; cuenta_id: string; nombre: string; slug: string; descripcion: string | null;
  duracion_min: number; intervalo_min: number; zona_horaria: string;
  horario: Record<string, Array<[string, string]>>;
  antelacion_min: number; dias_max: number; fecha_fin: string | null;
  buffer_antes: number; buffer_despues: number; max_por_dia: number | null;
  preguntas: Array<{ nombre: string; obligatoria?: boolean }>;
  color: string; ubicacion: string | null; ics_ocupado: string | null; feed_token: string; activo: boolean;
  origen: any;
}

// ---------------------------------------------------------------------
// Zonas horarias sin librerías
// ---------------------------------------------------------------------

/** Minutos que la zona está adelantada respecto de UTC en ese instante. */
export function desfaseMin(instante: number, zona: string): number {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(instante))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((comoUtc - Math.floor(instante / 1000) * 1000) / 60000);
}

/** «2026-12-01» + «09:30» en esa zona → instante UTC (ms). */
export function aInstante(fecha: string, hora: string, zona: string): number {
  const [y, m, d] = fecha.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const base = Date.UTC(y, m - 1, d, hh, mm);
  let t = base - desfaseMin(base, zona) * 60000;
  t = base - desfaseMin(t, zona) * 60000;
  return t;
}

/** Fecha local (YYYY-MM-DD) y día de la semana (0=domingo) de un instante en la zona. */
export function fechaLocal(instante: number, zona: string): { fecha: string; dia: number; hora: string } {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(new Date(instante))) p[x.type] = x.value;
  const dias = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return { fecha: `${p.year}-${p.month}-${p.day}`, dia: dias.indexOf(p.weekday), hora: `${p.hour}:${p.minute}` };
}

function sumarDias(fecha: string, n: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// Ocupado: reservas del CRM + iCal secreto del calendario conectado
// ---------------------------------------------------------------------

type Tramo = { desde: number; hasta: number };
const cacheIcs = new Map<string, { en: number; tramos: Tramo[] }>();

/** Lee un .ics (Google/Outlook/Apple) y devuelve los tramos ocupados (lo básico: DTSTART/DTEND). */
export function parsearIcs(texto: string, zonaPorDefecto: string): Tramo[] {
  const lineas = texto.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const tramos: Tramo[] = [];
  let ev: { ini?: number; fin?: number; libre?: boolean } | null = null;
  const leer = (l: string): number | undefined => {
    const [izq, valor] = [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()];
    const tz = /TZID=([^;:]+)/.exec(izq)?.[1] ?? zonaPorDefecto;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(valor);
    if (!m) return undefined;
    const fecha = `${m[1]}-${m[2]}-${m[3]}`;
    if (!m[4]) return aInstante(fecha, '00:00', tz); // día completo
    if (m[7]) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
    return aInstante(fecha, `${m[4]}:${m[5]}`, tz);
  };
  for (const l of lineas) {
    if (l === 'BEGIN:VEVENT') ev = {};
    else if (l === 'END:VEVENT') {
      if (ev?.ini !== undefined && !ev.libre) tramos.push({ desde: ev.ini, hasta: ev.fin ?? ev.ini + 3600000 });
      ev = null;
    } else if (ev) {
      if (l.startsWith('DTSTART')) ev.ini = leer(l);
      else if (l.startsWith('DTEND')) ev.fin = leer(l);
      else if (l.startsWith('TRANSP:TRANSPARENT')) ev.libre = true;
    }
  }
  return tramos;
}

async function ocupadoExterno(cal: Calendario): Promise<Tramo[]> {
  if (!cal.ics_ocupado) return [];
  const c = cacheIcs.get(cal.ics_ocupado);
  if (c && Date.now() - c.en < 5 * 60000) return c.tramos;
  try {
    const r = await fetch(cal.ics_ocupado.replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return c?.tramos ?? [];
    const tramos = parsearIcs(await r.text(), cal.zona_horaria);
    cacheIcs.set(cal.ics_ocupado, { en: Date.now(), tramos });
    return tramos;
  } catch { return c?.tramos ?? []; }
}

// ---------------------------------------------------------------------
// Huecos libres
// ---------------------------------------------------------------------

export async function huecos(cal: Calendario, desdeFecha: string, dias = 7, ahora = Date.now()) {
  const primerMs = ahora + cal.antelacion_min * 60000;
  const limiteDias = ahora + cal.dias_max * 86400000;
  const limiteFecha = cal.fecha_fin ? aInstante(sumarDias(cal.fecha_fin, 1), '00:00', cal.zona_horaria) : Infinity;
  const ultimo = Math.min(limiteDias, limiteFecha);
  const desdeMs = aInstante(desdeFecha, '00:00', cal.zona_horaria);
  const hastaMs = aInstante(sumarDias(desdeFecha, dias), '00:00', cal.zona_horaria);

  const reservas = await query<{ inicio: Date; fin: Date }>(
    `SELECT inicio, fin FROM reservas WHERE calendario_id = $1 AND estado = 'confirmada' AND fin > $2 AND inicio < $3`,
    [cal.id, new Date(desdeMs - 86400000), new Date(hastaMs + 86400000)]);
  const ocupado: Tramo[] = [
    ...reservas.map((r) => ({ desde: new Date(r.inicio).getTime() - cal.buffer_antes * 60000, hasta: new Date(r.fin).getTime() + cal.buffer_despues * 60000 })),
    ...(await ocupadoExterno(cal)),
  ];
  const porDia = new Map<string, number>();
  for (const r of reservas) { const f = fechaLocal(new Date(r.inicio).getTime(), cal.zona_horaria).fecha; porDia.set(f, (porDia.get(f) ?? 0) + 1); }

  const salida: Array<{ fecha: string; huecos: string[] }> = [];
  for (let i = 0; i < dias; i++) {
    const fecha = sumarDias(desdeFecha, i);
    const dia = new Date(`${fecha}T12:00:00Z`).getUTCDay();
    const lista: string[] = [];
    const lleno = cal.max_por_dia != null && (porDia.get(fecha) ?? 0) >= cal.max_por_dia;
    for (const [a, b] of (cal.horario?.[String(dia)] ?? [])) {
      if (lleno) break;
      const ini = aInstante(fecha, a, cal.zona_horaria);
      const fin = aInstante(fecha, b, cal.zona_horaria);
      for (let t = ini; t + cal.duracion_min * 60000 <= fin; t += cal.intervalo_min * 60000) {
        const tFin = t + cal.duracion_min * 60000;
        if (t < primerMs || t > ultimo) continue;
        const choca = ocupado.some((o) => t - cal.buffer_antes * 60000 < o.hasta && tFin + cal.buffer_despues * 60000 > o.desde);
        if (!choca) lista.push(new Date(t).toISOString());
      }
    }
    salida.push({ fecha, huecos: lista });
  }
  return salida;
}

// ---------------------------------------------------------------------
// Reservar
// ---------------------------------------------------------------------

export class ErrorAgenda extends Error { constructor(public codigo: string, msg: string) { super(msg); } }

export async function calendarioPorSlug(slug: string) {
  return queryOne<Calendario>(`SELECT * FROM calendarios WHERE slug = $1 AND activo`, [slug]);
}

export async function reservar(cal: Calendario, d: {
  inicio: string; nombre: string; email?: string; telefono?: string; ig_username?: string;
  respuestas?: Record<string, string>; invitacion?: string;
}) {
  const t = new Date(d.inicio).getTime();
  if (!Number.isFinite(t)) throw new ErrorAgenda('hueco', 'Elegí un horario.');
  const fecha = fechaLocal(t, cal.zona_horaria).fecha;
  const libres = (await huecos(cal, fecha, 1))[0]?.huecos ?? [];
  if (!libres.includes(new Date(t).toISOString())) throw new ErrorAgenda('ocupado', 'Ese horario ya no está libre. Elegí otro.');

  let leadId: string | undefined;
  if (d.invitacion) {
    const inv = await queryOne<{ lead_id: string | null }>(
      `SELECT lead_id FROM invitaciones_agenda WHERE token = $1 AND calendario_id = $2`, [d.invitacion, cal.id]);
    leadId = inv?.lead_id ?? undefined;
  }
  const ig = d.ig_username?.trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '') || undefined;
  const fin = new Date(t + cal.duracion_min * 60000);
  let reserva: any;
  try {
    reserva = await queryOne(
      `INSERT INTO reservas (cuenta_id, calendario_id, lead_id, inicio, fin, nombre, email, telefono, ig_username, respuestas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [cal.cuenta_id, cal.id, leadId ?? null, new Date(t), fin, d.nombre, d.email?.toLowerCase() || null, d.telefono || null, ig ?? null, JSON.stringify(d.respuestas ?? {})]);
  } catch (e: any) {
    if (e?.code === '23505') throw new ErrorAgenda('ocupado', 'Ese horario se acaba de ocupar. Elegí otro.');
    throw e;
  }
  const [nombre, ...resto] = d.nombre.trim().split(/\s+/);
  const ev = await registrarEvento({
    cuentaId: cal.cuenta_id, tipo: 'reunion_agendada', fuente: 'agenda',
    leadId, identidad: leadId ? undefined : { email: d.email?.toLowerCase() || undefined, igUsername: ig, nombre, apellido: resto.join(' ') || undefined, telefono: d.telefono || undefined },
    titulo: cal.nombre, ocurridoEn: new Date(t), idempotencyKey: `agenda:${reserva.id}`,
    payload: { reserva_id: reserva.id, calendario: cal.nombre, inicio: new Date(t).toISOString(), respuestas: d.respuestas ?? {} },
  });
  await pool.query(`UPDATE reservas SET lead_id = $2 WHERE id = $1`, [reserva.id, ev.leadId]);
  if (d.invitacion) await pool.query(`UPDATE invitaciones_agenda SET usado_en = now() WHERE token = $1`, [d.invitacion]);
  return { ...reserva, lead_id: ev.leadId };
}

export async function cancelarReserva(token: string) {
  const r = await queryOne<any>(`UPDATE reservas SET estado = 'cancelada' WHERE token = $1 AND estado = 'confirmada' RETURNING *`, [token]);
  if (r?.lead_id) {
    await registrarEvento({ cuentaId: r.cuenta_id, tipo: 'reunion_cancelada', fuente: 'agenda', leadId: r.lead_id, idempotencyKey: `agenda:cancel:${r.id}` }).catch(() => {});
    await pool.query(`UPDATE leads SET etiquetas = array_remove(etiquetas, 'Reunión agendada') WHERE id = $1`, [r.lead_id]);
  }
  return r;
}

/** Link personal para un lead: al agendar desde ahí, se sabe quién es sin preguntar. */
export async function linkPersonal(cuentaId: string, calendarioId: string, leadId?: string | null) {
  const cal = await queryOne<Calendario>(`SELECT * FROM calendarios WHERE id = $1 AND cuenta_id = $2`, [calendarioId, cuentaId]);
  if (!cal) return null;
  const inv = await queryOne<{ token: string }>(
    `INSERT INTO invitaciones_agenda (cuenta_id, calendario_id, lead_id) VALUES ($1,$2,$3) RETURNING token`, [cuentaId, calendarioId, leadId ?? null]);
  return `${urlPublica(cal.slug)}?i=${inv!.token}`;
}

export const urlPublica = (slug: string) => `${config.appUrl.replace(/\/$/, '')}/agendar/${slug}`;

/** Feed .ics para suscribirse desde Google Calendar / Apple / Outlook. */
export async function feedIcs(token: string) {
  const cal = await queryOne<Calendario>(`SELECT * FROM calendarios WHERE feed_token = $1`, [token]);
  if (!cal) return null;
  const rs = await query<any>(
    `SELECT * FROM reservas WHERE calendario_id = $1 AND estado = 'confirmada' AND inicio > now() - interval '60 days' ORDER BY inicio`, [cal.id]);
  const f = (d: Date) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (s: string) => String(s ?? '').replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');
  const ev = rs.map((r) => [
    'BEGIN:VEVENT', `UID:${r.id}@infocrm`, `DTSTAMP:${f(r.creado_en)}`, `DTSTART:${f(r.inicio)}`, `DTEND:${f(r.fin)}`,
    `SUMMARY:${esc(`${cal.nombre} · ${r.nombre ?? ''}${r.ig_username ? ` (@${r.ig_username})` : ''}`)}`,
    `DESCRIPTION:${esc([r.email, r.telefono, ...Object.entries(r.respuestas ?? {}).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('\n'))}`,
    ...(cal.ubicacion ? [`LOCATION:${esc(cal.ubicacion)}`] : []),
    'END:VEVENT',
  ].join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//InfoCRM//Agenda//ES', `X-WR-CALNAME:${esc(cal.nombre)}`, ...ev, 'END:VCALENDAR'].join('\r\n');
}

// ---------------------------------------------------------------------
// Importar desde un link público de Calendly (copia nombre, duración,
// preguntas, zona, horario por día, intervalo y hasta cuándo se agenda)
// ---------------------------------------------------------------------

export async function leerCalendly(link: string, fetcher: typeof fetch = fetch) {
  const m = /calendly\.com\/([^/?#]+)\/([^/?#]+)/i.exec(link.trim());
  if (!m) throw new ErrorAgenda('link', 'Pegá el link de un evento de Calendly (ej. calendly.com/tu-usuario/30min).');
  const [, perfil, evento] = m;
  const api = 'https://calendly.com/api/booking';
  const et: any = await (await fetcher(`${api}/event_types/lookup?event_type_slug=${encodeURIComponent(evento)}&profile_slug=${encodeURIComponent(perfil)}`, { signal: AbortSignal.timeout(15000) })).json().catch(() => null);
  if (!et?.uuid) throw new ErrorAgenda('link', 'No encontramos ese evento en Calendly. Revisá que el link sea público.');
  const zona = et.availability_timezone || 'UTC';
  const hoy = new Date().toISOString().slice(0, 10);
  const spots: string[] = [];
  for (let i = 0; i < 4; i++) {
    const desde = sumarDias(hoy, i * 14), hasta = sumarDias(hoy, i * 14 + 13);
    const rg: any = await (await fetcher(`${api}/event_types/${et.uuid}/calendar/range?timezone=${encodeURIComponent(zona)}&diary_provider=moment&range_start=${desde}&range_end=${hasta}`, { signal: AbortSignal.timeout(15000) })).json().catch(() => null);
    for (const d of rg?.days ?? []) for (const s of d.spots ?? []) if (s.status === 'available') spots.push(s.start_time);
  }
  const duracion = Number(et.duration) || 30;
  // Horario por día de la semana: del primer hueco al final del último.
  const porDia: Record<string, { min: string; max: string }> = {};
  const instantes = spots.map((s) => new Date(s).getTime()).sort((a, b) => a - b);
  let intervalo = Infinity;
  for (let i = 1; i < instantes.length; i++) {
    const dif = (instantes[i] - instantes[i - 1]) / 60000;
    if (dif > 0 && dif < intervalo) intervalo = dif;
  }
  for (const t of instantes) {
    const { dia, hora } = fechaLocal(t, zona);
    const finH = fechaLocal(t + duracion * 60000, zona).hora;
    const k = String(dia);
    if (!porDia[k]) porDia[k] = { min: hora, max: finH };
    if (hora < porDia[k].min) porDia[k].min = hora;
    if (finH > porDia[k].max) porDia[k].max = finH;
  }
  const horario: Record<string, Array<[string, string]>> = {};
  for (const [k, v] of Object.entries(porDia)) horario[k] = [[v.min, v.max]];
  const ultimo = et.last_availability ? new Date(et.last_availability).getTime() : null;
  const diasMax = ultimo ? Math.max(1, Math.round((ultimo - Date.now()) / 86400000)) : 60;
  return {
    nombre: String(et.name ?? 'Llamada'),
    descripcion: et.description ?? null,
    duracion_min: duracion,
    intervalo_min: Number.isFinite(intervalo) ? Math.min(240, Math.max(5, intervalo)) : Math.min(duracion, 60),
    zona_horaria: zona,
    horario: Object.keys(horario).length ? horario : undefined,
    dias_max: et.end_date ? Math.max(1, Math.round((new Date(et.end_date).getTime() - Date.now()) / 86400000)) : diasMax,
    fecha_fin: et.end_date ?? null,
    antelacion_min: 60, // Calendly no lo publica: queda en 1 h (editable)
    preguntas: (et.custom_fields ?? []).map((c: any) => ({ nombre: String(c.name), obligatoria: Boolean(c.required) })),
    color: typeof et.color === 'string' ? et.color : '#2563eb',
    origen: { calendly: link.trim(), importado_en: new Date().toISOString(), huecos_leidos: instantes.length },
  };
}

export function slugDe(nombre: string) {
  const base = nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'agenda';
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}
