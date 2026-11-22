import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fmtDinero, fmtNum, plural } from '../../api';
import { Boton, BotonIcono, Carrusel, nombreVisible, useEsMovil } from '../../ui';
import { IconoPanel } from './iconos';
import type { DatosPanel, EstadoCuenta } from './tipos';
import { ritmoDelMes } from './Objetivo';

// "Para hoy": lo que conviene atender primero, con UN botón cada cosa.
// Estilo Kommo: tarjetas chicas (ícono + frase + dato + botón). En el
// celular se pasan con el dedo; en escritorio, grilla. Cada tarjeta se puede
// descartar por hoy (✕) y vuelve mañana si sigue pendiente.

type TonoAccion = 'rojo' | 'amarillo' | 'azul' | 'verde' | 'neutro';

export interface AccionHoy {
  id: string;
  tono: TonoAccion;
  icono: string;
  titulo: string;
  detalle?: React.ReactNode;
  boton: string;
  /** Navegar a… */
  a?: string;
  /** …o hacer algo en el Panel (desplegar una sección, abrir un diálogo). */
  onClick?: () => void;
  /** Cuántos días queda oculta al descartarla (por defecto, hasta mañana). */
  diasDescartar?: number;
}

const COLOR: Record<TonoAccion, string> = {
  rojo: 'var(--status-critical)', amarillo: 'var(--status-warning)', azul: 'var(--series-1)', verde: 'var(--status-good)', neutro: 'var(--text-secondary)',
};

const CLAVE = 'infocrm_panel_descartadas';
const hoy = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-DD local
function leer(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(CLAVE) ?? '{}') ?? {}; } catch { return {}; }
}
function guardar(v: Record<string, string>) {
  try { localStorage.setItem(CLAVE, JSON.stringify(v)); } catch { /* sin almacenamiento */ }
}

/** Arma las tarjetas con lo que ya trae el Panel (sin pedir nada más). */
export function armarParaHoy(d: DatosPanel, estado: EstadoCuenta | null, acciones: {
  verQuietos: () => void; verObjetivo: () => void; verMudos: () => void;
}): AccionHoy[] {
  const lista: AccionHoy[] = [];

  const q = d.estancados;
  if (q && q.total > 0) {
    const primero = q.leads[0];
    lista.push({
      id: 'quietos', tono: q.total > 50 ? 'rojo' : 'amarillo', icono: 'reloj',
      titulo: `${plural(q.total, 'lead quieto', 'leads quietos')} hace más de ${q.dias} días`,
      detalle: primero
        ? <>Empezá por <b className="font-medium text-[var(--text-primary)]">{nombreVisible(primero.nombre, primero.ig_username)}</b> ({primero.etapa}, {plural(primero.dias_quieto, 'día', 'días')})</>
        : undefined,
      boton: 'Ver y retomar', onClick: acciones.verQuietos,
    });
  }

  const m = d.metas;
  if (m?.tiene_meta && m.objetivo) {
    const { fraccion, diasRestantes } = ritmoDelMes();
    const NOMBRES: Record<string, string> = { leads: 'leads', calificados: 'calificados', ventas: 'ventas', ingresos: 'ingresos' };
    let peor: { k: string; atras: number; esperado: number; real: number } | null = null;
    for (const k of Object.keys(NOMBRES) as Array<keyof typeof m.objetivo>) {
      const objetivo = Number(m.objetivo[k] ?? 0);
      if (!(objetivo > 0)) continue;
      const real = Number(m.real?.[k] ?? 0);
      const esperado = objetivo * fraccion;
      const atras = ((esperado - real) / objetivo) * 100;
      if (!peor || atras > peor.atras) peor = { k, atras, esperado, real };
    }
    if (peor && peor.atras >= 15 && fraccion < 1) {
      const fmt = peor.k === 'ingresos' ? (n: number) => fmtDinero(n) : (n: number) => fmtNum(n);
      lista.push({
        id: 'ritmo', tono: 'rojo', icono: 'objetivo',
        titulo: `Vas atrás del ritmo en ${NOMBRES[peor.k]}`,
        detalle: <>Llevás {fmt(peor.real)} y a esta altura del mes deberías ir por {fmt(Math.round(peor.esperado))} · {plural(diasRestantes, 'día', 'días')} para el cierre</>,
        boton: 'Ver objetivo', onClick: acciones.verObjetivo,
      });
    }
  }

  const ambiguas = d.calidad?.palabras_ambiguas ?? [];
  if (ambiguas.length) {
    const p = ambiguas[0];
    lista.push({
      id: `palabra-${p.palabra_clave}`, tono: 'amarillo', icono: 'alerta',
      titulo: `La palabra «${p.palabra_clave}» está en ${fmtNum(p.contenidos)} reels`,
      detalle: <>No se puede saber de cuál vino cada lead que la comenta.{ambiguas.length > 1 ? ` Y ${plural(ambiguas.length - 1, 'palabra más', 'palabras más')}.` : ''}</>,
      boton: 'Arreglar', a: `/flujos?tab=manychat&palabra=${encodeURIComponent(p.palabra_clave)}`,
    });
  }

  if (estado && !estado.instagram_conectado && estado.leads_total > 0) {
    lista.push({
      id: 'instagram', tono: 'azul', icono: 'instagram', diasDescartar: 7,
      titulo: 'Instagram no está conectado',
      detalle: 'Conectalo para responder los DMs desde el Chat y que los comentarios entren solos.',
      boton: 'Conectar', a: '/conexiones?abrir=instagram',
    });
  }

  const sinReel = d.calidad?.automatizaciones_sin_contenido ?? [];
  if (sinReel.length) {
    const palabras = sinReel.map((a) => a.palabra_clave || a.nombre).filter(Boolean);
    lista.push({
      id: 'sin-reel', tono: 'azul', icono: 'enlace',
      titulo: `${plural(sinReel.length, 'palabra', 'palabras')} de ManyChat sin reel`,
      detalle: <>{palabras.slice(0, 3).map((p) => `«${p}»`).join(', ')}{palabras.length > 3 ? '…' : ''}: unilas a su reel para saber de dónde vienen los leads.</>,
      boton: 'Enlazar', a: '/flujos?tab=manychat',
    });
  }

  const mudos = d.mudos ?? [];
  if (mudos.length) {
    lista.push({
      id: 'mudos', tono: 'neutro', icono: 'mudo',
      titulo: `${plural(mudos.length, 'publicación', 'publicaciones')} sin ningún lead`,
      detalle: <>La última: «{mudos[0].titulo}». Revisá el gancho o el llamado a la acción.</>,
      boton: 'Revisar', onClick: acciones.verMudos,
    });
  }
  return lista;
}

