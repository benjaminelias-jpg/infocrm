import { useEffect, useState } from 'react';
import { api, fmtDinero, fmtNum, guardarSesion, leerSesion, token } from '../../api';
import { BarraProgreso, Boton, Entrada, ErrorCarga, Esqueleto, Seleccion, TituloSeccion, useAviso, useCarga } from '../../ui';

// "Tu negocio": los datos de la cuenta que antes no se podían cambiar desde
// ningún lado. Cada dato se edita en el lugar (tocar → campo → Guardar), sin
// formularios largos. El objetivo del mes se guarda con PUT /metas (el mismo
// que lee el Panel) y se ve cómo venís con la barra de progreso.

interface Metas { tiene_meta: boolean; objetivo: Record<Clave, number> | null; real: Record<Clave, number> }
interface DatosNegocio {
  cuenta: { nombre: string; moneda: string; zona_horaria: string; ig_username: string | null; criterios_calif: string[] };
  comisiones: { closer_pct: number; setter_pct: number };
  objetivo: Metas;
}
type Clave = 'leads' | 'calificados' | 'ventas' | 'ingresos';

const MONEDAS: Array<[string, string]> = [
  ['EUR', 'Euro (€)'], ['USD', 'Dólar estadounidense (US$)'], ['ARS', 'Peso argentino'], ['MXN', 'Peso mexicano'],
  ['COP', 'Peso colombiano'], ['CLP', 'Peso chileno'], ['PEN', 'Sol peruano'], ['UYU', 'Peso uruguayo'],
  ['BRL', 'Real brasileño'], ['GBP', 'Libra esterlina (£)'],
];
const ZONAS_COMUNES = [
  'America/Argentina/Buenos_Aires', 'America/Montevideo', 'America/Santiago', 'America/Bogota', 'America/Lima',
  'America/Mexico_City', 'America/New_York', 'America/Los_Angeles', 'Europe/Madrid', 'Europe/London', 'Atlantic/Canary',
];
function todasLasZonas(): string[] {
  try { return (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { return ZONAS_COMUNES; }
}
let opcionesZona: Array<{ valor: string; texto: string }> | null = null;
/** Las comunes primero; se calculan una sola vez (son unas 400). */
function zonasParaElegir() {
  if (!opcionesZona) {
    const todas = todasLasZonas();
    opcionesZona = [...ZONAS_COMUNES, ...todas.filter((z) => !ZONAS_COMUNES.includes(z))].map((z) => ({ valor: z, texto: nombreZona(z) }));
  }
  return opcionesZona;
}
function desfase(z: string) {
  try {
    return new Intl.DateTimeFormat('es', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value?.replace('GMT', 'UTC') ?? '';
  } catch { return ''; }
}
/** "America/Argentina/Buenos_Aires" → "Buenos Aires · UTC-3". */
const nombreZona = (z: string) => {
  const ciudad = z.split('/').pop()?.replace(/_/g, ' ') ?? z;
  const d = desfase(z);
  return !z.includes('/') || !d ? ciudad : `${ciudad} · ${d}`;
};
const zonaDelCelular = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return null; } };

/** "45.000", "45000", "2,5" → número (NaN si no se entiende). */
function leerNumero(s: string): number {
  const limpio = String(s ?? '').trim().replace(/[^\d,.-]/g, '');
  if (!limpio) return 0;
  const normal = limpio.includes(',') ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/\.(?=\d{3}(\D|$))/g, '');
  const v = Number(normal);
  return Number.isFinite(v) ? v : NaN;
}

const pct = (n: number) => `${String(Math.round(n * 100) / 100).replace('.', ',')} %`;

/** Qué parte del mes ya pasó (para la marca "dónde deberías estar hoy"). */
function ritmoDelMes(ahora = new Date()) {
  const ini = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
  return Math.min(1, Math.max(0, (ahora.getTime() - ini.getTime()) / (fin.getTime() - ini.getTime())));
}

