import { useMemo, useState } from 'react';
import { api, plural } from '../api';
import Cabecera from '../componentes/Cabecera';
import {
  Boton, Chip, Desplegable, ErrorCarga, EsqueletoPantalla, FilaChips, Insignia, Seleccion, TablaResponsiva, Vacio,
  useAviso, useCarga, type Columna,
} from '../ui';

// Palabras de ManyChat: el puente entre la palabra que comentan en tu reel y
// el lead que entra al CRM. Se elige el reel de cada palabra y listo.

type Filtro = 'todas' | 'sin' | 'repetidas';

export default function Automatizaciones({ embebido = false }: { embebido?: boolean }) {
  const aviso = useAviso();
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [recuperando, setRecuperando] = useState(false);
  const { datos, error, recargar, setDatos } = useCarga(async () => {
    const [autos, contenidos] = await Promise.all([api<any[]>('/automatizaciones'), api<any>('/contenidos')]);
    return { autos, contenidos: Array.isArray(contenidos) ? contenidos : contenidos?.contenidos ?? [] };
  }, []);

  const repetidas = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of datos?.autos ?? []) {
      if (!a.palabra_clave || !a.contenido_id) continue;
      const k = a.palabra_clave.toLowerCase();
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [datos]);

  async function recuperar() {
    setRecuperando(true);
    try {
      const r = await api<any>('/atribucion/reatribuir', { method: 'POST' });
      aviso.exito(r.mensaje ?? 'Listo: se recuperó el origen de los leads anteriores.');
      await recargar(true);
    } catch (e: any) { aviso.error(e.message); } finally { setRecuperando(false); }
  }

  async function enlazar(a: any, contenidoId: string) {
    const titulo = datos?.contenidos.find((c: any) => c.id === contenidoId)?.titulo;
    setDatos((d) => (d ? { ...d, autos: d.autos.map((x: any) => (x.id === a.id ? { ...x, contenido_id: contenidoId || null } : x)) } : d));
    try {
      await api(`/automatizaciones/${a.id}`, { method: 'PATCH', json: { contenido_id: contenidoId || null } });
      if (contenidoId) {
        aviso.exito(<>Listo: «{a.palabra_clave || a.nombre}» → «{titulo}»</>, { texto: 'Recuperar leads anteriores', onClick: recuperar });
      } else aviso.info(`«${a.palabra_clave || a.nombre}» quedó sin reel.`);
    } catch (e: any) { aviso.error(e.message); recargar(true); }
  }

  const botonRecuperar = (
    <Boton tamano="sm" variante="secundario" onClick={recuperar} cargando={recuperando}>Recuperar el origen de leads anteriores</Boton>
  );

  if (error && !datos) return <ErrorCarga error={error} titulo="No pudimos cargar las palabras de ManyChat" onReintentar={() => recargar()} />;
  if (!datos) return <EsqueletoPantalla tarjetas={0} filas={5} />;

  const autos = datos.autos;
  const esRepetida = (a: any) => Boolean(a.palabra_clave && (repetidas.get(a.palabra_clave.toLowerCase()) ?? 0) > 1);
  const sinEnlazar = autos.filter((a: any) => !a.contenido_id);
  // Primero lo que necesita atención: sin reel, después las repetidas, después el resto.
  const ordenadas = [...autos].sort((a: any, b: any) => Number(!!a.contenido_id) - Number(!!b.contenido_id) || Number(esRepetida(b)) - Number(esRepetida(a)));
  const visibles = ordenadas.filter((a: any) => (filtro === 'sin' ? !a.contenido_id : filtro === 'repetidas' ? esRepetida(a) : true));

  const columnas: Array<Columna<any>> = [
    {
      clave: 'palabra', titulo: 'Palabra', enMovil: 'titulo',
      render: (a) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {a.palabra_clave ? <Insignia tono="azul">{a.palabra_clave}</Insignia> : <span className="text-[var(--text-muted)]">sin palabra</span>}
          {esRepetida(a) && <Insignia tono="amarillo">Repetida en {repetidas.get(a.palabra_clave.toLowerCase())} reels</Insignia>}
        </span>
      ),
    },
    {
      clave: 'auto', titulo: 'Automatización', enMovil: 'subtitulo',
      render: (a) => (
        <span className="block max-w-[260px] truncate">
          {/^Detectada:/i.test(a.nombre ?? '') ? 'Llegó desde ManyChat' : a.nombre}
          {a.recurso ? <span className="text-[var(--text-muted)]"> · {a.recurso}</span> : null}
        </span>
      ),
    },
    { clave: 'cuando', titulo: 'Cuándo', enMovil: 'ocultar', render: (a) => <span className="text-[var(--text-secondary)]">{a.tipo_disparo === 'dm' ? 'Mensaje directo' : 'Comentario'}</span> },
    {
      clave: 'reel', titulo: 'Reel de donde viene', enMovil: 'dato',
      render: (a) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Seleccion value={a.contenido_id ?? ''} onChange={(e) => enlazar(a, e.target.value)} aria-label={`Reel de ${a.palabra_clave ?? a.nombre}`}
            className={`w-full sm:max-w-[300px] ${a.contenido_id ? '' : '!border-[var(--status-warning)]'}`}>
            <option value="">— Elegí el reel —</option>
            {datos.contenidos.map((c: any) => <option key={c.id} value={c.id}>{c.titulo}</option>)}
          </Seleccion>
        </span>
      ),
    },
    { clave: 'leads', titulo: 'Leads', alinear: 'der', enMovil: 'esquina', render: (a) => <span className="cifras font-medium">{plural(a.leads, 'lead')}</span> },
  ];

  return (
    <div className={embebido ? '' : 'px-4 py-5 lg:px-8'}>
      {!embebido && (
        <Cabecera titulo="Palabras de ManyChat" subtitulo="El puente entre la palabra que comentan en tu reel y el lead que entra al CRM." derecha={botonRecuperar} />
      )}

      {autos.length === 0 ? (
        <Vacio icono="💬" titulo="Todavía no llegó ninguna palabra desde ManyChat"
          texto="Aparecen solas cuando ManyChat manda el primer lead al CRM. Conectalo en Configuración → ManyChat." />
      ) : (
        <div className="mt-3 space-y-3">
          {sinEnlazar.length > 0 && (
            <div className="rounded-xl p-3 text-[13px]" style={{ background: 'color-mix(in srgb, var(--status-warning) 10%, var(--surface-1))', border: '1px solid color-mix(in srgb, var(--status-warning) 30%, transparent)' }}>
              <b>⚠ {sinEnlazar.length === 1 ? '1 palabra sin reel' : `${sinEnlazar.length} palabras sin reel`}.</b>{' '}
              Los leads que entren por {sinEnlazar.length === 1 ? 'esa palabra' : 'esas palabras'} no se pueden atribuir a ningún contenido. Elegí el reel de cada una y después tocá «Recuperar el origen de leads anteriores».
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <FilaChips>
              <Chip activo={filtro === 'todas'} onClick={() => setFiltro('todas')} contador={autos.length}>Todas</Chip>
              <Chip activo={filtro === 'sin'} onClick={() => setFiltro('sin')} contador={sinEnlazar.length}>Sin reel</Chip>
              <Chip activo={filtro === 'repetidas'} onClick={() => setFiltro('repetidas')} contador={autos.filter(esRepetida).length}>Repetidas</Chip>
            </FilaChips>
            {embebido && <div className="sm:ml-auto">{botonRecuperar}</div>}
          </div>
          <TablaResponsiva columnas={columnas} filas={visibles} clave={(a) => a.id}
            vacio={<Vacio compacto icono="✓" titulo="Nada por acá" texto="Ninguna palabra en este filtro." />} />
        </div>
      )}

      <Desplegable className="mt-4" clave="manychat_consejos" titulo="Cómo saber siempre de qué reel vino cada lead">
        <ul className="space-y-1.5 text-[13px] text-[var(--text-secondary)]">
          <li>✓ <b>Lo más simple:</b> una palabra distinta por reel (GUIA1, GUIA2…).</li>
          <li>⚠ Si usás la misma palabra en varios reels, no se puede saber de cuál vino el lead: se le asigna al reel más reciente y queda marcado como dudoso. Sirve como referencia, pero no decidas solo con eso.</li>
        </ul>
        <Desplegable className="mt-3" tarjeta={false} titulo={<span className="text-[12px]">Para quien te configuró ManyChat</span>}>
          <p className="text-[12px] text-[var(--text-muted)]">
            Lo exacto: que ManyChat mande en la Solicitud externa el campo <code>ig_media_id</code> del post comentado (custom field <code>ig_media_id</code>). Con eso la atribución es exacta aunque se repita la palabra.
          </p>
        </Desplegable>
      </Desplegable>
    </div>
  );
}
