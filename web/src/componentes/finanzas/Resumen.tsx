import { api, fmtDinero, fmtNum, fmtPct, plural } from '../../api';
import { BarraProgreso, Boton, BotonFlotante, Carrusel, ErrorCarga, Esqueleto, useCarga } from '../../ui';
import { Kpi } from '../Graficas';
import { Cascada, SelectorPeriodo, nombreMes, usePeriodo } from './comun';
import type { PropsPestana, RespResumen, Tab } from './tipos';

// Resumen: arriba lo que te queda (de lo que cobraste a lo que te queda, en
// cascada) y lo que te deben; abajo, cifras chicas comparadas con el período
// anterior y las ventas mes a mes. Sin datos todavía: los primeros pasos.

export default function Resumen({ version, onRegistrarVenta, irA }: PropsPestana) {
  const [periodo, setPeriodo] = usePeriodo();
  const carga = useCarga(() => api<RespResumen>(`/ux/finanzas/resumen?periodo=${periodo}`), [periodo, version]);
  const d = carga.datos;

  return (
    <section className="space-y-4 pb-20 md:pb-0" aria-label="Resumen">
      <SelectorPeriodo valor={periodo} onCambiar={setPeriodo} />
      {carga.error && !d ? (
        <div className="tarjeta"><ErrorCarga error={carga.error} titulo="No pudimos cargar tus números" onReintentar={() => carga.recargar()} /></div>
      ) : !d ? (
        <EsqueletoResumen />
      ) : (
        <div className={`space-y-4 transition-opacity ${carga.cargando ? 'opacity-60' : ''}`}>
          {d.primeros_pasos.ventas === 0 && <PrimerosPasos p={d.primeros_pasos} irA={irA} onRegistrarVenta={onRegistrarVenta} />}
          <Principal d={d} irA={irA} />
          {/* Sin ninguna venta, cuatro tarjetas en cero no dicen nada: primero los primeros pasos. */}
          {d.primeros_pasos.ventas > 0 && <Cifras d={d} />}
          <PorMes d={d} />
        </div>
      )}
      <BotonFlotante etiqueta="Registrar venta" onClick={onRegistrarVenta} />
    </section>
  );
}

function Principal({ d, irA }: { d: RespResumen; irA: (t: Tab) => void }) {
  const a = d.actual;
  const t = d.periodo.texto;
  const pc = d.por_cobrar;
  return (
    <div className="grid gap-3 lg:grid-cols-[1.25fr_1fr]">
      <section className="tarjeta px-4 py-3.5" aria-label="Lo que te queda">
        <h2 className="mb-1 text-[15px] font-semibold first-letter:uppercase">Lo que te queda {t}</h2>
        <Cascada moneda={d.moneda} filas={[
          { etiqueta: 'Cobraste', valor: a.cobrado, signo: '+',
            ayuda: <>La plata que entró {t}: pagos únicos y cuotas cobradas (también de ventas de antes).</> },
          { etiqueta: 'Comisiones de cobro', valor: a.comision_cobro, signo: '−', detalle: 'Stripe, PayPal…',
            ayuda: <>Lo que se quedan Stripe, PayPal y compañía de cada cobro. Sale del % que cargaste en «Cómo te pagan».</> },
          { etiqueta: 'Comisiones del equipo', valor: a.comision_equipo, signo: '−',
            ayuda: <>Lo que le toca a tu equipo por las ventas que se cerraron {t} (el % de cada uno, en Equipo).</> },
          { etiqueta: 'Gastos', valor: a.gastos, signo: '−',
            ayuda: <>Lo que anotaste en Gastos {t}. Los gastos marcados como comisiones no se restan dos veces.</> },
          { etiqueta: 'Te queda', valor: a.te_queda, signo: '=' },
        ]} />
      </section>

      <section className="tarjeta space-y-3 px-4 py-3.5" aria-label="Lo que vendiste y lo que te deben">
        <div>
          <h2 className="text-[15px] font-semibold first-letter:uppercase">
            Vendiste <span className="cifras">{fmtDinero(a.vendido, d.moneda)}</span>
            <span className="text-[13px] font-normal text-[var(--text-muted)]"> · {plural(a.ventas, 'venta')}</span>
          </h2>
          {a.vendido > 0 ? (
            <div className="mt-2">
              <BarraProgreso valor={a.cobrado_de_lo_vendido} meta={a.vendido}
                etiqueta={<>De eso ya cobraste <strong className="cifras">{fmtDinero(a.cobrado_de_lo_vendido, d.moneda)}</strong></>}
                detalle={fmtPct(Math.round((a.cobrado_de_lo_vendido / a.vendido) * 1000) / 10)} />
            </div>
          ) : <p className="mt-1 text-[12px] text-[var(--text-muted)]">Todavía no hay ventas {t}.</p>}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-3" style={{ background: 'var(--page-plane)' }}>
          <div className="min-w-0">
            <div className="text-[12px] text-[var(--text-secondary)]">Te deben hoy</div>
            <div className="cifras text-[20px] font-semibold tracking-tight">{fmtDinero(pc.total, d.moneda)}</div>
            <div className="text-[12px]">
              {pc.atrasado > 0
                ? <span style={{ color: 'var(--status-critical)' }}>{fmtDinero(pc.atrasado, d.moneda)} atrasado ({plural(pc.atrasadas, 'cuota')})</span>
                : <span className="text-[var(--text-muted)]">{pc.total > 0 ? 'Nada atrasado ✓' : 'Nadie te debe nada ✓'}</span>}
              {pc.semana > 0 && <span className="text-[var(--text-muted)]"> · {fmtDinero(pc.semana, d.moneda)} esta semana</span>}
            </div>
          </div>
          {pc.cuotas > 0 && <Boton tamano="sm" onClick={() => irA('cobros')} className="shrink-0">Ver cobros</Boton>}
        </div>
      </section>
    </div>
  );
}

