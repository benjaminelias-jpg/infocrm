import { useState } from 'react';
import { api, fmtDinero, plural } from '../../api';
import {
  Boton, BotonFlotante, Desplegable, Dialogo, ErrorCarga, Esqueleto, FilaDeslizable, IdentidadLead, Insignia, ItemMenu,
  ListaDesplegable, TituloSeccion, Vacio, nombreVisible, useAviso, useCarga, useEsMovil,
} from '../../ui';
import { useFicha } from '../useFicha';
import {
  Estado, MenuPuntos, SelectorFecha, diasEntre, fechaCorta, fmtDineroExacto, hoyISO, sumarDias, vencimientoTexto,
} from './comun';
import type { Cobro, PropsPestana, RespCobros } from './tipos';

// Cobros: quién te debe y cuándo. Lo urgente arriba (Atrasadas, Esta
// semana, Más adelante) y lo ya cobrado plegado. Cada cuota dice de quién es;
// "Cobrada ✓" con un toque (o deslizando en el celular) y se puede deshacer.

const DEBE = ['pendiente', 'reagendado', 'fallido'];
const quien = (p: Cobro) => (p.lead_id ? (p.ig_username ? `@${p.ig_username}` : nombreVisible(p.lead_nombre, null)) : 'la venta sin lead');
const suma = (xs: Cobro[]) => xs.reduce((s, p) => s + Number(p.monto), 0);

/** Pone la cuota actualizada en su lista (por cobrar o cobradas). */
function ubicar(d: RespCobros, nueva: Cobro): RespCobros {
  const sin = (xs: Cobro[]) => xs.filter((x) => x.id !== nueva.id);
  if (DEBE.includes(nueva.estado)) {
    const pendientes = [...sin(d.pendientes), nueva].sort((a, b) => (a.vence_en ?? '9999').localeCompare(b.vence_en ?? '9999') || a.num_cuota - b.num_cuota);
    return { ...d, pendientes, cobradas: sin(d.cobradas) };
  }
  return { ...d, pendientes: sin(d.pendientes), cobradas: [nueva, ...sin(d.cobradas)] };
}