export default function Negocio() {
  const aviso = useAviso();
  const { datos, setDatos, error, recargar } = useCarga(() => api<DatosNegocio>('/ux/integraciones/negocio'), []);

  async function guardar(cambios: Record<string, unknown>, texto = 'Guardado') {
    const nuevo = await api<DatosNegocio>('/ux/integraciones/negocio', { method: 'PATCH', json: cambios });
    setDatos(nuevo);
    // El nombre y la moneda se usan en toda la app (menú, montos): se actualizan ya.
    const s = leerSesion();
    const t = token();
    if (s && t && (cambios.nombre !== undefined || cambios.moneda !== undefined || cambios.zona_horaria !== undefined)) {
      guardarSesion(t, s.usuario, { ...s.cuenta, nombre: nuevo.cuenta.nombre, moneda: nuevo.cuenta.moneda, zona_horaria: nuevo.cuenta.zona_horaria });
    }
    aviso.exito(texto);
  }

  async function guardarMeta(clave: Clave, valor: number) {
    const o = datos?.objetivo?.objetivo ?? { leads: 0, calificados: 0, ventas: 0, ingresos: 0 };
    // PUT /metas reemplaza el objetivo entero: se mandan los cuatro (con el que cambió).
    const base = { leads_meta: Math.round(o.leads), calificados_meta: Math.round(o.calificados), ventas_meta: Math.round(o.ventas), ingresos_meta: o.ingresos };
    await api('/metas', { method: 'PUT', json: { ...base, [`${clave}_meta`]: valor } });
    await recargar(true);
    aviso.exito('Objetivo del mes guardado. El Panel ya te muestra si vas al ritmo.');
  }

  if (error && !datos) return <ErrorCarga error={error} titulo="No pudimos cargar los datos de tu negocio" onReintentar={() => recargar()} />;
  if (!datos) return <div className="grid gap-3 lg:grid-cols-2">{[0, 1, 2, 3].map((i) => <Esqueleto key={i} alto={180} className="rounded-[18px]" />)}</div>;

  const c = datos.cuenta;
  const celular = zonaDelCelular();
  const meta = datos.objetivo;
  const ritmo = ritmoDelMes();
  const mes = new Date().toLocaleDateString('es-AR', { month: 'long' });
  const metricas: Array<{ k: Clave; etiqueta: string; dinero?: boolean }> = [
    { k: 'leads', etiqueta: 'Leads' }, { k: 'calificados', etiqueta: 'Calificados' },
    { k: 'ventas', etiqueta: 'Ventas' }, { k: 'ingresos', etiqueta: 'Ingresos', dinero: true },
  ];

  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      <section className="tarjeta p-4">
        <TituloSeccion titulo="Tu negocio" subtitulo="Se usan en toda la app: montos, horarios y avisos." />
        <div className="divide-y divide-[var(--border-hairline)]">
          <CampoEnLinea etiqueta="Nombre" valor={c.nombre} onGuardar={(v) => guardar({ nombre: v })} />
          <CampoEnLinea etiqueta="Moneda" valor={c.moneda} mostrar={MONEDAS.find(([m]) => m === c.moneda)?.[1] ? `${c.moneda} · ${MONEDAS.find(([m]) => m === c.moneda)![1]}` : c.moneda}
            opciones={MONEDAS.map(([m, n]) => ({ valor: m, texto: `${m} · ${n}` }))}
            onGuardar={(v) => guardar({ moneda: v }, 'Moneda cambiada: los montos se muestran en la nueva.')} />
          <CampoEnLinea etiqueta="Zona horaria" valor={c.zona_horaria} mostrar={nombreZona(c.zona_horaria)}
            opciones={zonasParaElegir}
            onGuardar={(v) => guardar({ zona_horaria: v })}
            extra={celular && celular !== c.zona_horaria ? (
              <Boton tamano="xs" variante="fantasma" onClick={() => guardar({ zona_horaria: celular }, `Listo: ${nombreZona(celular)}.`).catch((e) => aviso.error(e.message))}>
                Usar la de este celular ({nombreZona(celular)})
              </Boton>
            ) : null} />
          <CampoEnLinea etiqueta="Tu @ de Instagram" valor={c.ig_username ?? ''} mostrar={c.ig_username ? `@${c.ig_username}` : 'Sin cargar'}
            prefijo="@" placeholder="tucuenta" onGuardar={(v) => guardar({ ig_username: v.replace(/^@+/, '') || null })} />
        </div>
      </section>

      <section className="tarjeta p-4">
        <TituloSeccion titulo="Objetivo del mes" subtitulo={`Cuenta lo que entra desde el 1 de ${mes}. La rayita marca dónde deberías estar hoy.`} />
        {!meta.tiene_meta && (
          <p className="mb-2 rounded-[12px] px-3 py-2 text-[12px]" style={{ background: 'var(--tint, var(--page-plane))' }}>
            Todavía no fijaste tu objetivo. Poné cuántos leads, ventas o ingresos querés este mes y el Panel te muestra si vas al ritmo.
          </p>
        )}
        <div className="divide-y divide-[var(--border-hairline)]">
          {metricas.map((m) => {
            const objetivo = Number(meta.objetivo?.[m.k] ?? 0);
            const real = Number(meta.real?.[m.k] ?? 0);
            const fmt = (n: number) => (m.dinero ? fmtDinero(n) : fmtNum(n));
            return (
              <div key={m.k} className="py-1">
                <CampoEnLinea etiqueta={m.etiqueta} valor={objetivo ? String(objetivo) : ''} mostrar={objetivo ? fmt(objetivo) : 'Sin objetivo'}
                  numerico sufijo={m.dinero ? c.moneda : undefined} placeholder="0" sinBorde
                  onGuardar={async (v) => {
                    const n = leerNumero(v);
                    if (!Number.isFinite(n) || n < 0) throw new Error('Poné un número (0 o más).');
                    await guardarMeta(m.k, m.dinero ? n : Math.round(n));
                  }} />
                {objetivo > 0 && (
                  <div className="pb-2">
                    <BarraProgreso valor={real} meta={objetivo} ritmo={ritmo} detalle={`${fmt(real)} de ${fmt(objetivo)}`} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="tarjeta p-4">
        <TituloSeccion titulo="Comisiones por defecto" subtitulo="Se proponen al sumar a alguien al equipo o al registrar una venta. Las podés cambiar en cada caso." />
        <div className="divide-y divide-[var(--border-hairline)]">
          <CampoEnLinea etiqueta="Closer (cierra la venta)" valor={String(datos.comisiones.closer_pct).replace('.', ',')} mostrar={pct(datos.comisiones.closer_pct)}
            numerico sufijo="%" onGuardar={async (v) => {
              const n = leerNumero(v);
              if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Poné un porcentaje entre 0 y 100.');
              await guardar({ comision_closer_pct: n });
            }} />
          <CampoEnLinea etiqueta="Setter (consigue la llamada)" valor={String(datos.comisiones.setter_pct).replace('.', ',')} mostrar={pct(datos.comisiones.setter_pct)}
            numerico sufijo="%" onGuardar={async (v) => {
              const n = leerNumero(v);
              if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Poné un porcentaje entre 0 y 100.');
              await guardar({ comision_setter_pct: n });
            }} />
        </div>
      </section>

      <section className="tarjeta p-4">
        <TituloSeccion titulo="Criterios de calificación" subtitulo="Los 3 que marca tu setter para darle un grado al lead: A (cumple los 3), B (2), S (1) o D (ninguno)." />
        <div className="divide-y divide-[var(--border-hairline)]">
          {[0, 1, 2].map((i) => (
            <CampoEnLinea key={i} etiqueta={`Criterio ${i + 1}`} valor={c.criterios_calif[i] ?? ''} mostrar={c.criterios_calif[i] || 'Sin texto'}
              onGuardar={async (v) => {
                if (!v.trim()) throw new Error('Escribí el criterio.');
                const lista = [0, 1, 2].map((j) => (j === i ? v.trim() : (c.criterios_calif[j] ?? `Criterio ${j + 1}`)));
                await guardar({ criterios_calif: lista });
              }} />
          ))}
        </div>
      </section>
    </div>
  );
}

/** Un dato que se edita tocándolo: Guardar / Cancelar en el lugar (Enter guarda, Esc cancela). */
function CampoEnLinea({ etiqueta, valor, mostrar, opciones, numerico, sufijo, prefijo, placeholder, onGuardar, extra, sinBorde }: {
  etiqueta: string; valor: string; mostrar?: React.ReactNode;
  /** Lista de opciones (o una función que la arma recién al editar). */
  opciones?: Array<{ valor: string; texto: string }> | (() => Array<{ valor: string; texto: string }>);
  numerico?: boolean; sufijo?: string; prefijo?: string; placeholder?: string;
  onGuardar: (v: string) => Promise<void> | void;
  extra?: React.ReactNode; sinBorde?: boolean;
}) {
  const [editando, setEditando] = useState(false);
  const [v, setV] = useState(valor);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!editando) setV(valor); }, [valor, editando]);

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    if (v === valor) { setEditando(false); return; }
    setGuardando(true); setError(null);
    try { await onGuardar(v); setEditando(false); } catch (err: any) { setError(err.message); } finally { setGuardando(false); }
  }
  const cancelar = () => { setV(valor); setError(null); setEditando(false); };

  if (!editando) {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${sinBorde ? 'py-1.5' : 'py-2.5'}`}>
        <button type="button" onClick={() => setEditando(true)} className="ui-foco flex min-w-0 flex-1 items-center justify-between gap-3 rounded-[10px] text-left">
          <span className="min-w-0">
            <span className="block text-[12px] text-[var(--text-secondary)]">{etiqueta}</span>
            <span className="block truncate text-[14px] font-semibold">{mostrar ?? valor}</span>
          </span>
          <span className="shrink-0 text-[12px] font-semibold" style={{ color: 'var(--accion, var(--series-1))' }}>Cambiar</span>
        </button>
        {extra && <div className="w-full">{extra}</div>}
      </div>
    );
  }
  return (
    <form onSubmit={guardar} className="ui-fundido space-y-2 py-2.5"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); cancelar(); } }}>
      <label className="block text-[12px] font-medium text-[var(--text-secondary)]">{etiqueta}</label>
      <div className="flex items-center gap-2">
        {prefijo && <span className="text-[14px] text-[var(--text-muted)]">{prefijo}</span>}
        {opciones ? (
          <Seleccion autoFocus value={v} onChange={(e) => setV(e.target.value)} aria-label={etiqueta}>
            {(typeof opciones === 'function' ? opciones() : opciones).map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
          </Seleccion>
        ) : (
          <Entrada autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={etiqueta}
            inputMode={numerico ? 'decimal' : undefined} invalido={Boolean(error)} />
        )}
        {sufijo && <span className="shrink-0 text-[13px] text-[var(--text-muted)]">{sufijo}</span>}
      </div>
      {error && <p className="text-[12px]" style={{ color: 'var(--status-critical)' }}>{error}</p>}
      <div className="flex gap-2">
        <Boton type="submit" tamano="sm" variante="primario" cargando={guardando}>Guardar</Boton>
        <Boton tamano="sm" variante="fantasma" onClick={cancelar}>Cancelar</Boton>
      </div>
    </form>
  );
}