function Cifras({ d }: { d: RespResumen }) {
  const a = d.actual;
  const ant = d.anterior;
  const t = d.periodo.texto;
  const ir = (tab: Tab) => `/finanzas?tab=${tab}${d.periodo.periodo !== 'mes' ? `&periodo=${d.periodo.periodo}` : ''}`;
  return (
    <section aria-label="Tus números" className="space-y-2">
      {ant && d.periodo.comparacion && <p className="text-[12px] text-[var(--text-secondary)]">Comparado con {d.periodo.comparacion}</p>}
      <Carrusel soloMovil columnas={4} anchoItem="44vw" etiqueta="Tus números">
        <Kpi etiqueta="Vendido" valor={fmtDinero(a.vendido, d.moneda)} actual={a.vendido} anterior={ant?.vendido} a={ir('ventas')}
          ayuda={<>El total de las ventas que cerraste {t}, se hayan cobrado o no. Las canceladas y devueltas no cuentan.</>} />
        <Kpi etiqueta="Ventas" valor={fmtNum(a.ventas)} actual={a.ventas} anterior={ant?.ventas} a={ir('ventas')}
          ayuda={<>Cuántas ventas cerraste {t}. Son las mismas que cuenta el Panel.</>} />
        <Kpi etiqueta="Ticket promedio" valor={fmtDinero(a.ticket, d.moneda)} actual={a.ticket} anterior={ant?.ventas ? ant.ticket : null}
          ayuda={<>Lo que vale en promedio cada venta {t}: lo vendido dividido por la cantidad de ventas.</>} />
        <Kpi etiqueta="Gastos" valor={fmtDinero(a.gastos, d.moneda)} actual={a.gastos} anterior={ant?.gastos} menosEsMejor a={ir('gastos')}
          ayuda={<>Lo que anotaste en Gastos {t} (publicidad, herramientas, freelancers…).</>} />
      </Carrusel>
    </section>
  );
}

