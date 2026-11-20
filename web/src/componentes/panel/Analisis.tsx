import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtDinero, fmtNum, fmtPct, plural } from '../../api';
import { textoDe } from '../../textos';
import { Ayuda, Boton, Chip, Desplegable, FilaChips, Insignia, TablaResponsiva, type Columna } from '../../ui';
import { BarraCalidad, useAncho } from '../Graficas';
import { IconoPanel } from './iconos';
import { PARTE_EMBUDO, limpiarAngulo } from './textos';
import type { Angulo, Calidad, DatosPanel, Persona } from './tipos';

// Las secciones de "análisis" que el dueño mira de vez en cuando. Van
// plegables (recuerdan si quedaron abiertas) y, plegadas, muestran el dato
// clave al lado del título. En el celular arrancan cerradas.

// ---------------------------------------------------------------------
// De qué ángulo viene la plata
// ---------------------------------------------------------------------

/** Leads de contenido sin ángulo asignado (o sin contenido de origen): no es un ángulo. */
const esSinAngulo = (a: Angulo) => a.angulo === 'sin_clasificar' || !a.angulo;

export function Angulos({ angulos, mezcla, abiertoInicial }: {
  angulos: Angulo[]; mezcla?: DatosPanel['mezcla']; abiertoInicial: boolean;
}) {
  const [verSinVentas, setVerSinVentas] = useState(false);
  const conLeads = (angulos ?? []).filter((a) => a.leads > 0);
  if (!conLeads.length) return null;
  // "Sin clasificar" no es un ángulo: va siempre al final y nunca es el titular
  // (antes salía «Sin clasificar trae el 39 % de la plata»).
  const ordenados = [...conLeads].sort((a, b) => Number(esSinAngulo(a)) - Number(esSinAngulo(b))
    || b.ingresos - a.ingresos || b.leads - a.leads);
  const conVentas = ordenados.filter((a) => a.ingresos > 0);
  const sinVentas = ordenados.filter((a) => a.ingresos <= 0);
  const totalIngresos = conVentas.reduce((s, a) => s + a.ingresos, 0);
  const maxIngresos = Math.max(1, ...conVentas.map((a) => a.ingresos));
  const top = conVentas.find((a) => !esSinAngulo(a));
  const clasificados = conLeads.filter((a) => !esSinAngulo(a)).length;
  const sinAngulo = conVentas.find(esSinAngulo);
  const parteSinAngulo = sinAngulo && totalIngresos > 0 ? (sinAngulo.ingresos / totalIngresos) * 100 : 0;
  const resumen = parteSinAngulo >= 50
    ? `El ${fmtPct(parteSinAngulo)} de la plata viene de contenido sin ángulo`
    : top && totalIngresos > 0
    ? `${limpiarAngulo(top.etiqueta)} trae el ${fmtPct((top.ingresos / totalIngresos) * 100)} de la plata`
    : conVentas.length
      ? 'Las ventas vienen de contenido sin ángulo asignado'
      : clasificados
        ? `${plural(clasificados, 'ángulo', 'ángulos')} con leads, todavía sin ventas`
        : 'Tu contenido todavía no tiene ángulo asignado';
  const visibles = verSinVentas || !conVentas.length ? ordenados : conVentas;

  return (
    <Desplegable clave="panel_angulos" abiertoInicial={abiertoInicial} titulo="De qué ángulo viene la plata" subtitulo={resumen}>
      <p className="mb-2 text-[12px] leading-snug text-[var(--text-secondary)]">
        No todo el contenido hace el mismo trabajo: el que vende cierra y el que atrae trae gente nueva. Juzgalos distinto.
      </p>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--text-secondary)]">
        <span>El color dice qué trabajo hace:</span>
        {(['TOFU', 'MOFU', 'BOFU'] as const).map((k) => (
          <span key={k} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: PARTE_EMBUDO[k].color }} aria-hidden />
            {PARTE_EMBUDO[k].etiqueta}
          </span>
        ))}
        <Ayuda titulo="Atrae, educa, vende">
          Es la parte del embudo en la que trabaja cada ángulo. Atrae (TOFU, arriba del embudo): trae gente que no te
          conoce. Educa (MOFU, en el medio): muestra el problema y la solución. Vende (BOFU, abajo): casos y producto,
          cierra ventas. Transversal: mentalidad o historia, sirve en cualquier parte. «Sin clasificar»: leads de un
          contenido al que todavía no le pusiste ángulo, o de los que no sabemos de qué contenido vinieron.
        </Ayuda>
      </div>
      <ul className="grid gap-x-10 gap-y-3.5 lg:grid-cols-2">
        {visibles.map((a) => {
          const parte = a.etapa_embudo ? PARTE_EMBUDO[a.etapa_embudo] : null;
          // Gris que se ve en claro y en oscuro (--baseline casi desaparecía en oscuro).
          const color = parte?.color ?? 'var(--text-muted)';
          const parteDelTotal = totalIngresos > 0 ? (a.ingresos / totalIngresos) * 100 : 0;
          return (
            <li key={a.angulo}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
                  <span className="truncate font-medium">{limpiarAngulo(a.etiqueta)}</span>
                  {parte && parte.etiqueta !== 'Transversal' && <Insignia>{parte.etiqueta}</Insignia>}
                </span>
                <b className="cifras text-[13px] font-semibold">{fmtDinero(a.ingresos)}</b>
              </div>
              <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                {plural(a.leads, 'lead', 'leads')} · {plural(a.ventas, 'venta', 'ventas')} · {fmtPct(a.tasa_lead_venta)} compra
              </div>
              {a.ingresos > 0 && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-2 min-w-0 flex-1 rounded-r-[4px]" style={{ background: 'color-mix(in srgb, var(--gridline) 70%, transparent)' }}>
                    <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max(1.5, (a.ingresos / maxIngresos) * 100)}%`, background: color }} />
                  </div>
                  <span className="cifras w-12 shrink-0 text-right text-[11px] text-[var(--text-secondary)]">{fmtPct(parteDelTotal)}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {sinVentas.length > 0 && conVentas.length > 0 && (
        <Boton variante="fantasma" className="mt-2 !text-[var(--series-1)]" onClick={() => setVerSinVentas((v) => !v)}>
          {verSinVentas ? 'Ocultar los que no vendieron' : `+ ${plural(sinVentas.length, 'ángulo', 'ángulos')} sin ventas`}
        </Boton>
      )}
      {mezcla && !mezcla.muestra_suficiente && (
        <p className="mt-3 flex items-start gap-1.5 rounded-lg p-2.5 text-[12px] text-[var(--text-secondary)]" style={{ background: 'var(--page-plane)' }}>
          <span className="mt-[1px]" style={{ color: 'color-mix(in srgb, var(--status-warning) 70%, var(--text-primary))' }}><IconoPanel nombre="alerta" tam={14} /></span>
          <span>
            Tenés {plural(mezcla.dias_muestra, 'día', 'días')} de contenido clasificado: no tomés decisiones definitivas hasta tener 3 meses.
            {mezcla.total > mezcla.clasificados ? ` (${fmtNum(mezcla.clasificados)} de ${fmtNum(mezcla.total)} contenidos tienen ángulo.)` : ''}
          </span>
        </p>
      )}
    </Desplegable>
  );
}

// ---------------------------------------------------------------------
// Equipo
// ---------------------------------------------------------------------

const primerNombre = (n: string) => (n ?? '').trim().split(/\s+/)[0] ?? n;

export function Equipo({ personas, abiertoInicial, texto }: { personas: Persona[]; abiertoInicial: boolean; texto: string }) {
  const [vista, setVista] = useState<'closers' | 'setters'>('closers');
  const [verInactivos, setVerInactivos] = useState(false);
  const activo = (p: Persona) => p.oportunidades + p.reuniones + p.ventas + Number(p.reuniones_agendadas ?? 0) > 0 || p.ingresos !== 0;
  const activos = (personas ?? []).filter(activo);
  const inactivos = (personas ?? []).filter((p) => !activo(p));
  if (!activos.length) return null;
  const setters = activos.filter((p) => p.rol === 'setter');
  const closers = activos.filter((p) => p.rol !== 'setter');
  const dosVistas = setters.length > 0 && closers.length > 0;
  const lista = (dosVistas ? (vista === 'setters' ? setters : closers) : activos);
  const filas = verInactivos ? [...lista, ...inactivos] : lista;
  const conPlata = [...activos].filter((p) => p.ingresos > 0).sort((a, b) => b.ingresos - a.ingresos);
  const resumen = conPlata.length
    ? conPlata.slice(0, 2).map((p) => `${primerNombre(p.nombre)} ${fmtDinero(p.ingresos)}`).join(' · ')
    : `${plural(activos.length, 'persona', 'personas')} con actividad`;

  return (
    <Desplegable clave="panel_equipo" abiertoInicial={abiertoInicial} titulo="Equipo" subtitulo={resumen}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[12px] text-[var(--text-secondary)]">
          Lo que hizo cada persona {texto}
          <Ayuda titulo="Equipo">
            Leads: los que le entraron. Reuniones hechas: las que tuvo. Ventas: las que cerró. Cierre: de sus reuniones
            hechas, cuántas terminaron en venta. Ingresos: lo que vendió.
            {dosVistas ? ' A los setters se los mide por la agenda: de sus leads, cuántos agendaron una reunión.' : ''}
          </Ayuda>
        </p>
        {dosVistas && (
          <FilaChips className="!mx-0 !px-0">
            <Chip activo={vista === 'closers'} onClick={() => setVista('closers')}>Closers</Chip>
            <Chip activo={vista === 'setters'} onClick={() => setVista('setters')}>Setters</Chip>
          </FilaChips>
        )}
      </div>
      <TablaEquipo filas={filas} setters={vista === 'setters' && dosVistas} />
      {inactivos.length > 0 && (
        <Boton variante="fantasma" className="mt-1.5 !text-[var(--series-1)]" onClick={() => setVerInactivos((v) => !v)}>
          {verInactivos ? 'Ocultar sin actividad' : `+ ${plural(inactivos.length, 'persona', 'personas')} sin actividad`}
        </Boton>
      )}
    </Desplegable>
  );
}

/** Tasa segura: del servidor (nunca pasa de 100 %) o, si no vino, calculada y topeada. */
function tasa(valor: number | undefined, a: number, b: number) {
  if (!(b > 0)) return '—';
  return fmtPct(Math.min(100, valor ?? (a / b) * 100));
}

/**
 * La tabla del equipo. Columnas de ancho fijo y el nombre se corta con "…": la
 * plata (a la derecha) nunca queda escondida detrás de un desplazamiento. Si la
 * tarjeta es angosta (tablet, laptop chica), quedan solo las columnas clave.
 */
function TablaEquipo({ filas, setters }: { filas: Persona[]; setters: boolean }) {
  const { ref, ancho } = useAncho<HTMLDivElement>();
  const angosto = ancho > 0 && ancho < 620;
  const persona: Columna<Persona> = {
    clave: 'persona', titulo: 'Persona', enMovil: 'titulo',
    render: (p) => (
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate">{p.nombre}</span>
        <span className="shrink-0"><Insignia>{textoDe('rol_usuario', p.rol)}</Insignia></span>
      </span>
    ),
  };
  const todas: Array<Columna<Persona> & { clave: string }> = setters ? [
    persona,
    { clave: 'leads', titulo: 'Leads', alinear: 'der', ancho: '76px', render: (p) => fmtNum(p.oportunidades) },
    { clave: 'agendadas', titulo: 'Agendadas', alinear: 'der', ancho: '108px', render: (p) => fmtNum(p.reuniones_agendadas ?? 0) },
    { clave: 'agenda', titulo: 'Agenda', alinear: 'der', ancho: '92px', enMovil: 'esquina',
      render: (p) => <b className="font-semibold">{tasa(p.tasa_agenda, p.oportunidades_con_reunion ?? 0, p.oportunidades)}</b> },
  ] : [
    persona,
    { clave: 'leads', titulo: 'Leads', alinear: 'der', ancho: '76px', render: (p) => fmtNum(p.oportunidades) },
    { clave: 'reuniones', titulo: 'Reuniones hechas', alinear: 'der', ancho: '136px', render: (p) => fmtNum(p.reuniones) },
    { clave: 'ventas', titulo: 'Ventas', alinear: 'der', ancho: '76px', render: (p) => fmtNum(p.ventas) },
    { clave: 'cierre', titulo: 'Cierre', alinear: 'der', ancho: '84px', render: (p) => tasa(p.tasa_cierre, p.reuniones_con_venta ?? 0, p.reuniones) },
    { clave: 'ingresos', titulo: 'Ingresos', alinear: 'der', ancho: '116px', enMovil: 'esquina', render: (p) => <b className="font-semibold">{fmtDinero(p.ingresos)}</b> },
  ];
  const columnas = angosto ? todas.filter((c) => !['leads', 'reuniones'].includes(c.clave)) : todas;
  return (
    <div ref={ref} className="md:-mx-3.5 md:[&_table]:table-fixed md:[&_.tarjeta]:rounded-none md:[&_.tarjeta]:border-x-0 md:[&_.tarjeta]:border-b-0 md:[&_.tarjeta]:bg-transparent [&_li_.tarjeta]:bg-[var(--page-plane)]">
      <TablaResponsiva<Persona> columnas={columnas} filas={filas} clave={(p) => p.id} />
    </div>
  );
}

// ---------------------------------------------------------------------
// ¿Qué tan seguros son estos números?
// ---------------------------------------------------------------------

export function Fiabilidad({ calidad, texto }: { calidad: Calidad; texto: string }) {
  const navegar = useNavigate();
  const l = calidad?.leads;
  if (!l || l.total === 0) return null;
  const pct = l.porcentaje_seguros;
  const tono = pct >= 85 ? 'var(--status-good)' : pct >= 70 ? 'var(--status-warning)' : 'var(--status-critical)';
  const ambiguas = calidad.palabras_ambiguas ?? [];
  const sinReel = calidad.automatizaciones_sin_contenido ?? [];
  const subtitulo = (
    <span className="inline-flex items-center gap-1.5">
      <span style={{ color: `color-mix(in srgb, ${tono} 75%, var(--text-primary))` }}>
        <IconoPanel nombre={pct >= 85 ? 'check' : 'alerta'} tam={13} grosor={2.2} />
      </span>
      <span className="text-[var(--text-secondary)]">{fmtPct(pct)} de tus leads tienen origen seguro</span>
    </span>
  );
  return (
    <Desplegable clave="panel_fiabilidad" abiertoInicial={false} titulo="¿Qué tan seguros son estos números?" subtitulo={subtitulo}>
      <p className="mb-3 text-[12px] leading-snug text-[var(--text-secondary)]">
        De los {plural(l.total, 'lead que entró', 'leads que entraron')} {texto}, de cuántos sabemos con seguridad de qué
        contenido vinieron. Seguro: llegó por el reel exacto o por una palabra que está en un solo reel. Dudoso: la
        palabra que usó está en varios reels.
      </p>
      <BarraCalidad alta={l.seguros} media={0} baja={l.dudosos} ninguna={l.sin_origen} total={l.total}
        etiquetas={{ alta: 'Seguro', baja: 'Dudoso', ninguna: 'Sin origen' }} />
      {(ambiguas.length > 0 || sinReel.length > 0) && (
        <ul className="mt-3 space-y-2">
          {ambiguas.map((p) => (
            <li key={p.palabra_clave} className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-2.5 text-[12px]" style={{ background: 'var(--page-plane)' }}>
              <span className="min-w-0 text-[var(--text-secondary)]">
                La palabra <b className="font-semibold text-[var(--text-primary)]">«{p.palabra_clave}»</b> está en {fmtNum(p.contenidos)} reels: no se puede saber de cuál vino el lead.
              </span>
              <Boton variante="secundario" onClick={() => navegar(`/flujos?tab=manychat&palabra=${encodeURIComponent(p.palabra_clave)}`)}>Arreglar</Boton>
            </li>
          ))}
          {sinReel.length > 0 && (
            <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-2.5 text-[12px]" style={{ background: 'var(--page-plane)' }}>
              <span className="min-w-0 text-[var(--text-secondary)]">
                {plural(sinReel.length, 'palabra', 'palabras')} de ManyChat sin unir a un reel: {sinReel.slice(0, 4).map((a) => `«${a.palabra_clave || a.nombre}»`).join(', ')}{sinReel.length > 4 ? '…' : ''}
              </span>
              <Boton variante="secundario" onClick={() => navegar('/flujos?tab=manychat')}>Enlazar</Boton>
            </li>
          )}
        </ul>
      )}
    </Desplegable>
  );
}
