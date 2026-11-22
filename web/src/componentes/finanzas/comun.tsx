import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fmtDinero, fmtFecha, monedaCuenta } from '../../api';
import { textoDe, tonoDe } from '../../textos';
import { Ayuda, BotonIcono, Chip, Entrada, FilaChips, Insignia, Menu, ItemMenu, Boton, useParamUrl, type Tono } from '../../ui';
import Icono from '../Iconos';

// Piezas chicas que comparten las pestañas de Finanzas (y el diálogo de venta
// del Pipeline y el Chat): período en la URL, plata con centavos y símbolo de
// la moneda de la cuenta, fechas sin corrimientos de zona horaria, estados en
// palabras y el menú "⋯".

// ---------------------------------------------------------------------
// Período (?periodo=mes)
// ---------------------------------------------------------------------

export type Periodo = 'mes' | 'mes_pasado' | '3m' | 'anio' | 'todo';
export const PERIODOS: Array<{ id: Periodo; etiqueta: string }> = [
  { id: 'mes', etiqueta: 'Este mes' },
  { id: 'mes_pasado', etiqueta: 'Mes pasado' },
  { id: '3m', etiqueta: '3 meses' },
  { id: 'anio', etiqueta: 'Este año' },
  { id: 'todo', etiqueta: 'Todo' },
];

export interface RangoServidor {
  periodo: Periodo; hoy: string; desde: string | null; hasta: string | null;
  anterior: { desde: string; hasta: string } | null; texto: string; comparacion: string | null;
}

/** El período elegido vive en la URL: recargar o compartir el link lo mantiene. */
export function usePeriodo(): [Periodo, (p: Periodo) => void] {
  const [valor, fijar] = useParamUrl<Periodo>('periodo', 'mes');
  const ok = PERIODOS.some((p) => p.id === valor) ? valor : 'mes';
  return [ok, fijar];
}

/** Chips del período (en el celular se deslizan de costado). */
export function SelectorPeriodo({ valor, onCambiar, className = '' }: { valor: Periodo; onCambiar: (p: Periodo) => void; className?: string }) {
  return (
    <div role="group" aria-label="Período" className={className}>
      <Menu alinear="izquierda" titulo="Período" ancho={200} disparador={({ alternar, abierto }) => (
        <Boton variante="secundario" tamano="sm" onClick={alternar} aria-expanded={abierto}>
          {PERIODOS.find((p) => p.id === valor)?.etiqueta} ▾
        </Boton>
      )}>
        {PERIODOS.map((p) => <ItemMenu key={p.id} activo={valor === p.id} onClick={() => onCambiar(p.id)}>{p.etiqueta}</ItemMenu>)}
      </Menu>
    </div>
  );
}

// ---------------------------------------------------------------------
// Subvista en la URL (?venta=<id>): Atrás la cierra
// ---------------------------------------------------------------------

export function useSubvista(clave: string) {
  const [params, setParams] = useSearchParams();
  const valor = params.get(clave);
  const marca = `${clave}Apilada`;
  const abrir = useCallback((id: string) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set(clave, id);
      return p;
    }, { replace: Boolean(new URLSearchParams(window.location.search).get(clave)), state: { [marca]: true } });
  }, [clave, marca, setParams]);
  const cerrar = useCallback(() => {
    // Si la abrimos nosotros (sumó una entrada al historial), cerrar = Atrás.
    if ((window.history.state as any)?.usr?.[marca]) { window.history.back(); return; }
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete(clave);
      return p;
    }, { replace: true });
  }, [clave, marca, setParams]);
  /** Cambia esta subvista por la ficha del lead (Atrás vuelve a la lista, no a la subvista). */
  const cambiarPorFicha = useCallback((leadId: string) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.delete(clave);
      p.set('ficha', leadId);
      return p;
    }, { replace: true, state: { fichaApilada: Boolean((window.history.state as any)?.usr?.[marca]) } });
  }, [clave, marca, setParams]);
  return { valor, abrir, cerrar, cambiarPorFicha };
}

