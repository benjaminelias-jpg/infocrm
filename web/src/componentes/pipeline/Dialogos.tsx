import { useEffect, useRef, useState } from 'react';
import { api, fmtDinero } from '../../api';
import {
  AreaTexto, Banner, Boton, Campo, Chip, Desplegable, Dialogo, Entrada, FilaChips, Interruptor, useAviso,
} from '../../ui';
import { BuscadorLead, type LeadElegido } from '../finanzas/BuscadorLead';
import {
  CampoCurso, CampoMetodo, CampoPersona, cierra, consigue, type ContextoVenta, type Persona, type Producto,
} from '../finanzas/CamposVenta';
import {
  EntradaDinero, SelectorFecha, fechaCorta, fmtDineroExacto, hoyISO, montoEnCampo, parseMonto, repartir,
  sumarDias, sumarMeses,
} from '../finanzas/comun';

// Diálogos del tablero al soltar una tarjeta en una etapa de cierre:
//  - Venta: registra la venta de verdad (Finanzas + Panel + reglas) y la mueve.
//  - Perdido: pregunta por qué (para aprender de las pérdidas) y la mueve.
// DialogoVenta es EL formulario de venta de toda la app: también lo abren el
// Chat y Finanzas ("Registrar venta", sin tarjeta ni etapa: busca el lead).

type Pago = 'todo' | 'parte' | 'nada';

const pctEnCampo = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: false }).format(Number(n ?? 0));

