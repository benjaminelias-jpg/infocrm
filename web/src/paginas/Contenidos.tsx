import { useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDinero, fmtNum, fmtPct, hace, plural } from '../api';
import {
  Ayuda, Banner, Boton, BotonIcono, Carrusel, Chip, ErrorCarga, Esqueleto, FilaChips, Insignia, ItemMenu, Menu,
  SeparadorMenu, Vacio, useAviso, useCarga, useEsMovil, useParamUrl,
} from '../ui';
import Icono from '../componentes/Iconos';
import { RangoFechas, type Rango } from '../componentes/Cabecera';
import Portada from '../componentes/contenidos-leads/Portada';
import MenuAngulo, { textoAngulo } from '../componentes/contenidos-leads/MenuAngulo';
import PanelContenido from '../componentes/contenidos-leads/PanelContenido';
import NuevoContenido from '../componentes/contenidos-leads/NuevoContenido';
import { ANGULO, ANGULOS, MIN_LEADS_ROL, ROL_CONTENIDO, TIPO_CONTENIDO } from '../componentes/contenidos-leads/textos';

// Contenidos: qué reel trajo cada lead, cada reunión y cada venta.
// - Período, ángulo, orden y forma de contar en la URL (Atrás y recargar funcionan).
// - Arriba, la respuesta rápida: qué repetir y qué revisar.
// - Escritorio: tabla con el total de LO QUE SE VE. Celular: tarjetas con la plata a la vista.
// - Tocar un contenido abre su ficha (?contenido=<id>): sus números, qué hacer y sus leads.
// - Si Instagram no está conectado, se explica y se lleva a Configuración.

type Columna = 'leads' | 'reuniones_agendadas' | 'ventas' | 'ingresos' | 'tasa_lead_venta' | 'valor_por_lead';

const COLUMNAS: Array<{ clave: Columna; etiqueta: string; fmt: (v: any) => string; ayuda?: string; desde?: 'lg' | 'xl'; ancho: string }> = [
  { clave: 'leads', etiqueta: 'Leads', fmt: fmtNum, ancho: 'w-[8%]' },
  { clave: 'reuniones_agendadas', etiqueta: 'Reuniones', fmt: fmtNum, desde: 'xl', ancho: 'w-[10%]' },
  { clave: 'ventas', etiqueta: 'Ventas', fmt: fmtNum, ancho: 'w-[8%]' },
  { clave: 'ingresos', etiqueta: 'Ingresos', fmt: (v) => fmtDinero(v), ayuda: 'Lo que facturaron (hasta hoy) los leads que vinieron de este contenido en el período. Las devoluciones ya están restadas.', ancho: 'w-[13%]' },
  { clave: 'tasa_lead_venta', etiqueta: 'Compran', fmt: fmtPct, ayuda: 'Qué parte de los leads de este contenido terminó comprando.', desde: 'lg', ancho: 'w-[11%]' },
  { clave: 'valor_por_lead', etiqueta: 'Por lead', fmt: (v) => fmtDinero(v), ayuda: 'Cuánto facturó, en promedio, cada lead que trajo este contenido.', desde: 'xl', ancho: 'w-[11%]' },
];
const OCULTA: Record<string, string> = { lg: 'hidden lg:table-cell', xl: 'hidden xl:table-cell' };

const DIA = 86_400_000;
const CLAVE_BANNER = 'infocrm_contenidos_sin_ig';

function bannerCerrado() {
  try { return Date.now() - Number(localStorage.getItem(CLAVE_BANNER) ?? 0) < 7 * DIA; } catch { return false; }
}

interface Respuesta { filas: any[]; instagram: { conectado: boolean; usuario: string | null; ultimo_sync_en: string | null; con_error: boolean }; dias_rol: number }

