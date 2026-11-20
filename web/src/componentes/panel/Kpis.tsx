import { fmtDecimal, fmtDinero, fmtNum, fmtPct, plural } from '../../api';
import { Carrusel } from '../../ui';
import { Kpi, calcularDelta } from '../Graficas';
import type { Kpis } from './tipos';

// Fila de números de arriba. En el celular se desliza (se ven 2 tarjetas y
// media: eso invita a deslizar); en escritorio, grilla de 3 o 6. La
// comparación se escribe UNA vez arriba, no en cada tarjeta. Cada tarjeta
// lleva al detalle y explica su número con un ⓘ.

function hayDatos(k: Kpis | null | undefined) {
  return Boolean(k && (k.leads > 0 || k.reuniones_agendadas > 0 || k.ventas > 0 || k.ingresos !== 0));
}

export function FilaKpis({ k, anterior, comparacion, texto, cargando }: {
  k: Kpis; anterior: Kpis | null | undefined; comparacion: string | null; texto: string; cargando?: boolean;
}) {
  // Sin período anterior ("Todo") no hay comparación; si el anterior está
  // vacío, no mostramos "nuevo" en cada tarjeta: lo decimos una vez.
  const conAnterior = hayDatos(anterior) ? anterior! : null;
  const de = (s: string) => (s.startsWith('el ') ? `del ${s.slice(3)}` : `de ${s}`);
  const aviso = !anterior || !comparacion
    ? null
    : conAnterior ? `Comparado con ${comparacion}` : `No hay datos ${de(comparacion)} para comparar`;

  const resueltas = k.reuniones_realizadas + k.no_shows;
  const resueltasAnt = conAnterior ? conAnterior.reuniones_realizadas + conAnterior.no_shows : 0;
  const pendientes = k.reuniones_pendientes ?? 0;

  const tarjetas = [
    <Kpi key="leads" etiqueta="Leads" valor={fmtNum(k.leads)} a="/leads"
      actual={k.leads} anterior={conAnterior?.leads}
      sub={k.leads > 0 ? `${fmtPct(k.cobertura_atribucion)} con origen conocido` : undefined}
      ayuda={<>Personas que te escribieron o comentaron por primera vez {texto}. «Con origen conocido»: sabemos de qué reel o publicación vinieron.</>} />,
    <Kpi key="reuniones" etiqueta="Reuniones" valor={fmtNum(k.reuniones_agendadas)} a="/pipeline"
      actual={k.reuniones_agendadas} anterior={conAnterior?.reuniones_agendadas}
      sub={k.leads > 0 ? `el ${fmtPct(Math.min(100, k.tasa_lead_reunion))} de los leads agendó` : undefined}
      ayuda={<>Reuniones que se agendaron {texto}, sin importar cuándo entró el lead. Abajo: de los leads que entraron {texto}, cuántos ya agendaron una reunión.</>} />,
    <Kpi key="asistencia" etiqueta="Asistencia" a="/pipeline"
      valor={resueltas > 0 ? fmtPct(k.tasa_asistencia) : '—'}
      delta={resueltas > 0 && resueltasAnt > 0 ? calcularDelta(k.tasa_asistencia, conAnterior!.tasa_asistencia, { puntos: true }) : null}
      sub={resueltas > 0 || pendientes > 0
        ? [resueltas > 0 ? `${fmtNum(k.reuniones_realizadas)} vinieron · ${fmtNum(k.no_shows)} faltaron` : 'Todavía no pasó ninguna', pendientes > 0 ? `${fmtNum(pendientes)} por venir` : null].filter(Boolean).join(' · ')
        : undefined}
      ayuda={<>De las reuniones que ya pasaron, cuántas personas vinieron. Las que todavía no llegaron a su fecha («por venir») no cuentan como faltazo.</>} />,
    <Kpi key="ventas" etiqueta="Ventas" valor={fmtNum(k.ventas)} a="/finanzas"
      actual={k.ventas} anterior={conAnterior?.ventas}
      sub={[
        k.reuniones_realizadas > 0 ? `se cerró el ${fmtPct(Math.min(100, k.tasa_reunion_venta))} de las reuniones` : null,
        k.reembolsos ? plural(k.reembolsos, 'devuelta', 'devueltas') : null,
      ].filter(Boolean).join(' · ') || undefined}
      ayuda={<>Ventas cobradas {texto}, con las devoluciones ya restadas. Son las mismas que ves en Finanzas: cada venta cuenta una sola vez, la cargues a mano en Finanzas o llegue sola de Stripe, Hotmart o ManyChat. Abajo: de las reuniones que se hicieron {texto}, cuántas terminaron en venta.</>} />,
    <Kpi key="ingresos" etiqueta="Ingresos" valor={fmtDinero(k.ingresos)} a="/finanzas"
      actual={k.ingresos} anterior={conAnterior?.ingresos}
      sub={k.ventas > 0 ? `ticket promedio ${fmtDinero(k.ticket_medio)}` : undefined}
      ayuda={<>Lo que cobraste {texto}, neto: las devoluciones ya están restadas. Sale de las mismas ventas que Finanzas.</>} />,
    <Kpi key="valor" etiqueta="Valor por lead" valor={fmtDinero(k.valor_por_lead)} a="/contenidos" delta={null}
      sub={k.dias_medios_cierre > 0 ? `cierran en ${fmtDecimal(k.dias_medios_cierre)} días` : undefined}
      ayuda={<>Lo que facturó en promedio cada lead que entró {texto}, contando lo que compró después. Te dice cuánto podés pagar por conseguir un lead. No se compara con el período anterior: los leads nuevos todavía no tuvieron tiempo de comprar.</>} />,
  ];

  return (
    <section aria-label="Tus números" className={`transition-opacity ${cargando ? 'opacity-60' : ''}`}>
      {aviso && <p className="mb-2 text-[12px] text-[var(--text-secondary)]">{aviso}</p>}
      <Carrusel soloMovil columnas={6} anchoItem="42vw" etiqueta="Tus números">
        {tarjetas}
      </Carrusel>
    </section>
  );
}