// ---------------------------------------------------------------------
// Plata
// ---------------------------------------------------------------------

const cacheExacto = new Map<string, Intl.NumberFormat>();

/** Con centavos solo si los tiene: 1.497 € · 165,67 €. */
export function fmtDineroExacto(n: number | string | null | undefined, moneda?: string | null) {
  const v = Number(n ?? 0);
  if (Math.abs(v - Math.round(v)) < 0.005) return fmtDinero(Math.round(v), moneda ?? undefined);
  const m = moneda || monedaCuenta();
  let f = cacheExacto.get(m);
  if (!f) {
    f = new Intl.NumberFormat('es-ES', { style: 'currency', currency: m, minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' as any });
    cacheExacto.set(m, f);
  }
  return f.format(v);
}

export function simboloMoneda(moneda?: string | null) {
  const m = moneda || monedaCuenta();
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: m }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? m;
  } catch { return m; }
}

/** Lee "1.497,50", "1497.5", "2,9" o "1.497" como número (NaN si no hay número). */
export function parseMonto(txt: string | number | null | undefined): number {
  if (typeof txt === 'number') return txt;
  let s = String(txt ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/** Número para poner en un campo: 1497 → "1497"; 165.67 → "165,67". */
export function montoEnCampo(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!v) return '';
  return Math.abs(v - Math.round(v)) < 0.005 ? String(Math.round(v)) : v.toFixed(2).replace('.', ',');
}

/** Reparte un total en n cuotas exactas (igual que el servidor): 497 en 3 → 165,67 + 165,67 + 165,66. */
export function repartir(total: number, n: number): number[] {
  const cuotas = Math.max(1, Math.floor(n));
  const centavos = Math.round(total * 100);
  const base = Math.floor(centavos / cuotas);
  const resto = centavos - base * cuotas;
  return Array.from({ length: cuotas }, (_, i) => (base + (i < resto ? 1 : 0)) / 100);
}

/** Campo de plata: teclado decimal, acepta coma y puntos de miles, con el símbolo de la moneda. */
export function EntradaDinero({ id, valor, onCambiar, moneda, placeholder = 'Ej.: 1.497', autoFocus, invalido, disabled }: {
  id?: string; valor: string; onCambiar: (v: string) => void; moneda?: string | null; placeholder?: string;
  autoFocus?: boolean; invalido?: boolean; disabled?: boolean;
}) {
  const simbolo = simboloMoneda(moneda);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-[var(--text-muted)] md:text-[13px]" aria-hidden>{simbolo}</span>
      <Entrada id={id} value={valor} onChange={(e) => onCambiar(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal"
        autoComplete="off" placeholder={placeholder} autoFocus={autoFocus} invalido={invalido} disabled={disabled}
        style={{ paddingLeft: 14 + simbolo.length * 9 + 4 }} />
    </div>
  );
}

/** Campo de porcentaje con el "%" adentro. */
export function EntradaPorcentaje({ id, valor, onCambiar, autoFocus, ancho, etiqueta }: {
  id?: string; valor: string; onCambiar: (v: string) => void; autoFocus?: boolean; ancho?: number; etiqueta?: string;
}) {
  return (
    <div className="relative" style={ancho ? { width: ancho } : undefined}>
      <Entrada id={id} value={valor} onChange={(e) => onCambiar(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))}
        inputMode="decimal" autoComplete="off" placeholder="0" autoFocus={autoFocus} aria-label={etiqueta} style={{ paddingRight: 26 }} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--text-muted)]" aria-hidden>%</span>
    </div>
  );
}

/** "Por cada 1.000 € te cobra 45 €" — para entender un %. */
export function ejemploPct(pct: number, quien = 'se lleva', base = 1000) {
  if (!Number.isFinite(pct)) return null;
  return `Por cada ${fmtDinero(base)} ${quien} ${fmtDineroExacto((base * pct) / 100)}`;
}

