import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtDinero, hace, plural } from '../../api';
import {
  Banner, Boton, BotonFlotante, Buscador, Chip, ErrorCarga, Esqueleto, FilaChips, IdentidadLead, TablaResponsiva,
  TituloSeccion, Vacio, useCarga, useEsMovil, type Columna,
} from '../../ui';
import { Estado, SelectorPeriodo, fechaCorta, fmtDineroExacto, usePeriodo } from './comun';
import type { PropsPestana, RespVentas, VentaFila } from './tipos';

// Ventas: tabla en escritorio y tarjetas en el celular (monto, estado y lo
// que falta cobrar siempre a la vista). Tocar una venta la abre para
// corregirla, devolverla o cancelarla.

type Filtro = 'todas' | 'por_cobrar' | 'atrasadas' | 'pagadas' | 'devueltas';
const FILTROS: Array<{ id: Filtro; e: string; f: (v: VentaFila) => boolean }> = [
  { id: 'todas', e: 'Todas', f: () => true },
  { id: 'por_cobrar', e: 'Con saldo', f: (v) => v.por_cobrar > 0 },
  { id: 'atrasadas', e: 'Atrasadas', f: (v) => v.atrasadas > 0 },
  { id: 'pagadas', e: 'Pagadas', f: (v) => v.estado === 'completada' },
  { id: 'devueltas', e: 'Devueltas o canceladas', f: (v) => ['reembolsada', 'cancelada'].includes(v.estado) },
];
const viva = (v: VentaFila) => !['reembolsada', 'cancelada'].includes(v.estado);
const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const CLAVE_BANNER = 'infocrm_fin_banner_pagos';

/** "Todo ✓", "166 € de 497 €" o "Nada todavía". */
export function cobradoTexto(v: VentaFila) {
  if (!viva(v)) return v.estado === 'reembolsada' ? 'Devuelta' : 'Cancelada';
  if (v.por_cobrar <= 0.004) return 'Todo ✓';
  if (v.cobrado <= 0.004) return 'Nada todavía';
  return `${fmtDineroExacto(v.cobrado, v.moneda)} de ${fmtDinero(v.precio_acordado, v.moneda)}`;
}