export default function Cobros({ version, onCambio, onRegistrarVenta, abrirVenta }: PropsPestana) {
  const aviso = useAviso();
  const ficha = useFicha();
  const movil = useEsMovil(768);
  const carga = useCarga(() => api<RespCobros>('/ux/finanzas/cobros'), [version]);
  const [reprogramar, setReprogramar] = useState<Cobro | null>(null);
  const d = carga.datos;

  async function accion(p: Cobro, que: 'cobrar' | 'pendiente' | 'fallido' | 'reprogramar', fecha?: string) {
    try {
      const nueva = await api<Cobro>(`/ux/finanzas/cobros/${p.id}`, { method: 'POST', json: { accion: que, fecha } });
      carga.setDatos((x) => (x ? ubicar(x, nueva) : x));
      onCambio();
      if (que === 'cobrar') aviso.exito(`Cuota de ${quien(p)} cobrada ✓`, { texto: 'Deshacer', onClick: () => accion(nueva, 'pendiente') });
      if (que === 'pendiente') aviso.info(`La cuota de ${quien(p)} volvió a «por cobrar».`);
      if (que === 'fallido') aviso.info(`Anotado: el pago de ${quien(p)} no pasó. Sigue en «por cobrar».`);
      if (que === 'reprogramar') aviso.exito(`Cuota de ${quien(p)} reprogramada para el ${fechaCorta(nueva.vence_en)}.`);
    } catch (e: any) { aviso.error(e.message); }
  }

  if (carga.error && !d) return <div className="tarjeta"><ErrorCarga error={carga.error} titulo="No pudimos cargar tus cobros" onReintentar={() => carga.recargar()} /></div>;
  if (!d) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Cargando">
        <Esqueleto alto={40} ancho={220} />
        {[0, 1, 2, 3].map((i) => <Esqueleto key={i} alto={64} className="rounded-xl" />)}
      </div>
    );
  }

  const hoy = d.hoy || hoyISO();
  const atrasadas = d.pendientes.filter((p) => p.vence_en && p.vence_en < hoy);
  const semana = d.pendientes.filter((p) => p.vence_en && p.vence_en >= hoy && diasEntre(hoy, p.vence_en) <= 7);
  const despues = d.pendientes.filter((p) => !p.vence_en || diasEntre(hoy, p.vence_en) > 7);
  const total = suma(d.pendientes);

  const fila = (p: Cobro) => (
    <FilaCobro key={p.id} p={p} hoy={hoy} movil={movil}
      onCobrar={() => accion(p, 'cobrar')} onDeshacer={() => accion(p, 'pendiente')}
      onReprogramar={() => setReprogramar(p)} onFallido={() => accion(p, 'fallido')}
      onVerVenta={() => abrirVenta(p.venta_id)} onFicha={(id) => ficha.abrir(id)} />
  );
  const grupo = (clave: string, titulo: string, xs: Cobro[], tono: 'rojo' | 'azul' | 'neutro', abierto = true) => xs.length > 0 && (
    <Desplegable key={clave} clave={`fin-cobros-${clave}`} abiertoInicial={abierto}
      titulo={<span className="flex items-center gap-2">{titulo}<Insignia tono={tono}>{xs.length}</Insignia></span>}
      subtitulo={<span className="cifras" style={tono === 'rojo' ? { color: 'var(--status-critical)' } : undefined}>{fmtDineroExacto(suma(xs), d.moneda)}</span>}>
      <div role="list" className="-mx-3.5 -mb-3.5 divide-y divide-[var(--border-hairline)] overflow-hidden rounded-b-xl border-t border-[var(--border-hairline)]">
        {xs.map(fila)}
      </div>
    </Desplegable>
  );

  return (
    <section className="space-y-3 pb-20 md:pb-0" aria-label="Cobros">
      <TituloSeccion titulo="Te deben" onMas={onRegistrarVenta} textoMas="Registrar venta"
        subtitulo={d.pendientes.length
          ? <>{fmtDinero(total, d.moneda)} en {plural(d.pendientes.length, 'cuota')}{atrasadas.length ? <span style={{ color: 'var(--status-critical)' }}> · {fmtDinero(suma(atrasadas), d.moneda)} atrasado</span> : ' · nada atrasado'}</>
          : 'Nadie te debe nada'} />

      {d.pendientes.length === 0 && d.cobradas.length === 0 ? (
        <div className="tarjeta">
          <Vacio icono="📅" titulo="Todavía no hay cobros"
            texto="Cuando vendas en cuotas o te queden pagos por cobrar, acá vas a ver quién te debe, cuánto y cuándo vence."
            accion={<Boton variante="primario" onClick={onRegistrarVenta}>Registrar venta</Boton>} />
        </div>
      ) : (
        <div className="space-y-2.5">
          {d.pendientes.length === 0 && (
            <div className="tarjeta"><Vacio compacto icono="✅" titulo="Nadie te debe nada" texto="Todas las cuotas están cobradas." /></div>
          )}
          {grupo('atrasadas', 'Atrasadas', atrasadas, 'rojo')}
          {grupo('semana', 'Esta semana', semana, 'azul')}
          {grupo('despues', 'Más adelante', despues, 'neutro')}
          {d.cobradas.length > 0 && (
            <Desplegable clave="fin-cobros-cobradas" abiertoInicial={false}
              titulo={<span className="flex items-center gap-2">Ya cobradas<Insignia tono="verde">{d.cobradas.length}</Insignia></span>}
              subtitulo="Las últimas que entraron">
              <div role="list" className="-mx-3.5 -mb-3.5 divide-y divide-[var(--border-hairline)] overflow-hidden rounded-b-xl border-t border-[var(--border-hairline)]">
                <ListaDesplegable items={d.cobradas} inicial={10} textoMas="Ver más" render={fila} />
              </div>
            </Desplegable>
          )}
        </div>
      )}

      {reprogramar && <Reprogramar p={reprogramar} onCerrar={() => setReprogramar(null)}
        onGuardar={async (f) => { await accion(reprogramar, 'reprogramar', f); setReprogramar(null); }} />}
      <BotonFlotante etiqueta="Registrar venta" onClick={onRegistrarVenta} />
    </section>
  );
}

