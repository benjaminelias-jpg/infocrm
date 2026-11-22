import { useEffect, useState } from 'react';
import { api, plural } from '../../api';
import {
  AreaTexto, Ayuda, BarraProgreso, Boton, BotonConfirmar, Campo, Dialogo, ErrorCarga, Esqueleto, IdentidadLead, ItemMenu,
  SeparadorMenu, nombreVisible, useAviso, useCarga,
} from '../../ui';
import { BuscadorLead, type LeadElegido } from './BuscadorLead';
import { CampoCurso, CampoMetodo, CampoPersona, cierra, consigue, type ContextoVenta } from './CamposVenta';
import {
  EntradaDinero, Estado, MenuPuntos, Origen, SelectorFecha, fechaCorta, fmtDineroExacto, montoEnCampo, parseMonto, pctTexto,
  vencimientoTexto,
} from './comun';
import type { Cobro, VentaDetalle } from './tipos';

// Una venta abierta (?venta=<id>: Atrás la cierra). Se ve quién compró, qué,
// quién la cerró, cómo pagó y sus cuotas; desde acá se corrige, se devuelve,
// se cancela o se borra (si se cargó por error).

type Modo = 'ver' | 'editar' | 'devolver' | 'cancelar' | 'borrar';
const DEBE = ['pendiente', 'reagendado', 'fallido'];
const pctEnCampo = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: false }).format(Number(n ?? 0));