export function DialogoVenta({ tarjeta, etapa, onCerrar, onListo, titulo }: {
  tarjeta: any; etapa?: { id: string; nombre: string } | null;
  onCerrar: () => void;
  /** registrada=false → "Solo moverlo". `venta`: la venta registrada (con sus cuotas y lo que falta cobrar). */
  onListo: (registrada: boolean, texto: string, venta?: any) => Promise<void> | void;
  /** Título propio (p. ej. "Registrar venta" desde Finanzas). */
  titulo?: string;
}) {
  const aviso = useAviso();
  const fijo: LeadElegido | null = tarjeta?.lead_id
    ? { id: tarjeta.lead_id, nombre: tarjeta.nombre, ig_username: tarjeta.ig_username, avatar_url: tarjeta.avatar_url ?? null }
    : null;
  const [lead, setLead] = useState<LeadElegido | null>(fijo);
  const [ctx, setCtx] = useState<ContextoVenta | null>(null);
  const [errCtx, setErrCtx] = useState<string | null>(null);
  const [intento, setIntento] = useState(0);
  const [productoId, setProductoId] = useState('');
  const [monto, setMonto] = useState(Number(tarjeta?.valor) > 0 ? montoEnCampo(tarjeta.valor) : '');
  const [montoDeCurso, setMontoDeCurso] = useState<string | null>(null);
  const [metodoId, setMetodoId] = useState('');
  const [cuotas, setCuotas] = useState(false);
  const [numCuotas, setNumCuotas] = useState('3');
  const [pago, setPago] = useState<Pago>('todo');
  const [sena, setSena] = useState('');
  const [cuotasPagas, setCuotasPagas] = useState('1');
  const [vence, setVence] = useState(() => sumarDias(hoyISO(), 7));
  const [closerId, setCloserId] = useState('');
  const [setterId, setSetterId] = useState('');
  const [pctCloser, setPctCloser] = useState('');
  const [pctSetter, setPctSetter] = useState('');
  const tocoEquipo = useRef(false);
  const [fecha, setFecha] = useState(hoyISO());
  const [notas, setNotas] = useState('');
  const [ocupado, setOcupado] = useState<'venta' | 'mover' | null>(null);
  const quien = lead ? (lead.ig_username ? `@${lead.ig_username}` : lead.nombre || 'este lead') : null;

  function elegirPersona(rol: 'closer' | 'setter', id: string, equipo: Persona[] | undefined = ctx?.equipo) {
    const p = equipo?.find((x) => x.id === id);
    const pct = p ? pctEnCampo(p.comision_venta_pct) : '';
    if (rol === 'closer') { setCloserId(p ? id : ''); setPctCloser(pct); } else { setSetterId(p ? id : ''); setPctSetter(pct); }
  }

  // Cursos, métodos y equipo en una llamada; quién la cerró sale de quién atiende al lead.
  useEffect(() => {
    let vivo = true;
    api<ContextoVenta>(`/ux/finanzas/contexto-venta${lead?.id ? `?lead_id=${lead.id}` : ''}`)
      .then((c) => {
        if (!vivo) return;
        setCtx(c); setErrCtx(null);
        if (!tocoEquipo.current) {
          elegirPersona('closer', c.sugerido.closer_id ?? '', c.equipo);
          elegirPersona('setter', c.sugerido.setter_id ?? '', c.equipo);
        }
      })
      .catch((e) => { if (vivo) setErrCtx(e.message); });
    return () => { vivo = false; };
  }, [lead?.id, intento]); // eslint-disable-line react-hooks/exhaustive-deps

  function elegirCurso(id: string, lista: Producto[] = ctx?.productos ?? []) {
    setProductoId(id);
    const p = lista.find((x) => x.id === id);
    if (p && Number(p.precio_lista) > 0 && (!monto || monto === montoDeCurso)) {
      const m = montoEnCampo(p.precio_lista);
      setMonto(m); setMontoDeCurso(m);
    }
  }

  function cambiarCuotas(v: boolean) {
    setCuotas(v);
    if (v && pago === 'todo') setPago('parte');
    if (!v && pago === 'parte') setPago('todo');
  }

  // --- Cuentas en vivo (las mismas que hace el servidor) ---
  const importe = parseMonto(monto);
  const hayImporte = importe > 0;
  const n = cuotas ? Math.min(Math.max(Math.floor(Number(numCuotas) || 0), 0), 60) : 1;
  const montos = hayImporte && n >= 1 ? repartir(importe, n) : [];
  const k = cuotas
    ? (pago === 'todo' ? n : pago === 'nada' ? 0 : Math.min(Math.max(Math.floor(Number(cuotasPagas) || 1), 1), Math.max(n - 1, 1)))
    : 0;
  const senaN = parseMonto(sena);
  const cobradoAhora = !hayImporte ? 0
    : cuotas ? montos.slice(0, k).reduce((s, x) => s + x, 0)
      : pago === 'todo' ? importe : pago === 'nada' ? 0 : (senaN > 0 ? Math.min(senaN, importe) : 0);
  const porCobrar = hayImporte ? Math.max(0, Math.round((importe - cobradoAhora) * 100) / 100) : 0;
  const pideVence = hayImporte && porCobrar > 0 && (!cuotas || k === 0);
  const proxima = porCobrar > 0 ? (pideVence ? vence : sumarMeses(fecha, k)) : null;
  const metodo = ctx?.metodos.find((m) => m.id === metodoId);
  const comCobro = metodo && hayImporte ? (importe * Number(metodo.comision_pct)) / 100 : 0;
  const pc = closerId ? parseMonto(pctCloser) || 0 : 0;
  const ps = setterId ? parseMonto(pctSetter) || 0 : 0;
  const comEquipo = hayImporte ? (importe * (pc + ps)) / 100 : 0;
  const teQueda = importe - comCobro - comEquipo;
  const errSena = !cuotas && pago === 'parte' && sena && !(senaN > 0 && senaN < importe) ? 'Tiene que ser menos que el total' : undefined;
  const valido = hayImporte && (!cuotas || n >= 2) && (cuotas || pago !== 'parte' || (senaN > 0 && senaN < importe));
  const closer = ctx?.equipo.find((p) => p.id === closerId);
  const setter = ctx?.equipo.find((p) => p.id === setterId);
  const hoy = hoyISO();

  async function registrar() {
    if (!valido) return;
    setOcupado('venta');
    try {
      const venta = await api<any>('/ventas/registrar', {
        method: 'POST',
        json: {
          lead_id: lead?.id ?? undefined, precio_acordado: importe,
          producto_id: productoId || undefined, metodo_pago_id: metodoId || undefined,
          tipo_cobro: cuotas ? 'cuotas' : 'unico', num_cuotas: cuotas ? n : 1,
          closer_id: closerId || undefined, setter_id: setterId || undefined,
          comision_closer_pct: closerId ? pc : undefined, comision_setter_pct: setterId ? ps : undefined,
          fecha, notas: notas.trim() || undefined, moneda: ctx?.moneda,
          cobrado: pago,
          cobrado_monto: !cuotas && pago === 'parte' ? senaN : undefined,
          cuotas_cobradas: cuotas && pago === 'parte' ? k : undefined,
          vence_proxima: pideVence ? vence : undefined,
        },
      });
      if (etapa && tarjeta?.oportunidad_id) {
        await api(`/oportunidades/${tarjeta.oportunidad_id}/etapa`, { method: 'POST', json: { etapa_id: etapa.id } });
      }
      const resto = Number(venta?.por_cobrar ?? porCobrar);
      const base = quien ? `¡Venta de ${quien} por ${fmtDinero(importe)}!` : `Venta de ${fmtDinero(importe)} registrada.`;
      const cobro = resto > 0
        ? ` Te quedan ${fmtDineroExacto(resto)} por cobrar${venta?.proxima_vence ? ` (la próxima vence el ${fechaCorta(venta.proxima_vence)})` : ''}.`
        : ' Cobrada ✓';
      await onListo(true, base + cobro, venta);
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(null); }
  }

  async function soloMover() {
    if (!etapa) return;
    setOcupado('mover');
    try {
      await api(`/oportunidades/${tarjeta.oportunidad_id}/etapa`, { method: 'POST', json: { etapa_id: etapa.id } });
      await onListo(false, `${quien ?? 'El lead'} pasó a «${etapa.nombre}» (sin registrar la venta).`);
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(null); }
  }

  const opciones: Array<{ id: Pago; e: string }> = cuotas
    ? [{ id: 'parte', e: k > 1 ? `Ya pagó ${k} cuotas` : 'Ya pagó la 1ª cuota' }, { id: 'nada', e: 'Todavía no' }, { id: 'todo', e: 'Pagó todo' }]
    : [{ id: 'todo', e: 'Sí, todo' }, { id: 'parte', e: 'Una parte' }, { id: 'nada', e: 'Nada todavía' }];
  const closers = (ctx?.equipo ?? []).filter(cierra);
  const setters = (ctx?.equipo ?? []).filter((p) => consigue(p) && p.id !== closerId);
  const resumenEquipo = [closer?.nombre ?? (closers.length ? 'Sin closer' : null), setter ? `+ ${setter.nombre}` : null,
    fecha === hoy ? 'hoy' : fechaCorta(fecha)].filter(Boolean).join(' · ');

  return (
    <Dialogo abierto onCerrar={onCerrar} ancho={500}
      titulo={titulo ?? (quien && etapa ? `🎉 ¡Venta de ${quien}!` : 'Registrar venta')}
      descripcion={etapa
        ? 'Registrala y queda en Finanzas, en el Panel y dispara tus reglas de compra.'
        : 'Queda en Finanzas y, con el lead elegido, también en el Panel.'}
      pie={<>
        {etapa && <Boton variante="fantasma" onClick={soloMover} cargando={ocupado === 'mover'}>Solo moverlo</Boton>}
        <Boton variante="primario" onClick={registrar} cargando={ocupado === 'venta'} disabled={!valido}>Registrar venta</Boton>
      </>}>
      <div className="space-y-4">
        {errCtx && (
          <Banner tono="error" accion={<Boton tamano="sm" onClick={() => setIntento((i) => i + 1)}>Reintentar</Boton>}>
            No pudimos traer tus cursos ni cómo te pagan.
          </Banner>
        )}

        <Campo etiqueta="¿Quién compró?" ayuda={!lead ? 'Sin lead, la venta queda en Finanzas pero no cuenta en el Panel.' : undefined}>
          <BuscadorLead valor={lead} onElegir={setLead} bloqueado={Boolean(fijo)} />
        </Campo>

        <CampoCurso productos={ctx?.productos ?? []} valor={productoId} onElegir={(id) => elegirCurso(id)} moneda={ctx?.moneda}
          onCreado={(p) => {
            const lista = [...(ctx?.productos ?? []), p].sort((a, b) => a.nombre.localeCompare(b.nombre));
            setCtx((c) => (c ? { ...c, productos: lista } : c));
            elegirCurso(p.id, lista);
          }} />

        <Campo etiqueta="Monto" htmlFor="venta-monto" error={monto && !hayImporte ? 'Escribí un monto mayor a 0' : undefined}>
          <EntradaDinero id="venta-monto" valor={monto} onCambiar={setMonto} moneda={ctx?.moneda} />
        </Campo>

        <CampoMetodo metodos={ctx?.metodos ?? []} valor={metodoId} onElegir={setMetodoId}
          onCreado={(m) => { setCtx((c) => (c ? { ...c, metodos: [...c.metodos, m] } : c)); setMetodoId(m.id); }} />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Interruptor activo={cuotas} onCambiar={cambiarCuotas} etiqueta="En cuotas" />
          {cuotas && (
            <span className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <Entrada value={numCuotas} onChange={(e) => setNumCuotas(e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric" className="!w-16 text-center" aria-label="Cantidad de cuotas" />
              cuotas{montos.length > 1 && hayImporte ? ` de ${fmtDineroExacto(montos[0], ctx?.moneda)}` : ''}
            </span>
          )}
        </div>
        {cuotas && numCuotas !== '' && n < 2 && <p className="-mt-2 text-[11px]" style={{ color: 'var(--status-critical)' }}>En cuotas son al menos 2.</p>}

        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">¿Ya te pagó?</div>
          <FilaChips>
            {opciones.map((o) => <Chip key={o.id} activo={pago === o.id} onClick={() => setPago(o.id)}>{o.e}</Chip>)}
          </FilaChips>
          {!cuotas && pago === 'parte' && (
            <Campo etiqueta="¿Cuánto te pagó?" htmlFor="venta-sena" error={errSena} className="mt-2.5">
              <EntradaDinero id="venta-sena" valor={sena} onCambiar={setSena} moneda={ctx?.moneda} placeholder="Ej.: 300" />
            </Campo>
          )}
          {cuotas && pago === 'parte' && n > 2 && (
            <label className="mt-2.5 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              ¿Cuántas cuotas ya pagó?
              <Entrada value={cuotasPagas} onChange={(e) => setCuotasPagas(e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric" className="!w-14 text-center" aria-label="Cuotas que ya pagó" />
            </label>
          )}
          {pideVence && (
            <div className="mt-2.5">
              <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">{cuotas ? '¿Cuándo vence la 1ª cuota?' : '¿Cuándo te paga lo que falta?'}</div>
              <SelectorFecha valor={vence} onCambiar={setVence} tipo="futuro" />
            </div>
          )}
        </div>

        <Desplegable titulo={closers.length ? 'Quién la cerró, fecha y nota' : 'Fecha y nota'} subtitulo={resumenEquipo} className="!rounded-xl">
          <div className="space-y-3 pt-1">
            {closers.length > 0 ? (
              <>
                <CampoPersona etiqueta="¿Quién la cerró?" id="venta-closer" personas={closers} valor={closerId} nadie="Nadie / no sé"
                  onElegir={(id) => { tocoEquipo.current = true; elegirPersona('closer', id); if (id === setterId) elegirPersona('setter', ''); }}
                  pct={pctCloser} onPct={(v) => { tocoEquipo.current = true; setPctCloser(v); }} importe={hayImporte ? importe : 0} moneda={ctx?.moneda} />
                {(setters.length > 0 || setterId) && (
                  <CampoPersona etiqueta="¿Hubo setter?" id="venta-setter" personas={setters} valor={setterId} nadie="Sin setter"
                    onElegir={(id) => { tocoEquipo.current = true; elegirPersona('setter', id); }}
                    pct={pctSetter} onPct={(v) => { tocoEquipo.current = true; setPctSetter(v); }} importe={hayImporte ? importe : 0} moneda={ctx?.moneda} />
                )}
              </>
            ) : ctx ? (
              <p className="text-[12px] text-[var(--text-muted)]">Sumá a tu equipo en Finanzas › Equipo y acá se calcula solo la comisión de quien cerró.</p>
            ) : null}
            <div>
              <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Fecha de la venta</div>
              <SelectorFecha valor={fecha} onCambiar={setFecha} tipo="pasado" />
            </div>
            <Campo etiqueta="Nota (opcional)" htmlFor="venta-nota">
              <AreaTexto id="venta-nota" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} maxLength={2000}
                placeholder="Ej.: pagó con la tarjeta de la pareja" />
            </Campo>
          </div>
        </Desplegable>

        {hayImporte && (
          <div className="rounded-xl px-3.5 py-3" aria-live="polite"
            style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
            <div className="text-[14px] font-semibold">
              {porCobrar > 0
                ? <>Te quedan <span className="cifras">{fmtDineroExacto(porCobrar, ctx?.moneda)}</span> por cobrar</>
                : <>Cobrada completa <span style={{ color: 'var(--status-good)' }}>✓</span></>}
            </div>
            {porCobrar > 0 && proxima && (
              <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">
                {cuotas && n - k > 1 ? `${n - k} cuotas · ` : ''}la próxima vence el {fechaCorta(proxima)}
              </div>
            )}
            <div className="mt-1.5 text-[12px] text-[var(--text-secondary)]">
              De esta venta te quedan <strong className="cifras">{fmtDinero(teQueda, ctx?.moneda)}</strong>
              {(comCobro > 0 || comEquipo > 0) && (
                <> ({[metodo && comCobro > 0 ? `${metodo.nombre} se lleva ${fmtDineroExacto(comCobro, ctx?.moneda)}` : null,
                  comEquipo > 0 ? `comisiones ${fmtDineroExacto(comEquipo, ctx?.moneda)}` : null].filter(Boolean).join(' · ')})</>
              )}
            </div>
          </div>
        )}
      </div>
    </Dialogo>
  );
}

const MOTIVOS = ['No le interesa', 'No califica', 'Le pareció caro', 'Dejó de responder', 'Eligió otra opción', 'No era el momento'];

export function DialogoPerdido({ tarjeta, etapa, onCerrar, onListo }: {
  tarjeta: any; etapa: { id: string; nombre: string };
  onCerrar: () => void; onListo: (texto: string) => Promise<void> | void;
}) {
  const aviso = useAviso();
  const [motivo, setMotivo] = useState('');
  const [otro, setOtro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const quien = tarjeta.ig_username ? `@${tarjeta.ig_username}` : tarjeta.nombre || 'este lead';
  const final = motivo === 'Otro' ? otro.trim() : motivo;

  async function guardar() {
    setOcupado(true);
    try {
      await api('/ux/pipeline/perdido', { method: 'POST', json: { oportunidad_id: tarjeta.oportunidad_id, etapa_id: etapa.id, motivo: final || undefined } });
      await onListo(`${quien} pasó a «${etapa.nombre}»${final ? ` · motivo: ${final.toLowerCase()}` : ''}.`);
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={`¿Por qué se perdió ${quien}?`} ancho={460} autoFoco={false}
      descripcion="Así ves después qué frena tus ventas. Es opcional."
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={guardar} cargando={ocupado}>Pasar a «{etapa.nombre}»</Boton>
      </>}>
      <div className="space-y-3">
        <FilaChips>
          {[...MOTIVOS, 'Otro'].map((m) => <Chip key={m} activo={motivo === m} onClick={() => setMotivo(motivo === m ? '' : m)}>{m}</Chip>)}
        </FilaChips>
        {motivo === 'Otro' && (
          <Entrada value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="Contalo en pocas palabras" autoFocus maxLength={200} />
        )}
      </div>
    </Dialogo>
  );
}