export default function Ventas({ version, onRegistrarVenta, abrirVenta }: PropsPestana) {
  const [periodo, setPeriodo] = usePeriodo();
  const movil = useEsMovil(768);
  const navegar = useNavigate();
  const [buscar, setBuscar] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [sinBanner, setSinBanner] = useState(() => { try { return localStorage.getItem(CLAVE_BANNER) === '1'; } catch { return false; } });
  const carga = useCarga(() => api<RespVentas>(`/ux/finanzas/ventas?periodo=${periodo}`), [periodo, version]);
  const d = carga.datos;

  const filas = useMemo(() => {
    if (!d) return [];
    const f = FILTROS.find((x) => x.id === filtro)!.f;
    const q = sinTildes(buscar.trim().replace(/^@/, ''));
    return d.ventas.filter((v) => f(v) && (!q || sinTildes([v.lead_nombre, v.ig_username, v.producto, v.closer_nombre].filter(Boolean).join(' ')).includes(q)));
  }, [d, filtro, buscar]);

  const vivas = d?.ventas.filter(viva) ?? [];
  const total = vivas.reduce((s, v) => s + Number(v.precio_acordado), 0);

  const columnas: Array<Columna<VentaFila>> = [
    {
      clave: 'lead', titulo: 'Cliente', enMovil: 'titulo',
      render: (v) => (v.lead_id
        ? <IdentidadLead id={v.lead_id} nombre={v.lead_nombre} usuario={v.ig_username} foto={v.avatar_url} />
        : <span className="text-[13px] text-[var(--text-muted)]">Venta sin lead</span>),
    },
    { clave: 'curso', titulo: 'Curso', enMovil: 'subtitulo', render: (v) => (movil ? `${v.producto ?? 'Sin curso'} · ${fechaCorta(v.fecha)}` : (v.producto ?? <span className="text-[var(--text-muted)]">Sin curso</span>)) },
    { clave: 'fecha', titulo: 'Fecha', enMovil: 'ocultar', render: (v) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{fechaCorta(v.fecha)}</span> },
    { clave: 'cerro', titulo: 'Cerró', enMovil: 'ocultar', render: (v) => v.closer_nombre ?? <span className="text-[var(--text-muted)]">—</span> },
    { clave: 'cobrado', titulo: 'Cobrado', enMovil: 'dato', render: (v) => <span className="cifras whitespace-nowrap">{cobradoTexto(v)}</span> },
    { clave: 'estado', titulo: 'Estado', enMovil: 'dato', render: (v) => <Estado tipo="venta" valor={v.estado_visible} /> },
    { clave: 'queda', titulo: 'Te queda', alinear: 'der', enMovil: 'ocultar', render: (v) => (viva(v) ? fmtDinero(v.te_queda, v.moneda) : '—') },
    { clave: 'precio', titulo: 'Precio', alinear: 'der', enMovil: 'esquina', render: (v) => <span className="cifras whitespace-nowrap">{fmtDinero(v.precio_acordado, v.moneda)}</span> },
  ];

  const solos = d?.cobros_solos;
  const nombreFuente = (f: string) => ({ stripe: 'Stripe', hotmart: 'Hotmart', generico: 'tu pasarela' } as Record<string, string>)[f] ?? f;

  return (
    <section className="space-y-3" aria-label="Ventas">
      <SelectorPeriodo valor={periodo} onCambiar={setPeriodo} />
      <TituloSeccion titulo="Ventas" onMas={onRegistrarVenta} textoMas="Registrar venta"
        subtitulo={d ? `${plural(vivas.length, 'venta')} · ${fmtDinero(total, d.moneda)} ${d.periodo.texto}` : ' '} />

      {solos && (solos.ventas > 0 ? (
        <p className="flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
          <span style={{ color: 'var(--status-good)' }} aria-hidden>✓</span>
          {solos.fuentes.map(nombreFuente).join(' y ')} conectado: {plural(solos.ventas, 'venta entró sola', 'ventas entraron solas')}
          {solos.ultima ? ` (la última, ${hace(`${solos.ultima}T12:00:00`)})` : ''}.
        </p>
      ) : solos.conectado ? (
        <p className="text-[12px] text-[var(--text-secondary)]">✓ Tu pasarela está conectada: la próxima venta entra sola, con su cobro.</p>
      ) : !sinBanner ? (
        <Banner tono="info" icono="⚡"
          onCerrar={() => { setSinBanner(true); try { localStorage.setItem(CLAVE_BANNER, '1'); } catch { /* sin almacenamiento */ } }}
          accion={<Boton tamano="sm" variante="primario" onClick={() => navegar('/conexiones?abrir=pagos')}>Conectar (2 min)</Boton>}>
          ¿Cobrás con Stripe o Hotmart? Conectalo y cada venta entra sola, con su cobro y su comisión.
        </Banner>
      ) : null)}

      {d && d.ventas.length > 0 && (
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <Buscador valor={buscar} onCambiar={setBuscar} placeholder="Buscar por lead, curso o closer" className="md:w-72" />
          <FilaChips>
            {FILTROS.map((f) => (
              <Chip key={f.id} activo={filtro === f.id} onClick={() => setFiltro(f.id)}
                contador={f.id === 'todas' ? undefined : d.ventas.filter(f.f).length}>{f.e}</Chip>
            ))}
          </FilaChips>
        </div>
      )}

      {carga.error && !d ? (
        <div className="tarjeta"><ErrorCarga error={carga.error} titulo="No pudimos cargar tus ventas" onReintentar={() => carga.recargar()} /></div>
      ) : !d ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando">{[0, 1, 2, 3, 4].map((i) => <Esqueleto key={i} alto={56} className="rounded-xl" />)}</div>
      ) : d.ventas.length === 0 ? (
        <div className="tarjeta">
          <Vacio icono="🧾" titulo={periodo === 'todo' ? 'Todavía no registraste ventas' : `No hay ventas ${d.periodo.texto}`}
            texto="Registrá cada venta con su curso y cómo te pagó: la app calcula sola las comisiones, lo que falta cobrar y lo que te queda."
            accion={<div className="flex flex-wrap justify-center gap-2">
              <Boton variante="primario" onClick={onRegistrarVenta}>{periodo === 'todo' ? 'Registrar la primera' : 'Registrar venta'}</Boton>
              {periodo !== 'todo' && <Boton onClick={() => setPeriodo('todo')}>Ver todas</Boton>}
            </div>} />
        </div>
      ) : (
        <div className={`transition-opacity ${carga.cargando ? 'opacity-60' : ''}`}>
          <TablaResponsiva columnas={columnas} filas={filas} clave={(v) => v.id} onFila={(v) => abrirVenta(v.id)}
            vacio={<div className="tarjeta"><Vacio compacto icono="🔎" titulo="Ninguna venta coincide"
              texto="Probá con otro nombre o sacá el filtro."
              accion={<Boton tamano="sm" onClick={() => { setBuscar(''); setFiltro('todas'); }}>Ver todas</Boton>} /></div>} />
        </div>
      )}
      <BotonFlotante etiqueta="Registrar venta" onClick={onRegistrarVenta} />
    </section>
  );
}