export function DetalleVenta({ id, onCerrar, onCambio, onFicha }: {
  id: string; onCerrar: () => void; onCambio: () => void; onFicha: (leadId: string) => void;
}) {
  const aviso = useAviso();
  const carga = useCarga(() => api<VentaDetalle>(`/ux/finanzas/ventas/${id}`), [id]);
  const [modo, setModo] = useState<Modo>('ver');
  const [ocupado, setOcupado] = useState(false);
  const v = carga.datos;
  const muerta = Boolean(v && ['cancelada', 'reembolsada'].includes(v.estado));

  async function cambiarEstado(estado: 'reembolsada' | 'cancelada' | 'activa', texto: string) {
    setOcupado(true);
    try {
      await api(`/ventas/${id}`, { method: 'PATCH', json: { estado } });
      await carga.recargar(true);
      onCambio();
      aviso.exito(texto);
      setModo('ver');
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(false); }
  }

  async function borrar() {
    try {
      await api(`/ventas/${id}`, { method: 'DELETE' });
      onCambio();
      aviso.exito('Venta borrada: ya no cuenta en Finanzas ni en el Panel.');
      onCerrar();
    } catch (e: any) { aviso.error(e.message); }
  }

  async function cuota(p: Cobro, accion: 'cobrar' | 'pendiente') {
    try {
      await api(`/ux/finanzas/cobros/${p.id}`, { method: 'POST', json: { accion } });
      await carga.recargar(true);
      onCambio();
      if (accion === 'cobrar') aviso.exito(`Cuota ${p.num_cuota} cobrada ✓`, { texto: 'Deshacer', onClick: () => cuota(p, 'pendiente') });
    } catch (e: any) { aviso.error(e.message); }
  }

  const quien = v ? (v.lead_id ? nombreVisible(v.lead_nombre, v.ig_username) : null) : null;
  const titulo = modo === 'editar' ? 'Corregir la venta' : v ? (quien ? `Venta a ${quien}` : 'Venta sin lead') : 'Venta';

  let pie: React.ReactNode = null;
  if (v && modo === 'ver') {
    // Cada botón con su key: si React reusara el mismo <button> al cambiar de modo, el
    // toque en "Corregir" terminaría enviando el formulario (el botón pasa a ser "submit").
    pie = <>
      <div key="menu" className="mr-auto">
        <MenuPuntos etiqueta="Más opciones de la venta">
          {!muerta && <ItemMenu onClick={() => setModo('devolver')} descripcion="Le devolviste la plata">Marcar como devuelta</ItemMenu>}
          {!muerta && <ItemMenu onClick={() => setModo('cancelar')} descripcion="Se cayó: no se va a cobrar">Cancelar la venta</ItemMenu>}
          {v.estado === 'cancelada' && <ItemMenu onClick={() => cambiarEstado('activa', 'Venta reactivada: vuelve a contar en Finanzas y en el Panel.')}>Reactivar la venta</ItemMenu>}
          <SeparadorMenu />
          <ItemMenu peligro onClick={() => setModo('borrar')} descripcion="La cargaste por error">Borrar</ItemMenu>
        </MenuPuntos>
      </div>
      <Boton key="corregir" onClick={() => setModo('editar')}>Corregir</Boton>
    </>;
  } else if (v && modo === 'editar') {
    pie = <>
      <Boton key="cancelar-edicion" variante="fantasma" onClick={() => setModo('ver')}>Cancelar</Boton>
      <Boton key="guardar" variante="primario" type="submit" form="form-corregir-venta" cargando={ocupado}>Guardar cambios</Boton>
    </>;
  } else if (v && modo !== 'ver') {
    pie = <>
      <Boton key="volver" variante="fantasma" onClick={() => setModo('ver')}>Volver</Boton>
      {modo === 'devolver' && <Boton key="devolver" variante="peligro" cargando={ocupado} onClick={() => cambiarEstado('reembolsada', 'Venta marcada como devuelta: ya no suma en el Panel ni en tus números.')}>Marcar como devuelta</Boton>}
      {modo === 'cancelar' && <Boton key="cancelar" variante="peligro" cargando={ocupado} onClick={() => cambiarEstado('cancelada', 'Venta cancelada: sale del Panel y sus cuotas ya no se cobran.')}>Cancelar la venta</Boton>}
      {modo === 'borrar' && <BotonConfirmar key="borrar" variante="peligro" tamano="md" onConfirmar={borrar}>Borrar la venta</BotonConfirmar>}
    </>;
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} ancho={540} autoFoco={false} titulo={titulo}
      descripcion={v && modo !== 'editar' ? `${v.producto ?? 'Sin curso'} · ${fechaCorta(v.fecha)}` : undefined} pie={pie}>
      {carga.error && !v ? (
        <ErrorCarga compacto error={carga.error} titulo="No pudimos abrir la venta" onReintentar={() => carga.recargar()} />
      ) : !v ? (
        <div className="space-y-3" aria-busy="true" aria-label="Cargando">
          <Esqueleto alto={40} /><Esqueleto alto={96} /><Esqueleto alto={120} />
        </div>
      ) : modo === 'editar' ? (
        <Corregir v={v} setOcupado={setOcupado}
          onGuardada={(nueva) => {
            setModo('ver');
            if (!nueva) return;
            carga.setDatos(nueva); onCambio(); aviso.exito('Venta corregida (también en el Panel).');
          }} />
      ) : modo === 'ver' ? (
        <Ver v={v} muerta={muerta} onFicha={onFicha} onCobrar={(p) => cuota(p, 'cobrar')} />
      ) : (
        <Confirmar modo={modo} v={v} />
      )}
    </Dialogo>
  );
}

function Dato({ etiqueta, children, ayuda }: { etiqueta: string; children: React.ReactNode; ayuda?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">{etiqueta}{ayuda && <Ayuda titulo={etiqueta}>{ayuda}</Ayuda>}</dt>
      <dd className="mt-0.5 truncate text-[13px]">{children}</dd>
    </div>
  );
}

