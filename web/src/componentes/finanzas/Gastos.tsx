import { useEffect, useMemo, useState } from 'react';
import { api, fmtDinero, plural } from '../../api';
import { textoDe } from '../../textos';
import {
  Banner, Boton, BotonConfirmar, BotonFlotante, Campo, Chip, Desplegable, Dialogo, Entrada, ErrorCarga, Esqueleto,
  FilaChips, Insignia, Interruptor, TablaResponsiva, TituloSeccion, Vacio, useAviso, useCarga, useEsMovil, type Columna,
} from '../../ui';
import {
  EntradaDinero, SelectorFecha, SelectorPeriodo, fechaCorta, fmtDineroExacto, hoyISO, montoEnCampo, nombreMes, parseMonto,
  usePeriodo,
} from './comun';
import type { Gasto, PropsPestana, RespGastos } from './tipos';

// Gastos: cuánto gastaste en el período y en qué (las categorías también
// filtran), agrupado por mes. Los gastos de todos los meses (suscripciones)
// se cargan con un toque. Tocar un gasto lo abre para corregirlo o borrarlo.

const CATEGORIAS = ['ads', 'herramientas', 'freelancers', 'administracion', 'otros', 'comisiones_ventas', 'comisiones_pasarela'];
const esComision = (g: Gasto) => g.categoria === 'comisiones_ventas' || g.categoria === 'comisiones_pasarela' || g.es_comision_ventas || g.es_comision_pasarela;
const suma = (xs: Gasto[]) => xs.reduce((s, g) => s + Number(g.importe), 0);

