import { useEffect, useState } from 'react';
import { api, fmtDinero, fmtFecha, fmtNum, fmtPct } from '../api';
import { Cargando } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';

const TABS = ['Resumen', 'Ventas', 'Cobros', 'Cursos', 'Gastos', 'Métodos', 'Equipo'] as const;
type Tab = typeof TABS[number];
const TIPO_METODO = ['pasarela', 'tarjeta', 'transferencia', 'billetera', 'efectivo', 'crypto', 'otro'];

const CAT_GASTO = ['herramientas', 'ads', 'comisiones_ventas', 'comisiones_pasarela', 'freelancers', 'administracion', 'otros'];
const ESTADO_VENTA = ['activa', 'completada', 'en_cuotas', 'en_mora', 'cancelada', 'reembolsada', 'senado'];
const ESTADO_PAGO = ['pendiente', 'pagado', 'fallido', 'reembolsado', 'reagendado'];

function Tile({ label, valor, color }: { label: string; valor: string; color?: string }) {
  return (
    <div className="tarjeta p-3.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-[20px] font-semibold tracking-tight cifras" style={{ color }}>{valor}</div>
    </div>
  );
}

export default function Finanzas() {
  const [tab, setTab] = useState<Tab>('Resumen');
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [resumen, setResumen] = useState<any>(null);
  const [ventas, setVentas] = useState<any[]>([]);
  const [pagos, setPagos] = useState<any[]>([]);
  const [gastos, setGastos] = useState<any[]>([]);
  const [equipo, setEquipo] = useState<any[]>([]);
  const [productos, setProductos] = useState<any[]>([]);
  const [metodos, setMetodos] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);

  const [nuevaVenta, setNuevaVenta] = useState<any>({ precio_acordado: '', tipo_cobro: 'unico', moneda: 'EUR', comision_closer_pct: 20, comision_setter_pct: 5 });
  const [nuevoGasto, setNuevoGasto] = useState<any>({ descripcion: '', importe: '', categoria: 'herramientas', moneda: 'EUR' });
  const [nuevaPersona, setNuevaPersona] = useState<any>({ nombre: '', rol: 'closer', comision_venta_pct: 20 });
  const [nuevoMetodo, setNuevoMetodo] = useState<any>({ nombre: '', tipo: 'pasarela', comision_pct: 2.9 });
  const [nuevoCurso, setNuevoCurso] = useState<any>({ nombre: '', precio_lista: '', moneda: 'EUR', link_pago: '' });

  async function cargar() {
    const [r, v, p, g, eq, pr, m, l] = await Promise.all([
      api<any>('/finanzas/resumen'),
      api<any[]>('/ventas/detalle'),
      api<any[]>('/pagos'),
      api<any[]>('/gastos'),
      api<any[]>('/equipo'),
      api<any[]>('/productos'),
      api<any[]>('/metodos-pago'),
      api<any[]>('/leads?limite=100').catch(() => []),
    ]);
    setResumen(r); setVentas(v); setPagos(p); setGastos(g);
    setEquipo(eq); setProductos(pr); setMetodos(m);
    setLeads(Array.isArray(l) ? l : (l as any)?.datos ?? []);
    setCargando(false);
  }
  useEffect(() => { cargar(); }, []);

  async function crearVenta(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevaVenta.precio_acordado) { setAviso('Pon el precio acordado.'); return; }
    try {
      await api('/ventas/registrar', { method: 'POST', json: {
        lead_id: nuevaVenta.lead_id || undefined,
        producto_id: nuevaVenta.producto_id || undefined,
        closer_id: nuevaVenta.closer_id || undefined,
        metodo_pago_id: nuevaVenta.metodo_pago_id || undefined,
        tipo_cobro: nuevaVenta.tipo_cobro,
        moneda: nuevaVenta.moneda,
        precio_acordado: Number(nuevaVenta.precio_acordado),
        num_cuotas: nuevaVenta.num_cuotas ? Number(nuevaVenta.num_cuotas) : 1,
        comision_setter_pct: Number(nuevaVenta.comision_setter_pct) || 0,
        comision_closer_pct: Number(nuevaVenta.comision_closer_pct) || 0,
      } });
      setNuevaVenta({ precio_acordado: '', tipo_cobro: 'unico', moneda: 'EUR', comision_closer_pct: 20, comision_setter_pct: 5 });
      setAviso('Venta registrada con sus cuotas y comisión de pasarela.');
      await cargar();
    } catch (err: any) { setAviso(err.message); }
  }
  async function crearGasto(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevoGasto.descripcion || !nuevoGasto.importe) return;
    try {
      await api('/gastos', { method: 'POST', json: { ...nuevoGasto, importe: Number(nuevoGasto.importe) } });
      setNuevoGasto({ descripcion: '', importe: '', categoria: 'herramientas', moneda: 'EUR' });
      await cargar();
    } catch (err: any) { setAviso(err.message); }
  }
  async function crearPersona(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevaPersona.nombre) return;
    try {
      await api('/equipo', { method: 'POST', json: { ...nuevaPersona, comision_venta_pct: Number(nuevaPersona.comision_venta_pct) || 0 } });
      setNuevaPersona({ nombre: '', rol: 'closer', comision_venta_pct: 20 });
      await cargar();
    } catch (err: any) { setAviso(err.message); }
  }
  async function crearCurso(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevoCurso.nombre) return;
    try {
      await api('/productos', { method: 'POST', json: {
        nombre: nuevoCurso.nombre, moneda: nuevoCurso.moneda,
        precio_lista: nuevoCurso.precio_lista ? Number(nuevoCurso.precio_lista) : undefined,
        link_pago: nuevoCurso.link_pago || undefined,
      } });
      setNuevoCurso({ nombre: '', precio_lista: '', moneda: 'EUR', link_pago: '' });
      await cargar();
    } catch (err: any) { setAviso(err.message); }
  }
  async function borrarCurso(id: string) { await api(`/productos/${id}`, { method: 'DELETE' }); await cargar(); }
  async function crearMetodo(e: React.FormEvent) {
    e.preventDefault();
    if (!nuevoMetodo.nombre) return;
    try {
      await api('/metodos-pago', { method: 'POST', json: { ...nuevoMetodo, comision_pct: Number(nuevoMetodo.comision_pct) || 0 } });
      setNuevoMetodo({ nombre: '', tipo: 'pasarela', comision_pct: 2.9 });
      await cargar();
    } catch (err: any) { setAviso(err.message); }
  }
  async function borrarMetodo(id: string) {
    await api(`/metodos-pago/${id}`, { method: 'DELETE' });
    await cargar();
  }
  async function marcarPago(id: string, estado: string) {
    await api(`/pagos/${id}`, { method: 'PATCH', json: { estado, cobrado_en: estado === 'pagado' ? new Date().toISOString().slice(0, 10) : null } });
    await cargar();
  }

  if (cargando) return <Cargando />;
  const inp = 'rounded-md border border-[var(--border-hairline)] bg-transparent px-2.5 py-1.5 text-[12px] outline-none';

  return (
    <div className="px-5 py-5 lg:px-8">
      <Cabecera titulo="Finanzas" subtitulo="Ventas, cobros, comisiones y P&L de tu operación" />

      {aviso && (
        <div className="mt-3 rounded-md px-3 py-2 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>{aviso}</div>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-[12px] ${tab === t ? 'font-medium text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-1)]'}`}
            style={tab === t ? { background: 'var(--series-1)' } : {}}>{t}</button>
        ))}
      </div>

      {tab === 'Resumen' && resumen && (
        <section className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Ingresos comprometidos" valor={fmtDinero(resumen.ingresos_comprometidos)} />
            <Tile label="Cobrado" valor={fmtDinero(resumen.ingresos_cobrados)} color="var(--status-good)" />
            <Tile label="Por cobrar" valor={fmtDinero(resumen.por_cobrar)} />
            <Tile label="En mora" valor={fmtDinero(resumen.en_mora)} color={resumen.en_mora > 0 ? 'var(--status-critical)' : undefined} />
            <Tile label="Comisiones equipo" valor={fmtDinero(resumen.comisiones)} />
            <Tile label="Comisión pasarela" valor={fmtDinero(resumen.comision_pasarela)} />
            <Tile label="Gastos" valor={fmtDinero(resumen.gastos)} color="var(--status-critical)" />
            <Tile label="Neto (cobrado − gastos)" valor={fmtDinero(resumen.neto_cobrado)} color={resumen.neto_cobrado >= 0 ? 'var(--status-good)' : 'var(--status-critical)'} />
          </div>
          <div className="flex flex-wrap gap-6 text-[12px] text-[var(--text-secondary)]">
            <span>Ventas: <strong>{fmtNum(resumen.ventas)}</strong></span>
            <span>Ticket medio: <strong>{fmtDinero(resumen.ticket_medio)}</strong></span>
          </div>
          {resumen.por_mes?.length > 0 && (
            <div className="tarjeta p-3.5">
              <div className="mb-2 text-[13px] font-medium">Ventas por mes</div>
              <div className="space-y-1">
                {resumen.por_mes.map((m: any) => {
                  const max = Math.max(...resumen.por_mes.map((x: any) => Number(x.ventas)));
                  return (
                    <div key={m.mes} className="flex items-center gap-2 text-[12px]">
                      <span className="w-16 text-[var(--text-muted)]">{m.mes}</span>
                      <div className="h-3 rounded" style={{ width: `${max ? (Number(m.ventas) / max) * 70 : 0}%`, minWidth: 2, background: 'var(--series-1)' }} />
                      <span className="cifras">{fmtDinero(m.ventas)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'Ventas' && (
        <section className="mt-4 space-y-3">
          <form onSubmit={crearVenta} className="tarjeta p-3.5">
            <div className="mb-2 text-[13px] font-medium">Registrar venta</div>
            <div className="flex flex-wrap gap-2">
              <select value={nuevaVenta.lead_id ?? ''} onChange={(e) => setNuevaVenta((s: any) => ({ ...s, lead_id: e.target.value || undefined }))} className={inp + ' min-w-[160px]'}>
                <option value="">Lead (opcional)</option>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.nombre ?? l.ig_username ?? l.id.slice(0, 6)}</option>)}
              </select>
              <select value={nuevaVenta.producto_id ?? ''} onChange={(e) => setNuevaVenta((s: any) => ({ ...s, producto_id: e.target.value || undefined }))} className={inp}>
                <option value="">Producto</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <select value={nuevaVenta.closer_id ?? ''} onChange={(e) => setNuevaVenta((s: any) => ({ ...s, closer_id: e.target.value || undefined }))} className={inp}>
                <option value="">Closer</option>
                {equipo.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
              <input type="number" step="0.01" value={nuevaVenta.precio_acordado} onChange={(e) => setNuevaVenta((s: any) => ({ ...s, precio_acordado: e.target.value }))} placeholder="Precio acordado" className={inp + ' w-[130px]'} />
              <select value={nuevaVenta.tipo_cobro} onChange={(e) => setNuevaVenta((s: any) => ({ ...s, tipo_cobro: e.target.value }))} className={inp}>
                <option value="unico">Pago único</option><option value="cuotas">Cuotas</option>
              </select>
              {nuevaVenta.tipo_cobro === 'cuotas' && (
                <input type="number" value={nuevaVenta.num_cuotas ?? ''} onChange={(e) => setNuevaVenta((s: any) => ({ ...s, num_cuotas: e.target.value }))} placeholder="Nº cuotas" className={inp + ' w-[90px]'} />
              )}
              <select value={nuevaVenta.metodo_pago_id ?? ''} onChange={(e) => setNuevaVenta((s: any) => ({ ...s, metodo_pago_id: e.target.value || undefined }))} className={inp} title="Con qué pasarela cobraste">
                <option value="">¿Cómo cobraste?</option>
                {metodos.map((m) => <option key={m.id} value={m.id}>{m.nombre} ({m.comision_pct}%)</option>)}
              </select>
              <input type="number" value={nuevaVenta.comision_closer_pct} onChange={(e) => setNuevaVenta((s: any) => ({ ...s, comision_closer_pct: e.target.value }))} placeholder="% closer" className={inp + ' w-[90px]'} title="% comisión closer" />
              <button type="submit" className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>Registrar</button>
            </div>
          </form>
          <div className="tarjeta overflow-x-auto">
            <table className="w-full min-w-[720px] text-[12px]">
              <thead><tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Fecha</th><th className="px-3 py-2 font-medium">Lead</th>
                <th className="px-3 py-2 font-medium">Producto</th><th className="px-3 py-2 font-medium">Closer</th>
                <th className="px-3 py-2 font-medium">Pasarela</th>
                <th className="px-3 py-2 text-right font-medium">Precio</th><th className="px-3 py-2 text-right font-medium">Comisiones</th>
                <th className="px-3 py-2 text-right font-medium">Neto</th><th className="px-3 py-2 text-right font-medium">Cobrado</th>
                <th className="px-3 py-2 font-medium">Estado</th>
              </tr></thead>
              <tbody>
                {ventas.map((v) => (
                  <tr key={v.id} className="border-b border-[var(--border-hairline)] last:border-0">
                    <td className="px-4 py-2 text-[var(--text-muted)]">{fmtFecha(v.fecha)}</td>
                    <td className="px-3 py-2">{v.lead_nombre ?? (v.ig_username ? '@' + v.ig_username : '—')}</td>
                    <td className="px-3 py-2">{v.producto ?? '—'}</td>
                    <td className="px-3 py-2">{v.closer_nombre ?? '—'}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{v.pasarela ?? '—'}</td>
                    <td className="px-3 py-2 text-right cifras">{fmtDinero(v.precio_acordado, v.moneda)}</td>
                    <td className="px-3 py-2 text-right cifras text-[var(--text-muted)]">{fmtDinero(Number(v.comision_setter) + Number(v.comision_closer), v.moneda)}</td>
                    <td className="px-3 py-2 text-right cifras">{fmtDinero(v.neto, v.moneda)}</td>
                    <td className="px-3 py-2 text-right cifras">{fmtDinero(v.cobrado, v.moneda)} {Number(v.cuotas_total) > 0 && <span className="text-[10px] text-[var(--text-muted)]">({v.cuotas_pagadas}/{v.cuotas_total})</span>}</td>
                    <td className="px-3 py-2">{v.estado}</td>
                  </tr>
                ))}
                {ventas.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-[var(--text-muted)]">Todavía no hay ventas.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'Cobros' && (
        <section className="mt-4">
          <p className="mb-2 text-[12px] text-[var(--text-muted)]">Cuotas y cobros. Marca una cuota como pagada cuando entre el dinero.</p>
          <div className="tarjeta overflow-x-auto">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead><tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Vence</th><th className="px-3 py-2 font-medium">Cuota</th>
                <th className="px-3 py-2 text-right font-medium">Monto</th><th className="px-3 py-2 font-medium">Pasarela</th>
                <th className="px-3 py-2 text-right font-medium">Comisión</th><th className="px-3 py-2 font-medium">Estado</th><th className="px-3 py-2 font-medium">Acción</th>
              </tr></thead>
              <tbody>
                {pagos.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--border-hairline)] last:border-0">
                    <td className="px-4 py-2 text-[var(--text-muted)]">{fmtFecha(p.vence_en)}</td>
                    <td className="px-3 py-2">#{p.num_cuota}</td>
                    <td className="px-3 py-2 text-right cifras">{fmtDinero(p.monto)}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{p.pasarela ?? '—'}</td>
                    <td className="px-3 py-2 text-right cifras text-[var(--text-muted)]">{Number(p.comision_pasarela) > 0 ? fmtDinero(p.comision_pasarela) : '—'}</td>
                    <td className="px-3 py-2">
                      <span style={{ color: p.estado === 'pagado' ? 'var(--status-good)' : p.estado === 'pendiente' && p.vence_en < new Date().toISOString().slice(0, 10) ? 'var(--status-critical)' : undefined }}>{p.estado}</span>
                    </td>
                    <td className="px-3 py-2">
                      <select value={p.estado} onChange={(e) => marcarPago(p.id, e.target.value)} className={inp + ' text-[11px]'}>
                        {ESTADO_PAGO.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
                {pagos.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[var(--text-muted)]">No hay cuotas registradas. Se crean al vender en cuotas.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'Gastos' && (
        <section className="mt-4 space-y-3">
          <form onSubmit={crearGasto} className="tarjeta p-3.5 flex flex-wrap gap-2">
            <input value={nuevoGasto.descripcion} onChange={(e) => setNuevoGasto((s: any) => ({ ...s, descripcion: e.target.value }))} placeholder="Descripción" className={inp + ' min-w-[180px] flex-1'} />
            <select value={nuevoGasto.categoria} onChange={(e) => setNuevoGasto((s: any) => ({ ...s, categoria: e.target.value }))} className={inp}>
              {CAT_GASTO.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
            <input type="number" step="0.01" value={nuevoGasto.importe} onChange={(e) => setNuevoGasto((s: any) => ({ ...s, importe: e.target.value }))} placeholder="Importe" className={inp + ' w-[120px]'} />
            <button type="submit" className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>Añadir gasto</button>
          </form>
          <div className="tarjeta overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead><tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Fecha</th><th className="px-3 py-2 font-medium">Descripción</th>
                <th className="px-3 py-2 font-medium">Categoría</th><th className="px-3 py-2 text-right font-medium">Importe</th>
              </tr></thead>
              <tbody>
                {gastos.map((g) => (
                  <tr key={g.id} className="border-b border-[var(--border-hairline)] last:border-0">
                    <td className="px-4 py-2 text-[var(--text-muted)]">{fmtFecha(g.fecha)}</td>
                    <td className="px-3 py-2">{g.descripcion}</td>
                    <td className="px-3 py-2 text-[var(--text-secondary)]">{(g.categoria ?? '').replace(/_/g, ' ')}</td>
                    <td className="px-3 py-2 text-right cifras">{fmtDinero(g.importe, g.moneda)}</td>
                  </tr>
                ))}
                {gastos.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-[var(--text-muted)]">Sin gastos registrados.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'Cursos' && (
        <section className="mt-4 space-y-3">
          <p className="text-[12px] text-[var(--text-muted)]">
            Tus cursos/mentorías con su precio y <strong>link de pago</strong> (Stripe, Hotmart, Mercado Pago…).
            El link aparece como atajo en el Chat para venta directa de un clic.
          </p>
          <form onSubmit={crearCurso} className="tarjeta p-3.5 flex flex-wrap gap-2 items-end">
            <input value={nuevoCurso.nombre} onChange={(e) => setNuevoCurso((s: any) => ({ ...s, nombre: e.target.value }))} placeholder="Nombre del curso" className={inp + ' min-w-[200px]'} />
            <input type="number" step="0.01" value={nuevoCurso.precio_lista} onChange={(e) => setNuevoCurso((s: any) => ({ ...s, precio_lista: e.target.value }))} placeholder="Precio" className={inp + ' w-[110px]'} />
            <input value={nuevoCurso.link_pago} onChange={(e) => setNuevoCurso((s: any) => ({ ...s, link_pago: e.target.value }))} placeholder="Link de pago (https://…)" className={inp + ' min-w-[220px] flex-1'} />
            <button type="submit" className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>Añadir curso</button>
          </form>
          <div className="grid gap-2 sm:grid-cols-2">
            {productos.map((p) => (
              <div key={p.id} className="tarjeta p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{p.nombre}</div>
                  <div className="truncate text-[11px] text-[var(--text-muted)]">
                    {p.precio_lista ? fmtDinero(p.precio_lista, p.moneda) : 'sin precio'}{p.link_pago ? ' · 💳 con link' : ' · sin link'}
                  </div>
                </div>
                <button onClick={() => borrarCurso(p.id)} className="shrink-0 rounded px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]" style={{ color: 'var(--status-critical)' }}>Borrar</button>
              </div>
            ))}
            {productos.length === 0 && <div className="tarjeta p-6 text-center text-[13px] text-[var(--text-muted)]">Añadí tu primer curso con su link de pago.</div>}
          </div>
        </section>
      )}

      {tab === 'Métodos' && (
        <section className="mt-4 space-y-3">
          <p className="text-[12px] text-[var(--text-muted)]">
            Configurá con qué cobrás y la comisión de cada una. Al registrar una venta eliges la
            pasarela y el CRM calcula sola la comisión (ej.: vendés 1.000 € con Stripe 2,9% → 29 € de comisión).
          </p>
          <form onSubmit={crearMetodo} className="tarjeta p-3.5 flex flex-wrap gap-2 items-end">
            <input value={nuevoMetodo.nombre} onChange={(e) => setNuevoMetodo((s: any) => ({ ...s, nombre: e.target.value }))} placeholder="Nombre (Stripe, PayPal, Kunfupay…)" className={inp + ' min-w-[200px]'} />
            <select value={nuevoMetodo.tipo} onChange={(e) => setNuevoMetodo((s: any) => ({ ...s, tipo: e.target.value }))} className={inp}>
              {TIPO_METODO.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <input type="number" step="0.01" value={nuevoMetodo.comision_pct} onChange={(e) => setNuevoMetodo((s: any) => ({ ...s, comision_pct: e.target.value }))} placeholder="Comisión" className={inp + ' w-[90px]'} />
              <span className="text-[12px] text-[var(--text-muted)]">%</span>
            </div>
            <button type="submit" className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>Añadir</button>
          </form>
          <div className="grid gap-2 sm:grid-cols-2">
            {metodos.map((m) => (
              <div key={m.id} className="tarjeta p-3 flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-medium">{m.nombre}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">{m.tipo} · comisión {m.comision_pct}%</div>
                </div>
                <button onClick={() => borrarMetodo(m.id)} className="rounded px-2 py-1 text-[11px] hover:bg-[var(--page-plane)]" style={{ color: 'var(--status-critical)' }}>Borrar</button>
              </div>
            ))}
            {metodos.length === 0 && <div className="tarjeta p-6 text-center text-[13px] text-[var(--text-muted)]">Añadí tus pasarelas (Stripe, PayPal, Kunfupay, transferencia…) con su comisión.</div>}
          </div>
        </section>
      )}

      {tab === 'Equipo' && (
        <section className="mt-4 space-y-3">
          <form onSubmit={crearPersona} className="tarjeta p-3.5 flex flex-wrap gap-2">
            <input value={nuevaPersona.nombre} onChange={(e) => setNuevaPersona((s: any) => ({ ...s, nombre: e.target.value }))} placeholder="Nombre" className={inp + ' min-w-[160px]'} />
            <select value={nuevaPersona.rol} onChange={(e) => setNuevaPersona((s: any) => ({ ...s, rol: e.target.value }))} className={inp}>
              <option value="closer">Closer</option><option value="setter">Setter</option>
              <option value="closer_setter">Closer + Setter</option><option value="team_lead">Team lead</option>
            </select>
            <input type="number" value={nuevaPersona.comision_venta_pct} onChange={(e) => setNuevaPersona((s: any) => ({ ...s, comision_venta_pct: e.target.value }))} placeholder="% venta" className={inp + ' w-[100px]'} />
            <button type="submit" className="rounded-md px-3 py-1.5 text-[12px] font-medium text-white" style={{ background: 'var(--series-1)' }}>Añadir</button>
          </form>
          <div className="grid gap-2 sm:grid-cols-2">
            {equipo.map((p) => (
              <div key={p.id} className="tarjeta p-3 flex items-center justify-between">
                <div><div className="text-[13px] font-medium">{p.nombre}</div><div className="text-[11px] text-[var(--text-muted)]">{p.rol}</div></div>
                <div className="text-[12px] text-[var(--text-secondary)]">{fmtPct(p.comision_venta_pct)} venta</div>
              </div>
            ))}
            {equipo.length === 0 && <div className="tarjeta p-6 text-center text-[13px] text-[var(--text-muted)]">Añade tus closers y setters.</div>}
          </div>
        </section>
      )}
    </div>
  );
}