export function ParaHoy({ acciones }: { acciones: AccionHoy[] }) {
  const navegar = useNavigate();
  const movil = useEsMovil(768);
  const [descartes, setDescartes] = useState(leer);
  const fecha = hoy();
  const visibles = acciones.filter((a) => !(descartes[a.id] && descartes[a.id] >= fecha));
  const ocultas = acciones.length - visibles.length;
  const mostrar = visibles.slice(0, 4);

  function descartar(a: AccionHoy) {
    const hasta = new Date();
    hasta.setDate(hasta.getDate() + (a.diasDescartar ?? 1) - 1);
    const v = { ...leer(), [a.id]: hasta.toLocaleDateString('sv-SE') };
    // Limpieza: lo que ya venció no se guarda más.
    for (const k of Object.keys(v)) if (v[k] < fecha) delete v[k];
    guardar(v);
    setDescartes(v);
  }
  function mostrarDescartadas() {
    const v = leer();
    for (const a of acciones) delete v[a.id];
    guardar(v);
    setDescartes(v);
  }

  const encabezado = (
    <div className="mb-2 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-tight">Para hoy</h2>
        {mostrar.length > 0 && <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">Lo que conviene atender primero</p>}
      </div>
      {ocultas > 0 && (
        <Boton variante="fantasma" onClick={mostrarDescartadas} className="-mb-1">
          {`Ver ${plural(ocultas, 'descartada', 'descartadas')}`}
        </Boton>
      )}
    </div>
  );

  if (!mostrar.length) {
    // "Todo al día" solo si de verdad no hay nada: si lo descartaste, sigue pendiente.
    return (
      <section aria-label="Para hoy">
        {encabezado}
        <div className="tarjeta flex items-center gap-2.5 px-3.5 py-3 text-[13px]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full" style={{ background: 'color-mix(in srgb, var(--status-good) 14%, transparent)', color: 'color-mix(in srgb, var(--status-good) 72%, var(--text-primary))' }}>
            <IconoPanel nombre="check" tam={15} grosor={2.4} />
          </span>
          {ocultas > 0
            ? <span><b className="font-semibold">Listo por hoy.</b> <span className="text-[var(--text-secondary)]">Lo que descartaste vuelve mañana si sigue pendiente.</span></span>
            : <span><b className="font-semibold">Todo al día.</b> <span className="text-[var(--text-secondary)]">No hay nada urgente para atender.</span></span>}
        </div>
      </section>
    );
  }

  const tarjetas = mostrar.map((a) => (
    <article key={a.id} className="tarjeta flex h-full flex-col gap-2 p-3.5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: `color-mix(in srgb, ${COLOR[a.tono]} 15%, transparent)`, color: `color-mix(in srgb, ${COLOR[a.tono]} 75%, var(--text-primary))` }}>
          <IconoPanel nombre={a.icono} tam={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold leading-snug">{a.titulo}</h3>
          {a.detalle && <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-secondary)]">{a.detalle}</p>}
        </div>
        <BotonIcono etiqueta={a.diasDescartar && a.diasDescartar > 1 ? `Ocultar ${a.diasDescartar} días` : 'Descartar por hoy'}
          tamano="md" className="-mr-2 -mt-1.5 shrink-0 text-[var(--text-muted)]" onClick={() => descartar(a)}>
          <IconoPanel nombre="perdido" tam={14} />
        </BotonIcono>
      </div>
      <div className="mt-auto">
        <Boton variante="secundario" onClick={() => (a.onClick ? a.onClick() : a.a && navegar(a.a))}
          icono={<IconoPanel nombre="flecha" tam={14} />} className="flex-row-reverse">
          {a.boton}
        </Boton>
      </div>
    </article>
  ));

  return (
    <section aria-label="Para hoy">
      {encabezado}
      {movil ? (
        <Carrusel anchoItem="min(80vw, 300px)" etiqueta="Para hoy">{tarjetas}</Carrusel>
      ) : (
        // Escritorio: tarjetas chicas del mismo tamaño, 4 en fila recién desde 1280 px;
        // en una laptop chica o una tablet, de a 2 (en 4 columnas de 180 px el texto
        // quedaba en una palabra por línea).
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {tarjetas}
        </div>
      )}
    </section>
  );
}