function PorMes({ d }: { d: RespResumen }) {
  const primero = d.por_mes.findIndex((m) => m.ventas > 0);
  if (primero < 0) return null;
  const meses = d.por_mes.slice(primero).reverse();
  const max = Math.max(...meses.map((m) => m.vendido), 1);
  const actual = d.periodo.hoy.slice(0, 7);
  return (
    <section className="tarjeta px-4 py-3.5" aria-label="Ventas por mes">
      <h2 className="mb-2.5 text-[15px] font-semibold">Ventas por mes</h2>
      <ul className="space-y-2">
        {meses.map((m) => {
          const esActual = m.mes === actual;
          return (
            <li key={m.mes} className="grid grid-cols-[minmax(76px,auto)_1fr] items-center gap-x-3 gap-y-1 text-[12px] sm:grid-cols-[110px_1fr_170px]">
              <span className={`first-letter:uppercase ${esActual ? 'font-semibold' : 'text-[var(--text-secondary)]'}`}>{nombreMes(m.mes)}</span>
              <div className="h-2.5 overflow-hidden rounded-full" style={{ background: 'var(--gridline)' }}>
                <div className="h-full rounded-full" style={{ width: `${(m.vendido / max) * 100}%`, background: esActual ? 'var(--series-1)' : 'var(--ramp-2)' }} />
              </div>
              <span className="cifras col-span-2 text-right text-[var(--text-secondary)] sm:col-span-1">
                {m.ventas ? <><strong className="text-[var(--text-primary)]">{fmtDinero(m.vendido, d.moneda)}</strong> · {plural(m.ventas, 'venta')}</> : '—'}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PrimerosPasos({ p, irA, onRegistrarVenta }: {
  p: RespResumen['primeros_pasos']; irA: (t: Tab, nuevo?: boolean) => void; onRegistrarVenta: () => void;
}) {
  const pasos = [
    { hecho: p.cursos > 0, titulo: 'Cargá tus cursos', texto: 'Con su precio: al vender, el monto se completa solo.', accion: 'Agregar curso', ir: () => irA('cursos', true) },
    { hecho: p.metodos > 0, titulo: 'Contanos cómo te pagan', texto: 'Stripe, transferencia…: así se descuenta la comisión de cada cobro.', accion: 'Agregar', ir: () => irA('metodos', true) },
    { hecho: p.equipo > 0, titulo: 'Sumá a tu equipo y su comisión', texto: 'Cada venta calcula sola lo que le toca a cada uno.', accion: 'Sumar', ir: () => irA('equipo', true) },
    { hecho: p.ventas > 0, titulo: 'Registrá tu primera venta', texto: 'Y mirá acá cuánto te queda de verdad.', accion: 'Registrar venta', ir: onRegistrarVenta },
  ];
  const hechos = pasos.filter((x) => x.hecho).length;
  return (
    <section className="tarjeta px-4 py-3.5" aria-label="Primeros pasos">
      <h2 className="text-[15px] font-semibold">Primeros pasos</h2>
      <div className="mt-2"><BarraProgreso valor={hechos} meta={pasos.length} etiqueta={`${hechos} de ${pasos.length} listos`} /></div>
      <ol className="mt-3 space-y-2">
        {pasos.map((x, i) => (
          <li key={x.titulo} className="flex items-center gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
              style={x.hecho ? { background: 'var(--status-good)', color: 'white' } : { background: 'var(--gridline)', color: 'var(--text-secondary)' }} aria-hidden>
              {x.hecho ? '✓' : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className={`text-[13px] font-medium ${x.hecho ? 'text-[var(--text-muted)] line-through' : ''}`}>{x.titulo}</div>
              {!x.hecho && <div className="text-[12px] text-[var(--text-muted)]">{x.texto}</div>}
            </div>
            {!x.hecho && <Boton tamano="sm" variante={i === pasos.findIndex((y) => !y.hecho) ? 'primario' : 'secundario'} onClick={x.ir}>{x.accion}</Boton>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function EsqueletoResumen() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando">
      <div className="grid gap-3 lg:grid-cols-[1.25fr_1fr]">
        <Esqueleto alto={238} className="rounded-xl" />
        <Esqueleto alto={238} className="rounded-xl" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Esqueleto key={i} alto={92} className="rounded-xl" />)}
      </div>
    </div>
  );
}