/** Porcentaje legible: 4,5 % (sin ".00"). */
export function pctTexto(n: number | string | null | undefined) {
  const v = Number(n ?? 0);
  return `${new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(v)} %`;
}

// ---------------------------------------------------------------------
// Fechas "YYYY-MM-DD" (sin corrimientos de zona horaria)
// ---------------------------------------------------------------------

export function hoyISO() { return new Date().toLocaleDateString('sv-SE'); }

export function sumarDias(iso: string, dias: number) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function sumarMeses(iso: string, meses: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const ultimo = new Date(Date.UTC(y, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

/** Días de a hasta b (b − a). */
export function diasEntre(a: string, b: string) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** "18 nov" (mediodía local: un "2026-11-18" nunca se muestra como el 17). */
export function fechaCorta(iso: string | null | undefined) {
  return iso ? fmtFecha(`${iso.slice(0, 10)}T12:00:00`) : '—';
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
/** "2026-11" → "noviembre 2026" (o "noviembre" si es de este año). */
export function nombreMes(clave: string, conAnio = false) {
  const [y, m] = clave.split('-').map(Number);
  const mes = MESES[m - 1] ?? clave;
  return conAnio || y !== new Date().getFullYear() ? `${mes} ${y}` : mes;
}

/** "vence hoy", "venció hace 3 días", "vence en 5 días", "vence el 18 dic". */
export function vencimientoTexto(vence: string | null | undefined, hoy: string) {
  if (!vence) return 'sin fecha';
  const d = diasEntre(hoy, vence);
  if (d === 0) return 'vence hoy';
  if (d === -1) return 'venció ayer';
  if (d < 0) return `venció hace ${-d} días`;
  if (d === 1) return 'vence mañana';
  if (d <= 7) return `vence en ${d} días`;
  return `vence el ${fechaCorta(vence)}`;
}

/** Elegir una fecha sin un calendario complicado: chips + "Elegir fecha". */
export function SelectorFecha({ valor, onCambiar, tipo = 'pasado', id }: {
  valor: string; onCambiar: (iso: string) => void; tipo?: 'pasado' | 'futuro'; id?: string;
}) {
  const hoy = hoyISO();
  const chips = tipo === 'futuro'
    ? [{ e: 'En 1 semana', v: sumarDias(hoy, 7) }, { e: 'En 15 días', v: sumarDias(hoy, 15) }, { e: 'En 1 mes', v: sumarMeses(hoy, 1) }]
    : [{ e: 'Hoy', v: hoy }, { e: 'Ayer', v: sumarDias(hoy, -1) }];
  const [elegir, setElegir] = useState(() => !chips.some((c) => c.v === valor));
  return (
    <div className="space-y-2">
      <FilaChips>
        {chips.map((c) => (
          <Chip key={c.e} activo={!elegir && valor === c.v} onClick={() => { setElegir(false); onCambiar(c.v); }}>{c.e}</Chip>
        ))}
        <Chip activo={elegir} onClick={() => setElegir(true)}>{elegir ? fechaCorta(valor) : 'Elegir fecha'}</Chip>
      </FilaChips>
      {elegir && (
        <Entrada id={id} type="date" value={valor} aria-label="Fecha"
          min={tipo === 'futuro' ? hoy : undefined} max={tipo === 'pasado' ? hoy : undefined}
          onChange={(e) => { if (e.target.value) onCambiar(e.target.value); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Estados en palabras (nunca "en_cuotas" o "pendiente")
// ---------------------------------------------------------------------

/** Para la gente: una venta "activa" es una venta que todavía no te pagó; una cuota vencida está atrasada. */
const LOCAL: Record<string, Record<string, { texto: string; tono: Tono }>> = {
  venta: { activa: { texto: 'Por cobrar', tono: 'amarillo' }, en_mora: { texto: 'Atrasada', tono: 'rojo' } },
  // Una cuota: "Cobrada", "No pasó" (lo mismo que dice el menú "No pasó el pago"), "Reprogramada".
  pago: {
    atrasada: { texto: 'Atrasada', tono: 'rojo' }, pagado: { texto: 'Cobrada', tono: 'verde' },
    fallido: { texto: 'No pasó', tono: 'rojo' }, reagendado: { texto: 'Reprogramada', tono: 'azul' },
    reembolsado: { texto: 'Devuelta', tono: 'rojo' },
  },
};

export function Estado({ tipo, valor, punto = true }: { tipo: string; valor: string | null | undefined; punto?: boolean }) {
  const local = valor ? LOCAL[tipo]?.[valor] : undefined;
  return (
    <Insignia tono={local?.tono ?? tonoDe(tipo, valor)} punto={punto}>{local?.texto ?? textoDe(tipo, valor)}</Insignia>
  );
}

/** De dónde salió una venta: "Entró sola · Stripe" o "Cargada a mano". */
export function Origen({ origen }: { origen: string | null | undefined }) {
  if (!origen || origen === 'manual') return <Insignia tono="neutro">Cargada a mano</Insignia>;
  const nombre: Record<string, string> = { stripe: 'Stripe', hotmart: 'Hotmart', manychat: 'ManyChat', api: 'Claude o la API', generico: 'tu pasarela', auto: 'tu pasarela', seed: 'ejemplo' };
  return <Insignia tono="violeta">Entró sola · {nombre[origen] ?? origen}</Insignia>;
}

// ---------------------------------------------------------------------
// Menú "⋯" y cascada de "lo que te queda"
// ---------------------------------------------------------------------

export function MenuPuntos({ children, etiqueta = 'Más opciones', titulo }: { children: React.ReactNode; etiqueta?: string; titulo?: string }) {
  return (
    <Menu alinear="derecha" ancho={250} titulo={titulo} disparador={({ alternar, abierto, ref }) => (
      <BotonIcono ref={ref} etiqueta={etiqueta} aria-haspopup="menu" aria-expanded={abierto} tamano="md"
        onClick={(e) => { e.stopPropagation(); alternar(); }}>
        <Icono nombre="puntos" tam={18} />
      </BotonIcono>
    )}>
      {children}
    </Menu>
  );
}

export interface FilaCascada {
  etiqueta: React.ReactNode; valor: number; signo: '+' | '−' | '='; ayuda?: React.ReactNode; detalle?: React.ReactNode;
}

/** Renglón por renglón: de lo que cobraste a lo que te queda. */
export function Cascada({ filas, moneda }: { filas: FilaCascada[]; moneda?: string }) {
  return (
    <dl className="divide-y divide-[var(--border-hairline)]">
      {filas.map((f, i) => {
        const total = f.signo === '=';
        const color = total ? (f.valor >= 0 ? 'var(--status-good)' : 'var(--status-critical)') : f.signo === '−' ? 'var(--text-secondary)' : undefined;
        return (
          <div key={i} className={`flex items-center justify-between gap-3 ${total ? 'pt-3' : 'py-2'}`}>
            <dt className={`flex min-w-0 items-center gap-1 ${total ? 'text-[14px] font-semibold' : 'text-[13px] text-[var(--text-secondary)]'}`}>
              <span className="truncate">{f.etiqueta}</span>
              {f.ayuda && <Ayuda titulo={typeof f.etiqueta === 'string' ? f.etiqueta : undefined}>{f.ayuda}</Ayuda>}
              {f.detalle && <span className="hidden truncate text-[11px] font-normal text-[var(--text-muted)] sm:inline">· {f.detalle}</span>}
            </dt>
            <dd className={`cifras shrink-0 font-semibold ${total ? 'text-[24px] tracking-tight' : 'text-[14px]'}`} style={{ color }}>
              {f.signo === '−' && f.valor > 0 ? '− ' : ''}{fmtDinero(Math.abs(f.valor) < 0.5 ? 0 : f.signo === '=' ? f.valor : Math.abs(f.valor), moneda)}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