function Ver({ v, muerta, onFicha, onCobrar }: { v: VentaDetalle; muerta: boolean; onFicha: (id: string) => void; onCobrar: (p: Cobro) => void }) {
  const n = v.pagos.length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {v.lead_id
          ? <IdentidadLead tam="md" id={v.lead_id} nombre={v.lead_nombre} usuario={v.ig_username} foto={v.avatar_url} onClick={() => onFicha(v.lead_id!)} />
          : <span className="text-[13px] text-[var(--text-muted)]">Sin lead: no cuenta en el Panel. Corregila para elegirlo.</span>}
        <div className="flex flex-wrap gap-1.5"><Estado tipo="venta" valor={v.estado_visible} /><Origen origen={v.origen} /></div>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl px-3.5 py-3" style={{ background: 'var(--page-plane)' }}>
        <Dato etiqueta="Precio"><span className="cifras font-semibold">{fmtDineroExacto(v.precio_acordado, v.moneda)}</span></Dato>
        <Dato etiqueta="Te queda" ayuda="El precio menos lo que se lleva la pasarela y las comisiones del equipo. Es la misma cuenta del Resumen.">
          <span className="cifras font-semibold" style={{ color: muerta ? undefined : 'var(--status-good)' }}>{muerta ? '—' : fmtDineroExacto(v.te_queda, v.moneda)}</span>
        </Dato>
        <Dato etiqueta="Cerró">{v.closer_nombre ? `${v.closer_nombre} · ${pctTexto(v.comision_closer_pct)} = ${fmtDineroExacto(v.comision_closer, v.moneda)}` : '—'}</Dato>
        <Dato etiqueta="Setter">{v.setter_nombre ? `${v.setter_nombre} · ${pctTexto(v.comision_setter_pct)} = ${fmtDineroExacto(v.comision_setter, v.moneda)}` : '—'}</Dato>
        <Dato etiqueta="Cómo pagó">{v.pasarela ? `${v.pasarela}${v.metodo_pct ? ` · ${pctTexto(v.metodo_pct)}` : ''}` : '—'}</Dato>
        <Dato etiqueta="Comisión de cobro">{fmtDineroExacto(v.comision_cobro, v.moneda)}</Dato>
      </dl>

      {n > 0 && (
        <div>
          <BarraProgreso valor={v.cobrado} meta={v.precio_acordado}
            etiqueta={n > 1 ? `${v.cuotas_pagadas} de ${plural(n, 'cuota')} cobradas` : v.cuotas_pagadas ? 'Cobrada' : 'Todavía no se cobró'}
            detalle={`${fmtDineroExacto(v.cobrado, v.moneda)} de ${fmtDineroExacto(v.precio_acordado, v.moneda)}`} />
          <ul className="mt-2.5 divide-y divide-[var(--border-hairline)] rounded-xl border border-[var(--border-hairline)]">
            {v.pagos.map((p) => {
              const debe = DEBE.includes(p.estado);
              const atrasada = debe && p.vence_en && p.vence_en < v.hoy;
              return (
                <li key={p.id} className="flex items-center gap-2.5 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px]">{n > 1 ? `Cuota ${p.num_cuota} de ${n}` : 'Pago único'} · <span className="cifras font-medium">{fmtDineroExacto(p.monto, v.moneda)}</span></div>
                    <div className="text-[11px]" style={{ color: atrasada ? 'var(--status-critical)' : 'var(--text-muted)' }}>
                      {p.estado === 'pagado' ? `Cobrada el ${fechaCorta(p.cobrado_en ?? p.vence_en)}` : debe ? vencimientoTexto(p.vence_en, v.hoy) : fechaCorta(p.vence_en)}
                    </div>
                  </div>
                  <Estado tipo="pago" valor={atrasada ? 'atrasada' : p.estado} />
                  {debe && !muerta && <Boton tamano="sm" variante="exito" onClick={() => onCobrar(p)}>Cobrada ✓</Boton>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {v.notas && <p className="whitespace-pre-line rounded-lg px-3 py-2 text-[12px] text-[var(--text-secondary)]" style={{ background: 'var(--page-plane)' }}>{v.notas}</p>}
    </div>
  );
}

function Confirmar({ modo, v }: { modo: Modo; v: VentaDetalle }) {
  const textos: Record<string, { t: string; d: string }> = {
    devolver: { t: 'Marcar como devuelta', d: `Le devolviste la plata a ${nombreVisible(v.lead_nombre, v.ig_username)}. La venta se descuenta del Panel y de tus números, y lo cobrado queda como devuelto. No se puede deshacer.` },
    cancelar: { t: 'Cancelar la venta', d: 'La venta se cayó y no se va a cobrar. Sale del Panel y sus cuotas pendientes dejan de contar como plata que te deben. Después la podés reactivar.' },
    borrar: { t: 'Borrar la venta', d: 'Solo si la cargaste por error: se borra con sus cuotas y sale del Panel. No se puede deshacer. Si la venta existió y se cayó, mejor cancelala.' },
  };
  const x = textos[modo];
  return (
    <div className="space-y-2 py-1">
      <div className="text-[14px] font-semibold">{x.t}</div>
      <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">{x.d}</p>
      <p className="text-[12px] text-[var(--text-muted)]">{fmtDineroExacto(v.precio_acordado, v.moneda)} · {v.producto ?? 'sin curso'} · {fechaCorta(v.fecha)}</p>
    </div>
  );
}

function Corregir({ v, onGuardada, setOcupado }: {
  v: VentaDetalle; onGuardada: (nueva: VentaDetalle | null) => void; setOcupado: (b: boolean) => void;
}) {
  const aviso = useAviso();
  const muerta = ['cancelada', 'reembolsada'].includes(v.estado);
  const [ctx, setCtx] = useState<ContextoVenta | null>(null);
  const [lead, setLead] = useState<LeadElegido | null>(v.lead_id ? { id: v.lead_id, nombre: v.lead_nombre, ig_username: v.ig_username, avatar_url: v.avatar_url } : null);
  const [productoId, setProductoId] = useState(v.producto_id ?? '');
  const [monto, setMonto] = useState(montoEnCampo(v.precio_acordado));
  const [metodoId, setMetodoId] = useState(v.metodo_pago_id ?? '');
  const [closerId, setCloserId] = useState(v.closer_id ?? '');
  const [pctCloser, setPctCloser] = useState(pctEnCampo(v.comision_closer_pct));
  const [setterId, setSetterId] = useState(v.setter_id ?? '');
  const [pctSetter, setPctSetter] = useState(pctEnCampo(v.comision_setter_pct));
  const [fecha, setFecha] = useState(v.fecha);
  const [notas, setNotas] = useState(v.notas ?? '');

  useEffect(() => {
    api<ContextoVenta>('/ux/finanzas/contexto-venta').then(setCtx).catch((e) => aviso.error(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const importe = parseMonto(monto);
  // Las personas de baja que ya figuran en la venta también se muestran.
  const equipo = ctx?.equipo ?? [];
  const conActual = (lista: typeof equipo, id: string | null, nombre: string | null) =>
    id && !lista.some((p) => p.id === id) ? [...lista, { id, nombre: nombre ?? 'De baja', rol: 'closer', comision_venta_pct: 0 }] : lista;
  const closers = conActual(equipo.filter(cierra), v.closer_id, v.closer_nombre);
  const setters = conActual(equipo.filter((p) => consigue(p) && p.id !== closerId), v.setter_id, v.setter_nombre);
  const pctDe = (id: string) => pctEnCampo(equipo.find((p) => p.id === id)?.comision_venta_pct ?? 0);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const c: Record<string, any> = {};
    if ((lead?.id ?? null) !== (v.lead_id ?? null)) c.lead_id = lead?.id ?? null;
    if (productoId !== (v.producto_id ?? '')) c.producto_id = productoId || null;
    if (!muerta && Number.isFinite(importe) && Math.abs(importe - Number(v.precio_acordado)) > 0.004) c.precio_acordado = importe;
    if (metodoId !== (v.metodo_pago_id ?? '')) c.metodo_pago_id = metodoId || null;
    if (closerId !== (v.closer_id ?? '')) c.closer_id = closerId || null;
    if (closerId && parseMonto(pctCloser) !== Number(v.comision_closer_pct)) c.comision_closer_pct = parseMonto(pctCloser) || 0;
    if (setterId !== (v.setter_id ?? '')) c.setter_id = setterId || null;
    if (setterId && parseMonto(pctSetter) !== Number(v.comision_setter_pct)) c.comision_setter_pct = parseMonto(pctSetter) || 0;
    if (fecha !== v.fecha) c.fecha = fecha;
    if (notas.trim() !== (v.notas ?? '')) c.notas = notas.trim() || null;
    if (!Object.keys(c).length) { onGuardada(null); return; }
    setOcupado(true);
    try {
      onGuardada(await api<VentaDetalle>(`/ux/finanzas/ventas/${v.id}`, { method: 'PATCH', json: c }));
    } catch (err: any) { aviso.error(err.message); } finally { setOcupado(false); }
  }

  return (
    <form noValidate id="form-corregir-venta" onSubmit={guardar} className="space-y-4">
      <Campo etiqueta="¿Quién compró?" ayuda={!lead ? 'Elegí el lead para que la venta cuente en el Panel.' : undefined}>
        <BuscadorLead valor={lead} onElegir={setLead} />
      </Campo>
      <CampoCurso id="corregir-curso" productos={ctx?.productos ?? []} valor={productoId} onElegir={setProductoId} moneda={v.moneda}
        onCreado={(p) => { setCtx((x) => (x ? { ...x, productos: [...x.productos, p] } : x)); setProductoId(p.id); }} />
      <Campo etiqueta="Monto" htmlFor="corregir-monto"
        ayuda={muerta ? 'Está cancelada o devuelta: el monto ya no se cambia.' : v.cobrado > 0 ? `Ya te pagó ${fmtDineroExacto(v.cobrado, v.moneda)}: lo que cambies se reparte en las cuotas que faltan.` : undefined}
        error={monto && !(importe > 0) ? 'Escribí un monto mayor a 0' : importe + 0.004 < v.cobrado ? 'Ya te pagó más que eso' : undefined}>
        <EntradaDinero id="corregir-monto" valor={monto} onCambiar={setMonto} moneda={v.moneda} disabled={muerta} />
      </Campo>
      <CampoMetodo metodos={ctx?.metodos ?? []} valor={metodoId} onElegir={setMetodoId}
        onCreado={(m) => { setCtx((x) => (x ? { ...x, metodos: [...x.metodos, m] } : x)); setMetodoId(m.id); }} />
      {(closers.length > 0 || setters.length > 0) && (
        <>
          <CampoPersona etiqueta="¿Quién la cerró?" id="corregir-closer" personas={closers} valor={closerId} nadie="Nadie / no sé"
            onElegir={(id) => { setCloserId(id); setPctCloser(pctDe(id)); if (id === setterId) setSetterId(''); }}
            pct={pctCloser} onPct={setPctCloser} importe={importe > 0 ? importe : 0} moneda={v.moneda} />
          <CampoPersona etiqueta="¿Hubo setter?" id="corregir-setter" personas={setters} valor={setterId} nadie="Sin setter"
            onElegir={(id) => { setSetterId(id); setPctSetter(pctDe(id)); }}
            pct={pctSetter} onPct={setPctSetter} importe={importe > 0 ? importe : 0} moneda={v.moneda} />
        </>
      )}
      <div>
        <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Fecha de la venta</div>
        <SelectorFecha valor={fecha} onCambiar={setFecha} tipo="pasado" />
      </div>
      <Campo etiqueta="Nota" htmlFor="corregir-nota">
        <AreaTexto id="corregir-nota" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} maxLength={2000} />
      </Campo>
    </form>
  );
}