function FilaCobro({ p, hoy, movil, onCobrar, onDeshacer, onReprogramar, onFallido, onVerVenta, onFicha }: {
  p: Cobro; hoy: string; movil: boolean; onCobrar: () => void; onDeshacer: () => void; onReprogramar: () => void;
  onFallido: () => void; onVerVenta: () => void; onFicha: (leadId: string) => void;
}) {
  const debe = DEBE.includes(p.estado);
  const atrasada = debe && Boolean(p.vence_en && p.vence_en < hoy);
  const cuando = debe ? vencimientoTexto(p.vence_en, hoy) : `cobrada el ${fechaCorta(p.cobrado_en ?? p.vence_en)}`;
  const cuota = p.cuotas_total > 1 ? `cuota ${p.num_cuota} de ${p.cuotas_total}` : null;
  const sub = [p.producto, cuota, cuando].filter(Boolean).join(' · ');
  // En el celular lo urgente va primero (si no entra, se corta el curso, nunca el "venció hace…").
  const marcaTexto = p.estado === 'fallido' ? 'No pasó' : p.estado === 'reagendado' ? 'Reprogramada' : p.estado === 'reembolsado' ? 'Devuelta' : null;
  const subMovil = [marcaTexto, cuando, cuota, p.producto].filter(Boolean).join(' · ');
  const quienEs = p.lead_id
    ? <IdentidadLead id={p.lead_id} nombre={p.lead_nombre} usuario={p.ig_username} foto={p.avatar_url} onClick={() => onFicha(p.lead_id!)} className="min-w-0 max-w-full" />
    : <span className="text-[13px] font-medium text-[var(--text-secondary)]">Venta sin lead</span>;
  const monto = (
    <span className="cifras whitespace-nowrap text-[14px] font-semibold" style={atrasada ? { color: 'var(--status-critical)' } : undefined}>
      {fmtDineroExacto(p.monto, p.moneda)}
    </span>
  );
  const marca = p.estado === 'reagendado' || p.estado === 'fallido' || p.estado === 'reembolsado' ? <Estado tipo="pago" valor={p.estado} /> : null;
  const menu = (
    <MenuPuntos etiqueta="Más opciones de la cuota">
      {debe && <ItemMenu onClick={onReprogramar}>Reprogramar…</ItemMenu>}
      {debe && p.estado !== 'fallido' && <ItemMenu onClick={onFallido} descripcion="Sigue en «por cobrar»">No pasó el pago</ItemMenu>}
      {p.estado === 'pagado' && <ItemMenu onClick={onDeshacer}>Marcar como por cobrar</ItemMenu>}
      <ItemMenu onClick={onVerVenta}>Ver la venta</ItemMenu>
    </MenuPuntos>
  );
  const boton = debe ? <Boton variante="exito" tamano={movil ? 'md' : 'sm'} onClick={onCobrar} className="shrink-0">Cobrada ✓</Boton> : null;

  if (!movil) {
    return (
      <div role="listitem" className="flex items-center gap-3 px-3.5 py-2" style={{ background: 'var(--surface-1)' }}>
        <div className="w-[230px] min-w-0 shrink-0">{quienEs}</div>
        <div className="min-w-0 flex-1 truncate text-[12px]" style={{ color: atrasada ? 'var(--status-critical)' : 'var(--text-muted)' }}>{sub}</div>
        {marca}
        {monto}
        <div className="flex w-[118px] shrink-0 justify-end">{boton}</div>
        {menu}
      </div>
    );
  }
  const acciones = debe
    ? [{ etiqueta: 'Cobrada', icono: '✓', color: 'var(--status-good)', onClick: onCobrar },
      { etiqueta: 'Reprogramar', icono: '↻', color: 'var(--series-1)', onClick: onReprogramar }]
    // Una cuota devuelta ya no vuelve a "por cobrar" (la venta está devuelta).
    : p.estado === 'pagado' ? [{ etiqueta: 'Deshacer', icono: '↶', color: 'var(--text-secondary)', onClick: onDeshacer }] : [];
  return (
    <div role="listitem">
      <FilaDeslizable acciones={acciones}>
        <div className="px-3.5 py-2.5" style={{ background: 'var(--surface-1)' }}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{quienEs}</div>
            {monto}
          </div>
          <div className="mt-1 flex items-center gap-2 pl-10">
            <span className="min-w-0 flex-1 truncate text-[12px] first-letter:uppercase"
              style={{ color: atrasada || p.estado === 'fallido' ? 'var(--status-critical)' : 'var(--text-muted)' }}>{subMovil}</span>
            {boton}
            {menu}
          </div>
        </div>
      </FilaDeslizable>
    </div>
  );
}

function Reprogramar({ p, onCerrar, onGuardar }: { p: Cobro; onCerrar: () => void; onGuardar: (fecha: string) => Promise<void> }) {
  const [fecha, setFecha] = useState(() => sumarDias(hoyISO(), 7));
  const [ocupado, setOcupado] = useState(false);
  return (
    <Dialogo abierto onCerrar={onCerrar} titulo="Reprogramar la cuota" autoFoco={false}
      descripcion={`${quien(p)} · ${fmtDineroExacto(p.monto, p.moneda)}${p.vence_en ? ` · vencía el ${fechaCorta(p.vence_en)}` : ''}`}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" cargando={ocupado} onClick={async () => { setOcupado(true); try { await onGuardar(fecha); } finally { setOcupado(false); } }}>
          Pasar al {fechaCorta(fecha)}
        </Boton>
      </>}>
      <div className="space-y-2 pb-1">
        <div className="text-[12px] font-medium text-[var(--text-secondary)]">¿Cuándo te la paga?</div>
        <SelectorFecha valor={fecha} onCambiar={setFecha} tipo="futuro" />
      </div>
    </Dialogo>
  );
}