export default function Gastos({ version, onCambio, nuevo }: PropsPestana) {
  const aviso = useAviso();
  const movil = useEsMovil(768);
  const [periodo, setPeriodo] = usePeriodo();
  const [cat, setCat] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Gasto | 'nuevo' | null>(nuevo ? 'nuevo' : null);
  const [cargandoFijos, setCargandoFijos] = useState(false);
  const carga = useCarga(() => api<RespGastos>(`/ux/finanzas/gastos?periodo=${periodo}`), [periodo, version]);
  const d = carga.datos;

  const visibles = useMemo(() => (d ? (cat ? d.gastos.filter((g) => g.categoria === cat) : d.gastos) : []), [d, cat]);
  const porMes = useMemo(() => {
    const m = new Map<string, Gasto[]>();
    for (const g of visibles) { const k = g.fecha.slice(0, 7); m.set(k, [...(m.get(k) ?? []), g]); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [visibles]);
  const reales = d ? d.gastos.filter((g) => !esComision(g)) : [];
  const categorias = useMemo(() => {
    const t = new Map<string, number>();
    for (const g of d?.gastos ?? []) t.set(g.categoria, (t.get(g.categoria) ?? 0) + Number(g.importe));
    return [...t.entries()].sort((a, b) => b[1] - a[1]);
  }, [d]);

  async function cargarFijos() {
    setCargandoFijos(true);
    try {
      const r = await api<{ creados: number; total: number }>('/ux/finanzas/gastos/repetir-fijos', { method: 'POST' });
      aviso.exito(`Listo: ${plural(r.creados, 'gasto fijo cargado', 'gastos fijos cargados')} (${fmtDinero(r.total)}).`);
      onCambio();
    } catch (e: any) { aviso.error(e.message); } finally { setCargandoFijos(false); }
  }

  const columnas: Array<Columna<Gasto>> = [
    {
      clave: 'desc', titulo: 'En qué', enMovil: 'titulo',
      render: (g) => <span className="inline-flex min-w-0 items-center gap-1.5"><span className="truncate">{g.descripcion}</span>{g.tipo === 'fijo' && <Insignia tono="azul">Todos los meses</Insignia>}</span>,
    },
    { clave: 'cat', titulo: 'Categoría', enMovil: 'subtitulo', render: (g) => (movil ? `${textoDe('categoria_gasto', g.categoria)} · ${fechaCorta(g.fecha)}` : textoDe('categoria_gasto', g.categoria)) },
    { clave: 'fecha', titulo: 'Fecha', enMovil: 'ocultar', render: (g) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{fechaCorta(g.fecha)}</span> },
    { clave: 'monto', titulo: 'Monto', alinear: 'der', enMovil: 'esquina', render: (g) => <span className="cifras whitespace-nowrap">{fmtDineroExacto(g.importe, g.moneda)}</span> },
  ];
  const tabla = (xs: Gasto[]) => <TablaResponsiva columnas={columnas} filas={xs} clave={(g) => g.id} onFila={(g) => setDialogo(g)} />;
  const unMes = periodo === 'mes' || periodo === 'mes_pasado';

  return (
    <section className="space-y-3" aria-label="Gastos">
      <SelectorPeriodo valor={periodo} onCambiar={(p) => { setPeriodo(p); setCat(null); }} />
      <TituloSeccion titulo="Gastos" onMas={() => setDialogo('nuevo')} textoMas="Nuevo gasto"
        subtitulo={d ? <>{fmtDinero(suma(reales), d.moneda)} {d.periodo.texto}{d.fijos.cantidad > 0 ? ` · fijos: ${fmtDinero(d.fijos.mensual, d.moneda)} por mes` : ''}</> : ' '} />

      {d && d.fijos.por_cargar.length > 0 && (
        <Banner tono="info" accion={<Boton tamano="sm" variante="primario" cargando={cargandoFijos} onClick={cargarFijos}>Cargarlos</Boton>}>
          {plural(d.fijos.por_cargar.length, 'gasto de todos los meses', 'gastos de todos los meses')} sin cargar este mes
          ({d.fijos.por_cargar.map((g) => g.descripcion).slice(0, 3).join(', ')}{d.fijos.por_cargar.length > 3 ? '…' : ''}).
        </Banner>
      )}

      {d && categorias.length > 1 && (
        <FilaChips>
          <Chip activo={!cat} onClick={() => setCat(null)}>Todas</Chip>
          {categorias.map(([c, t]) => (
            <Chip key={c} activo={cat === c} onClick={() => setCat(cat === c ? null : c)}>{textoDe('categoria_gasto', c)} · {fmtDinero(t, d.moneda)}</Chip>
          ))}
        </FilaChips>
      )}

      {carga.error && !d ? (
        <div className="tarjeta"><ErrorCarga error={carga.error} titulo="No pudimos cargar tus gastos" onReintentar={() => carga.recargar()} /></div>
      ) : !d ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando">{[0, 1, 2, 3].map((i) => <Esqueleto key={i} alto={52} className="rounded-xl" />)}</div>
      ) : d.gastos.length === 0 ? (
        <div className="tarjeta">
          <Vacio icono="🧮" titulo={`No anotaste gastos ${d.periodo.texto}`}
            texto="Publicidad, herramientas, freelancers… Anotalos y vas a ver cuánto te queda de verdad en el Resumen."
            accion={<Boton variante="primario" onClick={() => setDialogo('nuevo')}>Anotar un gasto</Boton>} />
        </div>
      ) : (
        <div className={`space-y-2.5 transition-opacity ${carga.cargando ? 'opacity-60' : ''}`}>
          {d.gastos.some(esComision) && (
            <p className="text-[12px] text-[var(--text-muted)]">Los gastos de comisiones no suman al total: el Resumen ya resta las comisiones de cobro y del equipo.</p>
          )}
          {unMes || porMes.length === 1
            ? tabla(visibles)
            : porMes.map(([mes, xs], i) => (
              <Desplegable key={mes} clave={`fin-gastos-${mes}`} abiertoInicial={i === 0} tarjeta={false}
                titulo={<span className="first-letter:uppercase">{nombreMes(mes)}</span>}
                subtitulo={`${plural(xs.length, 'gasto')} · ${fmtDinero(suma(xs.filter((g) => !esComision(g))), d.moneda)}`}>
                {tabla(xs)}
              </Desplegable>
            ))}
        </div>
      )}

      {dialogo && <DialogoGasto gasto={dialogo === 'nuevo' ? null : dialogo} onCerrar={() => setDialogo(null)}
        onListo={(texto, deshacer) => { setDialogo(null); onCambio(); aviso.exito(texto, deshacer); }} />}
      <BotonFlotante etiqueta="Nuevo gasto" onClick={() => setDialogo('nuevo')} />
    </section>
  );
}

function DialogoGasto({ gasto, onCerrar, onListo }: {
  gasto: Gasto | null; onCerrar: () => void;
  onListo: (texto: string, deshacer?: { texto: string; onClick: () => void }) => void;
}) {
  const aviso = useAviso();
  const [desc, setDesc] = useState(gasto?.descripcion ?? '');
  const [monto, setMonto] = useState(gasto ? montoEnCampo(gasto.importe) : '');
  const [cat, setCat] = useState(gasto?.categoria ?? 'ads');
  const [fecha, setFecha] = useState(gasto?.fecha ?? hoyISO());
  const [fijo, setFijo] = useState(gasto?.tipo === 'fijo');
  const [ocupado, setOcupado] = useState(false);
  const [tocado, setTocado] = useState(false);
  useEffect(() => { setTocado(false); }, [gasto?.id]);
  const importe = parseMonto(monto);
  const valido = desc.trim().length > 0 && importe > 0;

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    setTocado(true);
    if (!valido) return;
    setOcupado(true);
    const datos = { descripcion: desc.trim(), importe, categoria: cat, fecha, tipo: fijo ? 'fijo' : null, periodicidad: fijo ? 'mensual' : null };
    try {
      if (gasto) {
        await api(`/gastos/${gasto.id}`, { method: 'PATCH', json: datos });
        onListo('Gasto corregido');
      } else {
        await api('/gastos', { method: 'POST', json: { ...datos, tipo: fijo ? 'fijo' : 'variable' } });
        onListo(`Gasto anotado: ${datos.descripcion} · ${fmtDineroExacto(importe)}`);
      }
    } catch (err: any) { aviso.error(err.message); } finally { setOcupado(false); }
  }

  async function borrar() {
    if (!gasto) return;
    try {
      await api(`/gastos/${gasto.id}`, { method: 'DELETE' });
      const copia = { descripcion: gasto.descripcion, importe: gasto.importe, categoria: gasto.categoria, fecha: gasto.fecha, tipo: gasto.tipo, periodicidad: gasto.periodicidad, moneda: gasto.moneda };
      onListo('Gasto borrado', { texto: 'Deshacer', onClick: () => { api('/gastos', { method: 'POST', json: copia }).then(() => aviso.exito('Gasto recuperado')).catch((e) => aviso.error(e.message)); } });
    } catch (err: any) { aviso.error(err.message); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={gasto ? 'Corregir el gasto' : 'Nuevo gasto'} ancho={460}
      pie={<>
        {gasto && <div className="mr-auto"><BotonConfirmar onConfirmar={borrar}>Borrar</BotonConfirmar></div>}
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" type="submit" form="form-gasto" cargando={ocupado} disabled={tocado && !valido}>{gasto ? 'Guardar' : 'Guardar gasto'}</Boton>
      </>}>
      <form id="form-gasto" onSubmit={guardar} className="space-y-3.5">
        <Campo etiqueta="¿En qué?" htmlFor="gasto-desc" error={tocado && !desc.trim() ? 'Contá en qué gastaste' : undefined}>
          <Entrada id="gasto-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Ej.: anuncios de Instagram" maxLength={200} invalido={tocado && !desc.trim()} />
        </Campo>
        <Campo etiqueta="Monto" htmlFor="gasto-monto" error={tocado && !(importe > 0) ? 'Poné cuánto salió' : undefined}>
          <EntradaDinero id="gasto-monto" valor={monto} onCambiar={setMonto} placeholder="Ej.: 120" moneda={gasto?.moneda} invalido={tocado && !(importe > 0)} />
        </Campo>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Categoría</div>
          <FilaChips>
            {CATEGORIAS.map((c) => <Chip key={c} activo={cat === c} onClick={() => setCat(c)}>{textoDe('categoria_gasto', c)}</Chip>)}
          </FilaChips>
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Fecha</div>
          <SelectorFecha valor={fecha} onCambiar={setFecha} tipo="pasado" />
        </div>
        <Interruptor activo={fijo} onCambiar={setFijo} etiqueta="Se repite todos los meses (suscripción, sueldo…)" />
      </form>
    </Dialogo>
  );
}