export default function Contenidos() {
  const aviso = useAviso();
  const navegar = useNavigate();
  const movil = useEsMovil(768);
  const [periodo, setPeriodo] = useParamUrl<Rango>('periodo', '90');
  const [angulo, setAngulo] = useParamUrl<string>('angulo', '');
  const [orden, setOrden] = useParamUrl<Columna>('orden', 'ingresos');
  const [modelo, setModelo] = useParamUrl<'primer' | 'ultimo'>('modelo', 'primer');
  const [params, setParams] = useSearchParams();
  const abiertoId = params.get('contenido');
  const [sincronizando, setSincronizando] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [sinBanner, setSinBanner] = useState(bannerCerrado);

  const desde = useMemo(() => (periodo === 'todo' ? null : new Date(Date.now() - Number(periodo) * DIA).toISOString()), [periodo]);
  const { datos, setDatos, cargando, error, recargar } = useCarga<Respuesta>(() => {
    const p = new URLSearchParams({ modelo: modelo === 'ultimo' ? 'ultimo_toque' : 'primer_toque' });
    if (desde) p.set('desde', desde);
    return api<Respuesta>(`/contenidos/rendimiento?${p}`);
  }, [desde, modelo]);

  const filas = datos?.filas ?? [];
  // Lo último cargado, para que "Deshacer" (que se toca después) no mire datos viejos.
  const filasRef = useRef(filas);
  filasRef.current = filas;
  const ig = datos?.instagram;
  const diasRol = datos?.dias_rol ?? 90;
  const columna = COLUMNAS.some((c) => c.clave === orden) ? orden : 'ingresos';

  // Lo que se ve (filtrado y ordenado). "Sin reel de origen" siempre al final.
  const visibles = useMemo(() => {
    const reales = filas.filter((f) => f.id && (!angulo || (angulo === 'sin' ? !f.angulo : f.angulo === angulo)));
    reales.sort((a, b) => Number(b[columna] ?? 0) - Number(a[columna] ?? 0));
    const sin = filas.find((f) => !f.id);
    return !angulo && sin ? [...reales, sin] : reales;
  }, [filas, angulo, columna]);

  // El total es SIEMPRE de lo que se ve (con el filtro de ángulo, solo de esos).
  const totales = useMemo(() => {
    const t = visibles.reduce((a, f) => ({
      leads: a.leads + Number(f.leads ?? 0), reuniones: a.reuniones + Number(f.reuniones_agendadas ?? 0),
      ventas: a.ventas + Number(f.ventas ?? 0), ingresos: a.ingresos + Number(f.ingresos ?? 0),
    }), { leads: 0, reuniones: 0, ventas: 0, ingresos: 0 });
    return { ...t, compran: t.leads ? (t.ventas / t.leads) * 100 : 0, porLead: t.leads ? t.ingresos / t.leads : 0 };
  }, [visibles]);
  const maxIngresos = Math.max(1, ...visibles.map((f) => Number(f.ingresos ?? 0)));
  const nombreFiltro = angulo === 'sin' ? 'sin ángulo' : angulo ? ANGULO[angulo]?.etiqueta : null;
  const etiquetaTotal = nombreFiltro ? `Total ${angulo === 'sin' ? nombreFiltro : `de ${nombreFiltro}`} (${visibles.length})` : 'Total';

  // Respuesta rápida: qué repetir y qué revisar (de lo que se ve).
  const destacados = useMemo(() => {
    const reales = visibles.filter((f) => f.id);
    const masVende = [...reales].filter((f) => Number(f.ingresos) > 0).sort((a, b) => b.ingresos - a.ingresos)[0];
    const convierte = [...reales].filter((f) => Number(f.leads) >= 10 && Number(f.ventas) > 0 && f.id !== masVende?.id)
      .sort((a, b) => b.tasa_lead_venta - a.tasa_lead_venta)[0];
    const sinVentas = [...reales].filter((f) => Number(f.leads) >= 10 && Number(f.ventas) === 0).sort((a, b) => b.leads - a.leads)[0];
    return [
      masVende && { f: masVende, titulo: 'El que más vende', valor: fmtDinero(masVende.ingresos), detalle: `${plural(masVende.ventas, 'venta')} de ${plural(masVende.leads, 'lead')}`, tono: 'color-mix(in srgb, var(--status-good) 75%, var(--text-primary))' },
      convierte && { f: convierte, titulo: 'El que mejor convierte', valor: `${fmtPct(convierte.tasa_lead_venta)} compra`, detalle: `${plural(convierte.ventas, 'venta')} de ${plural(convierte.leads, 'lead')}`, tono: 'var(--series-1)' },
      sinVentas && { f: sinVentas, titulo: 'Muchos leads, cero ventas', valor: plural(sinVentas.leads, 'lead'), detalle: 'Revisá qué les ofrecés después', tono: 'color-mix(in srgb, var(--status-warning) 60%, var(--text-primary))' },
    ].filter(Boolean) as Array<{ f: any; titulo: string; valor: string; detalle: string; tono: string }>;
  }, [visibles]);

  // ---------------- Ficha del contenido en la URL ----------------
  const abrir = useCallback((id: string) => {
    setParams((prev) => { const p = new URLSearchParams(prev); p.set('contenido', id); return p; },
      { replace: Boolean(new URLSearchParams(window.location.search).get('contenido')), state: { contenidoApilado: true } });
  }, [setParams]);
  const cerrar = useCallback(() => {
    if ((window.history.state as any)?.usr?.contenidoApilado) { window.history.back(); return; }
    setParams((prev) => { const p = new URLSearchParams(prev); p.delete('contenido'); return p; }, { replace: true });
  }, [setParams]);
  const abierta = abiertoId ? filas.find((f) => f.id === abiertoId) : null;

  function tocar(f: any) {
    if (f.id) abrir(f.id);
    else navegar('/leads?vista=sin_atribuir');
  }

  // ---------------- Acciones ----------------
  async function cambiarAngulo(id: string, nuevoAngulo: string | null, deshaciendo = false) {
    const previo = filasRef.current.find((f) => f.id === id)?.angulo ?? null;
    if (previo === nuevoAngulo) return;
    const poner = (a: string | null) => setDatos((d) => (d ? { ...d, filas: d.filas.map((f) => (f.id === id ? { ...f, angulo: a, etapa_embudo: a ? ANGULO[a]?.embudo ?? null : null } : f)) } : d));
    poner(nuevoAngulo);
    try {
      await api(`/contenidos/${id}`, { method: 'PATCH', json: { angulo: nuevoAngulo } });
      if (!deshaciendo) {
        aviso.exito(nuevoAngulo ? `Ángulo guardado: ${textoAngulo(nuevoAngulo)}` : 'Ángulo quitado', {
          texto: 'Deshacer', onClick: () => cambiarAngulo(id, previo, true),
        });
      }
    } catch (e: any) {
      poner(previo);
      aviso.error(e.message ?? 'No se pudo guardar el ángulo');
    }
  }

  async function sincronizar() {
    setSincronizando(true);
    try {
      const r = await api<any>('/instagram/sincronizar', { method: 'POST' });
      if (r.ok) {
        aviso.exito(r.mensaje);
        recargar(true);
      } else {
        aviso.error(r.mensaje, { texto: r.motivo === 'sin_conexion' ? 'Conectar' : 'Ver la conexión', onClick: () => navegar('/conexiones?abrir=instagram') });
        recargar(true);
      }
    } catch (e: any) {
      aviso.error(e.message);
    } finally {
      setSincronizando(false);
    }
  }

  // ---------------- Cabecera ----------------
  const botonIg = ig?.conectado ? (
    movil
      ? <BotonIcono etiqueta="Traer lo nuevo de Instagram" variante="secundario" onClick={sincronizar} disabled={sincronizando}>
          <span className={sincronizando ? 'animate-spin' : ''}><Icono nombre="sincronizar" tam={16} /></span>
        </BotonIcono>
      : <Boton tamano="sm" onClick={sincronizar} cargando={sincronizando} icono={<Icono nombre="sincronizar" tam={15} />}>
          {sincronizando ? 'Trayendo…' : 'Actualizar'}
        </Boton>
  ) : null;

  const menuMas = (
    <Menu alinear="derecha" ancho={290} titulo="Cómo contar los leads" disparador={({ alternar, abierto, ref }) => (
      <BotonIcono ref={ref} etiqueta="Más opciones" variante="secundario" onClick={alternar} aria-haspopup="menu" aria-expanded={abierto}>
        <Icono nombre="puntos" tam={17} />
      </BotonIcono>
    )}>
      <ItemMenu activo={modelo === 'primer'} onClick={() => setModelo('primer')} descripcion="El contenido que lo trajo por primera vez">
        Por el reel que lo trajo
      </ItemMenu>
      <ItemMenu activo={modelo === 'ultimo'} onClick={() => setModelo('ultimo')} descripcion="El último que vio antes de avanzar">
        Por el último reel que vio
      </ItemMenu>
      <SeparadorMenu />
      <ItemMenu icono={<Icono nombre="mas" tam={15} />} onClick={() => setNuevo(true)}>Agregar un contenido a mano</ItemMenu>
      {!ig?.conectado && <ItemMenu icono={<Icono nombre="conexiones" tam={15} />} onClick={() => navegar('/conexiones?abrir=instagram')}>Conectar Instagram</ItemMenu>}
    </Menu>
  );

  return (
    <div className="px-4 py-5 lg:px-8">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] font-semibold tracking-tight sm:text-[20px]">Contenidos</h1>
            <button type="button" onClick={() => setNuevo(true)} aria-label="Agregar un contenido" title="Agregar un contenido"
              className="ui-foco flex h-8 w-8 items-center justify-center rounded-lg text-white shadow-sm hover:brightness-110"
              style={{ background: 'var(--series-1)' }}>
              <Icono nombre="mas" tam={17} />
            </button>
          </div>
          <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
            {ig?.conectado
              ? <><span className="hidden sm:inline">Qué reel trajo cada lead y cada venta · </span><span className="whitespace-nowrap">@{ig.usuario ?? 'tu cuenta'}{ig.ultimo_sync_en ? `, actualizado ${hace(ig.ultimo_sync_en)}` : ''}</span></>
              : 'Qué reel trajo cada lead y cada venta'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">{botonIg}{menuMas}</div>
      </header>

      {ig && !ig.conectado && !sinBanner && (
        <div className="mt-3">
          <Banner tono="info" icono={movil ? undefined : <Icono nombre="contenidos" tam={18} />}
            onCerrar={() => { setSinBanner(true); try { localStorage.setItem(CLAVE_BANNER, String(Date.now())); } catch { /* sin almacenamiento */ } }}
            accion={movil ? undefined : <Boton tamano="sm" variante="primario" onClick={() => navegar('/conexiones?abrir=instagram')}>Conectar Instagram</Boton>}>
            <b className="font-semibold">Instagram no está conectado.</b>{' '}
            <span className="text-[var(--text-secondary)]">
              {movil
                ? 'Conectalo para ver las portadas, vistas y me gusta de tus reels.'
                : 'Conectalo para ver las portadas, vistas y me gusta de tus reels. Mientras tanto, los reels aparecen solos cuando alguien comenta tu palabra clave.'}
            </span>
            {movil && (
              <Boton tamano="sm" variante="primario" className="mt-2" onClick={() => navegar('/conexiones?abrir=instagram')}>Conectar Instagram</Boton>
            )}
          </Banner>
        </div>
      )}
      {ig?.conectado && ig.con_error && (
        <div className="mt-3">
          <Banner tono="aviso" accion={<Boton tamano="sm" onClick={() => navegar('/conexiones?abrir=instagram')}>Revisar la conexión</Boton>}>
            La última vez no pudimos traer tus reels de Instagram.
          </Banner>
        </div>
      )}

      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <RangoFechas rango={periodo} setRango={(r) => setPeriodo(r)} />
          <Menu alinear="izquierda" titulo="Ángulo" ancho={220} disparador={({ alternar, abierto }) => (
            <Boton variante="secundario" tamano="sm" onClick={alternar} aria-expanded={abierto}>
              {angulo === 'sin' ? 'Sin ángulo' : angulo ? (ANGULOS.find((a) => a.valor === angulo)?.etiqueta ?? 'Ángulo') : 'Todos los ángulos'} ▾
            </Boton>
          )}>
            <ItemMenu activo={!angulo} onClick={() => setAngulo('')}>Todos los ángulos</ItemMenu>
            {ANGULOS.map((a) => <ItemMenu key={a.valor} activo={angulo === a.valor} onClick={() => setAngulo(a.valor)}>{a.etiqueta}</ItemMenu>)}
            {filas.some((f) => f.id && !f.angulo) && <ItemMenu activo={angulo === 'sin'} onClick={() => setAngulo('sin')}>Sin ángulo</ItemMenu>}
          </Menu>
          {modelo === 'ultimo' && (
            <button type="button" onClick={() => setModelo('primer')} className="ui-foco rounded-md" aria-label="Volver a contar por el reel que trajo a cada lead">
              <Insignia tono="azul">Contando por el último reel que vio <Icono nombre="cerrar" tam={11} /></Insignia>
            </button>
          )}
        </div>
      </div>

      {error && !datos ? (
        <div className="tarjeta mt-4"><ErrorCarga error={error} titulo="No pudimos cargar tus contenidos" onReintentar={() => recargar()} /></div>
      ) : !datos ? (
        <div className="mt-4 space-y-2" aria-busy="true" aria-label="Cargando contenidos">
          <div className="hidden gap-3 md:grid md:grid-cols-3">{[0, 1, 2].map((i) => <Esqueleto key={i} alto={112} className="rounded-xl" />)}</div>
          {Array.from({ length: 6 }, (_, i) => <Esqueleto key={i} alto={movil ? 96 : 60} className="rounded-xl" />)}
        </div>
      ) : filas.filter((f) => f.id).length === 0 ? (
        <div className="tarjeta mt-4">
          <Vacio icono={<Icono nombre="contenidos" tam={24} />} titulo="Todavía no hay contenidos"
            texto={ig?.conectado
              ? 'Tocá «Actualizar» para traer tus reels con sus números. También aparecen solos cuando alguien comenta una palabra clave.'
              : 'Conectá Instagram y traemos tus reels con sus números. También aparecen solos cuando alguien comenta una palabra clave.'}
            accion={(
              <div className="flex flex-wrap justify-center gap-2">
                {ig?.conectado
                  ? <Boton variante="primario" onClick={sincronizar} cargando={sincronizando}>Traer mis reels</Boton>
                  : <Boton variante="primario" onClick={() => navegar('/conexiones?abrir=instagram')}>Conectar Instagram</Boton>}
                <Boton onClick={() => setNuevo(true)}>Agregar uno a mano</Boton>
              </div>
            )} />
        </div>
      ) : (
        <div className={`transition-opacity ${cargando ? 'opacity-60' : ''}`} aria-busy={cargando}>
          {destacados.length > 0 && (
            <div className="mt-4">
              <Carrusel soloMovil columnas={3} etiqueta="Lo más importante" anchoItem="min(78vw, 290px)">
                {destacados.map((d) => (
                  <button key={d.titulo} type="button" onClick={() => abrir(d.f.id)}
                    className="tarjeta ui-foco flex h-full w-full items-start gap-3 p-3 text-left transition-shadow hover:shadow-md">
                    <Portada url={d.f.thumbnail_url} tipo={d.f.tipo} embudo={d.f.angulo ? ANGULO[d.f.angulo]?.embudo : null} tam="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide" style={{ color: d.tono }}>{d.titulo}</span>
                      <span className="mt-0.5 block truncate text-[13px] font-medium">{d.f.titulo}</span>
                      <span className="cifras mt-1 block text-[18px] font-semibold leading-tight">{d.valor}</span>
                      <span className="block truncate text-[12px] text-[var(--text-muted)]">{d.detalle}</span>
                    </span>
                  </button>
                ))}
              </Carrusel>
            </div>
          )}

          {visibles.length === 0 ? (
            <div className="tarjeta mt-4">
              <Vacio compacto icono={<Icono nombre="buscar" tam={20} />} titulo={`Ningún contenido ${nombreFiltro ? (angulo === 'sin' ? 'sin ángulo' : `de ${nombreFiltro}`) : ''}`}
                accion={<Boton onClick={() => setAngulo('')}>Ver todos</Boton>} />
            </div>
          ) : movil ? (
            // ---------------- Celular: tarjetas ----------------
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-[12px]" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-hairline)' }}>
                <span className="font-semibold">{etiquetaTotal}</span>
                <span className="cifras text-right text-[var(--text-secondary)]">
                  {plural(totales.leads, 'lead')} · {plural(totales.ventas, 'venta')} · <b className="text-[var(--text-primary)]">{fmtDinero(totales.ingresos)}</b>
                </span>
              </div>
              <div className="flex items-center justify-end gap-1 text-[12px] text-[var(--text-muted)]">
                Ordenar por
                <Menu alinear="derecha" titulo="Ordenar por" ancho={220} disparador={({ alternar, abierto, ref }) => (
                  <button ref={ref} type="button" onClick={alternar} aria-expanded={abierto}
                    className="ui-foco inline-flex h-8 items-center gap-1 rounded-md px-1.5 font-medium text-[var(--text-primary)]">
                    {COLUMNAS.find((c) => c.clave === columna)?.etiqueta.toLowerCase()}
                    <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                )}>
                  {COLUMNAS.map((c) => <ItemMenu key={c.clave} activo={c.clave === columna} onClick={() => setOrden(c.clave)}>{c.etiqueta}</ItemMenu>)}
                </Menu>
              </div>
              <ul className="space-y-2">
                {visibles.map((f) => (
                  <li key={f.id ?? 'sin'}><TarjetaContenido f={f} onAbrir={() => tocar(f)} onAngulo={(a) => cambiarAngulo(f.id, a)} /></li>
                ))}
              </ul>
            </div>
          ) : (
            // ---------------- Escritorio: tabla ----------------
            <div className="tarjeta mt-4 overflow-hidden">
              <table className="w-full table-fixed text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-4 py-2.5 font-medium">Contenido</th>
                    {COLUMNAS.map((c) => (
                      <th key={c.clave} className={`${c.ancho} whitespace-nowrap px-2 py-2.5 text-right font-medium ${c.desde ? OCULTA[c.desde] : ''}`}
                        aria-sort={columna === c.clave ? 'descending' : undefined}>
                        <span className="inline-flex items-center justify-end gap-0.5">
                          <button type="button" onClick={() => setOrden(c.clave)}
                            className={`ui-foco rounded uppercase tracking-wide hover:text-[var(--text-primary)] ${columna === c.clave ? 'font-semibold text-[var(--text-primary)]' : ''}`}>
                            {c.etiqueta}{columna === c.clave && <span aria-hidden> ↓</span>}
                          </button>
                          {c.ayuda && <Ayuda titulo={c.etiqueta}>{c.ayuda}</Ayuda>}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((f) => (
                    <FilaContenido key={f.id ?? 'sin'} f={f} maxIngresos={maxIngresos} onAbrir={() => tocar(f)} onAngulo={(a) => cambiarAngulo(f.id, a)} />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-[var(--baseline)] text-[12px] font-semibold">
                    <td className="px-4 py-2.5">{etiquetaTotal}</td>
                    <td className="cifras px-2 py-2.5 text-right">{fmtNum(totales.leads)}</td>
                    <td className={`cifras px-2 py-2.5 text-right ${OCULTA.xl}`}>{fmtNum(totales.reuniones)}</td>
                    <td className="cifras px-2 py-2.5 text-right">{fmtNum(totales.ventas)}</td>
                    <td className="cifras px-2 py-2.5 text-right">{fmtDinero(totales.ingresos)}</td>
                    <td className={`cifras px-2 py-2.5 text-right ${OCULTA.lg}`}>{fmtPct(totales.compran)}</td>
                    <td className={`cifras px-2 py-2.5 text-right ${OCULTA.xl}`}>{fmtDinero(totales.porLead)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">
            {modelo === 'ultimo' ? 'Cada lead cuenta para el último reel que vio antes de avanzar.' : 'Cada lead cuenta para el reel que lo trajo.'}{' '}
            El período mira cuándo entró el lead y suma todo lo que hizo después.
          </p>
        </div>
      )}

      {abierta && <PanelContenido key={abierta.id} fila={abierta} diasRol={diasRol} onCerrar={cerrar} onAngulo={(a) => cambiarAngulo(abierta.id, a)} />}
      {nuevo && (
        <NuevoContenido onCerrar={() => setNuevo(false)}
          onCreado={(c) => { setNuevo(false); aviso.exito(`«${c.titulo}» agregado`, { texto: 'Ver', onClick: () => abrir(c.id) }); recargar(true); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------

function RolInsignia({ f }: { f: any }) {
  const rol = f.id && Number(f.rol_leads) >= MIN_LEADS_ROL ? ROL_CONTENIDO[f.rol] : null;
  if (!rol) return null;
  return <Insignia tono={rol.tono}>{rol.etiqueta}</Insignia>;
}

function Metricas({ f }: { f: any }) {
  const partes: string[] = [TIPO_CONTENIDO[f.tipo] ?? 'Contenido'];
  if (Number(f.ig_reproducciones) > 0) partes.push(`${fmtNum(f.ig_reproducciones)} vistas`);
  else if (Number(f.ig_alcance) > 0) partes.push(`${fmtNum(f.ig_alcance)} de alcance`);
  if (Number(f.ig_likes) > 0) partes.push(`${fmtNum(f.ig_likes)} me gusta`);
  return <span className="truncate">{partes.join(' · ')}</span>;
}

function Dudosos({ f }: { f: any }) {
  if (!(Number(f.leads_dudosos) > 0)) return null;
  return (
    <span className="inline-flex items-center gap-0.5 whitespace-nowrap" style={{ color: 'color-mix(in srgb, var(--status-warning) 65%, var(--text-primary))' }}>
      {fmtNum(f.leads_dudosos)} de {fmtNum(f.leads)} con origen dudoso
      <span onClick={(e) => e.stopPropagation()}>
        <Ayuda titulo="Origen dudoso">Comentaron una palabra que usás en varios contenidos, así que no sabemos con seguridad cuál los trajo. Usá una palabra distinta en cada reel.</Ayuda>
      </span>
    </span>
  );
}

function FilaContenido({ f, maxIngresos, onAbrir, onAngulo }: { f: any; maxIngresos: number; onAbrir: () => void; onAngulo: (a: string | null) => void }) {
  const sin = !f.id;
  return (
    <tr onClick={onAbrir} className="cursor-pointer border-b border-[var(--border-hairline)] last:border-0 hover:bg-[var(--page-plane)]">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-3">
          {sin
            ? <span className="flex h-[52px] w-9 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)]" style={{ background: 'var(--page-plane)' }} aria-hidden>?</span>
            : <Portada url={f.thumbnail_url} tipo={f.tipo} embudo={f.angulo ? ANGULO[f.angulo]?.embudo : null} tam="sm" />}
          <div className="min-w-0 flex-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); onAbrir(); }}
              className="ui-foco block w-full min-w-0 truncate rounded text-left font-medium hover:underline">
              {sin ? 'Sin reel de origen' : f.titulo}
            </button>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--text-muted)]">
              {sin ? <span>Leads que no sabemos de qué reel vinieron · ver quiénes son →</span> : (
                <>
                  <MenuAngulo angulo={f.angulo} onElegir={onAngulo} compacto />
                  <RolInsignia f={f} />
                  <Metricas f={f} />
                  <Dudosos f={f} />
                </>
              )}
            </div>
          </div>
        </div>
      </td>
      {COLUMNAS.map((c) => (
        <td key={c.clave} className={`cifras px-2 py-2.5 text-right ${c.desde ? OCULTA[c.desde] : ''} ${c.clave === 'ingresos' ? 'font-semibold' : ''}`}>
          {c.fmt(f[c.clave])}
          {c.clave === 'ingresos' && !sin && Number(f.ingresos) > 0 && (
            <span className="ml-auto mt-1 block h-1 rounded-full" aria-hidden
              style={{ width: `${Math.max(6, (Number(f.ingresos) / maxIngresos) * 100)}%`, marginLeft: 'auto', background: 'var(--series-3)' }} />
          )}
        </td>
      ))}
    </tr>
  );
}

function TarjetaContenido({ f, onAbrir, onAngulo }: { f: any; onAbrir: () => void; onAngulo: (a: string | null) => void }) {
  const sin = !f.id;
  return (
    <article role="button" tabIndex={0} onClick={onAbrir} onKeyDown={(e) => { if (e.key === 'Enter') onAbrir(); }}
      className="tarjeta ui-foco flex cursor-pointer gap-3 p-3 active:bg-[var(--page-plane)]">
      {sin
        ? <span className="flex h-[72px] w-11 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)]" style={{ background: 'var(--page-plane)' }} aria-hidden>?</span>
        : <Portada url={f.thumbnail_url} tipo={f.tipo} embudo={f.angulo ? ANGULO[f.angulo]?.embudo : null} tam="md" />}
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[14px] font-medium leading-snug">{sin ? 'Sin reel de origen' : f.titulo}</div>
        <div className="mt-1 flex items-baseline justify-between gap-2">
          <span className="cifras text-[18px] font-semibold leading-tight">{fmtDinero(f.ingresos)}</span>
          <span className="cifras shrink-0 text-[12px] text-[var(--text-secondary)]">{fmtPct(f.tasa_lead_venta)} compra</span>
        </div>
        <div className="cifras mt-0.5 text-[12px] text-[var(--text-muted)]">
          {plural(f.ventas, 'venta')} · {plural(f.leads, 'lead')} · {plural(f.reuniones_agendadas, 'reunión', 'reuniones')}
        </div>
        {!sin && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <MenuAngulo angulo={f.angulo} onElegir={onAngulo} compacto />
            <RolInsignia f={f} />
            <Dudosos f={f} />
          </div>
        )}
      </div>
    </article>
  );
}
