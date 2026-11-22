import { useState } from 'react';
import { api, fmtDinero, plural } from '../../api';
import {
  Boton, Campo, Copiar, Desplegable, Dialogo, Entrada, ErrorCarga, Esqueleto, ItemMenu, SeparadorMenu, TituloSeccion, Vacio,
  useAviso, useCarga,
} from '../../ui';
import { EntradaDinero, MenuPuntos, montoEnCampo, parseMonto } from './comun';
import type { Curso, PropsPestana } from './tipos';

// Cursos: lista compacta con su precio, su link de pago (se ve, se copia y
// se abre) y cuánto se vendió este mes. Nada se borra con un toque: un curso
// con ventas se archiva (sale de "Registrar venta" y el historial queda).

const linkValido = (s: string) => /^https:\/\/[^\s.]+\.[^\s]+$/i.test(s.trim());
function dominioCorto(url: string) {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname.length > 1 ? '/…' : ''}`;
  } catch { return url; }
}

export default function Cursos({ version, onCambio, nuevo }: PropsPestana) {
  const aviso = useAviso();
  const carga = useCarga(() => api<Curso[]>('/ux/finanzas/cursos'), [version]);
  const [dialogo, setDialogo] = useState<Curso | 'nuevo' | null>(nuevo ? 'nuevo' : null);
  const [borrando, setBorrando] = useState<Curso | null>(null);
  const cursos = carga.datos ?? [];
  const activos = cursos.filter((c) => c.activo);
  const archivados = cursos.filter((c) => !c.activo);

  async function patch(c: Curso, datos: Partial<Curso>, texto: string, deshacer?: Partial<Curso>) {
    try {
      const nuevoCurso = await api<Curso>(`/productos/${c.id}`, { method: 'PATCH', json: datos });
      carga.setDatos((xs) => xs?.map((x) => (x.id === c.id ? { ...x, ...nuevoCurso } : x)) ?? xs);
      onCambio();
      aviso.exito(texto, deshacer ? { texto: 'Deshacer', onClick: () => patch(c, deshacer, 'Listo, como estaba') } : undefined);
    } catch (e: any) { aviso.error(e.message); }
  }

  const fila = (c: Curso) => (
    <FilaCurso key={c.id} c={c}
      onEditar={() => setDialogo(c)}
      onLink={(link) => patch(c, { link_pago: link }, 'Link de pago guardado: ya aparece en el Chat')}
      onArchivar={() => patch(c, { activo: false }, `«${c.nombre}» archivado: ya no aparece al vender`, { activo: true })}
      onRestaurar={() => patch(c, { activo: true }, `«${c.nombre}» vuelve a aparecer al vender`)}
      onBorrar={() => setBorrando(c)} />
  );

  return (
    <section className="space-y-3" aria-label="Cursos">
      <TituloSeccion titulo="Cursos" onMas={() => setDialogo('nuevo')} textoMas="Nuevo curso"
        subtitulo={carga.datos ? `${plural(activos.length, 'curso')} · el precio se completa solo al vender y el link se manda desde el Chat` : ' '} />
      {carga.error && !carga.datos ? (
        <div className="tarjeta"><ErrorCarga error={carga.error} titulo="No pudimos cargar tus cursos" onReintentar={() => carga.recargar()} /></div>
      ) : !carga.datos ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando">{[0, 1, 2].map((i) => <Esqueleto key={i} alto={72} className="rounded-xl" />)}</div>
      ) : activos.length === 0 && archivados.length === 0 ? (
        <div className="tarjeta">
          <Vacio icono="🎓" titulo="Cargá tu primer curso"
            texto="Con su precio y su link de pago (Stripe, Hotmart, Mercado Pago…). Al registrar una venta el monto se completa solo, y el link lo mandás desde el Chat con un toque."
            accion={<Boton variante="primario" onClick={() => setDialogo('nuevo')}>Agregar curso</Boton>} />
        </div>
      ) : (
        <>
          {activos.length > 0
            ? <div role="list" className="tarjeta divide-y divide-[var(--border-hairline)]">{activos.map(fila)}</div>
            : <p className="text-[12px] text-[var(--text-muted)]">Todos tus cursos están archivados.</p>}
          {archivados.length > 0 && (
            <Desplegable clave="fin-cursos-archivados" titulo={`Archivados (${archivados.length})`} subtitulo="No aparecen al vender; sus ventas quedan">
              <div role="list" className="-mx-3.5 -mb-3.5 divide-y divide-[var(--border-hairline)] border-t border-[var(--border-hairline)]">{archivados.map(fila)}</div>
            </Desplegable>
          )}
        </>
      )}

      {dialogo && <DialogoCurso curso={dialogo === 'nuevo' ? null : dialogo} onCerrar={() => setDialogo(null)}
        onListo={(texto) => { setDialogo(null); carga.recargar(true); onCambio(); aviso.exito(texto); }} />}
      {borrando && (
        <Dialogo abierto onCerrar={() => setBorrando(null)} titulo={`¿Borrar «${borrando.nombre}»?`} autoFoco={false}
          descripcion="No tiene ventas, así que no se pierde nada. No se puede deshacer."
          pie={<>
            <Boton variante="fantasma" onClick={() => setBorrando(null)}>Cancelar</Boton>
            <Boton variante="peligro" onClick={async () => {
              const c = borrando;
              try {
                await api(`/productos/${c.id}`, { method: 'DELETE' });
                carga.setDatos((xs) => xs?.filter((x) => x.id !== c.id) ?? xs);
                setBorrando(null); onCambio(); aviso.exito(`«${c.nombre}» borrado`);
              } catch (e: any) { aviso.error(e.message); }
            }}>Borrar curso</Boton>
          </>} />
      )}
    </section>
  );
}

function FilaCurso({ c, onEditar, onLink, onArchivar, onRestaurar, onBorrar }: {
  c: Curso; onEditar: () => void; onLink: (link: string) => void; onArchivar: () => void; onRestaurar: () => void; onBorrar: () => void;
}) {
  const [editLink, setEditLink] = useState(false);
  const [link, setLink] = useState('');
  const [tocado, setTocado] = useState(false);
  const stats = c.ventas_mes > 0
    ? `Este mes: ${plural(c.ventas_mes, 'venta')} · ${fmtDinero(c.vendido_mes, c.moneda)}`
    : c.ventas_total > 0 ? `${plural(c.ventas_total, 'venta')} en total · ninguna este mes` : 'Todavía sin ventas';
  return (
    <div role="listitem" className="px-3.5 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className={`truncate text-[14px] font-medium ${c.activo ? '' : 'text-[var(--text-secondary)]'}`}>{c.nombre}</div>
          <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">{stats}</div>
        </div>
        <span className="cifras shrink-0 pt-0.5 text-[14px] font-semibold">{Number(c.precio_lista) > 0 ? fmtDinero(c.precio_lista, c.moneda) : <span className="text-[12px] font-normal text-[var(--text-muted)]">Sin precio</span>}</span>
        <MenuPuntos etiqueta={`Más opciones de ${c.nombre}`}>
          <ItemMenu onClick={onEditar}>Editar</ItemMenu>
          {c.activo ? <ItemMenu onClick={onArchivar} descripcion="Sale de «Registrar venta»; el historial queda">Archivar</ItemMenu>
            : <ItemMenu onClick={onRestaurar}>Restaurar</ItemMenu>}
          {c.ventas_todas === 0 && <><SeparadorMenu /><ItemMenu peligro onClick={onBorrar}>Borrar</ItemMenu></>}
        </MenuPuntos>
      </div>
      {c.activo && (c.link_pago ? (
        <div className="mt-1.5 flex min-w-0 items-center gap-2">
          <a href={c.link_pago} target="_blank" rel="noreferrer" className="ui-foco min-w-0 truncate rounded text-[12px] font-medium text-[var(--series-1)] hover:underline">{dominioCorto(c.link_pago)}</a>
          <Copiar texto={c.link_pago} etiqueta="Copiar link" />
        </div>
      ) : editLink ? (
        <form noValidate className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); setTocado(true); if (linkValido(link)) { onLink(link.trim()); setEditLink(false); } }}>
          <Campo className="flex-1" error={tocado && !linkValido(link) ? 'Tiene que empezar con https://' : undefined}>
            <Entrada value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://pay.hotmart.com/…" type="url" inputMode="url" autoFocus aria-label="Link de pago" />
          </Campo>
          <div className="flex gap-2">
            <Boton tamano="md" variante="primario" type="submit">Guardar</Boton>
            <Boton tamano="md" variante="fantasma" onClick={() => { setEditLink(false); setLink(''); setTocado(false); }}>Cancelar</Boton>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setEditLink(true)} className="ui-foco -mb-1.5 mt-0.5 inline-flex min-h-[36px] items-center rounded text-[12px] font-medium text-[var(--series-1)] hover:underline md:min-h-0 md:py-1">+ Agregar link de pago</button>
      ))}
    </div>
  );
}

function DialogoCurso({ curso, onCerrar, onListo }: { curso: Curso | null; onCerrar: () => void; onListo: (texto: string) => void }) {
  const aviso = useAviso();
  const [nombre, setNombre] = useState(curso?.nombre ?? '');
  const [precio, setPrecio] = useState(curso ? montoEnCampo(curso.precio_lista) : '');
  const [link, setLink] = useState(curso?.link_pago ?? '');
  const [tocado, setTocado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const errLink = link.trim() && !linkValido(link) ? 'Tiene que empezar con https://' : undefined;
  const valido = nombre.trim().length > 0 && !errLink;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setTocado(true);
    if (!valido) return;
    setOcupado(true);
    const datos = { nombre: nombre.trim(), precio_lista: parseMonto(precio) > 0 ? parseMonto(precio) : null, link_pago: link.trim() || null };
    try {
      if (curso) await api(`/productos/${curso.id}`, { method: 'PATCH', json: datos });
      else await api('/productos', { method: 'POST', json: datos });
      onListo(curso ? 'Curso actualizado' : `Curso «${datos.nombre}» creado`);
    } catch (err: any) { aviso.error(err.message); } finally { setOcupado(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={curso ? 'Editar curso' : 'Nuevo curso'} ancho={460}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" type="submit" form="form-curso" cargando={ocupado} disabled={tocado && !valido}>{curso ? 'Guardar' : 'Crear curso'}</Boton>
      </>}>
      <form noValidate id="form-curso" onSubmit={guardar} className="space-y-3.5">
        <Campo etiqueta="Nombre" htmlFor="curso-nombre" error={tocado && !nombre.trim() ? 'Poné el nombre del curso' : undefined}>
          <Entrada id="curso-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Mentoría 1:1" maxLength={120} />
        </Campo>
        <Campo etiqueta="Precio" htmlFor="curso-precio" ayuda="Al registrar una venta de este curso, el monto se completa solo (y se puede cambiar).">
          <EntradaDinero id="curso-precio" valor={precio} onCambiar={setPrecio} moneda={curso?.moneda} />
        </Campo>
        <Campo etiqueta="Link de pago (opcional)" htmlFor="curso-link" error={tocado ? errLink : undefined}
          ayuda="Stripe, Hotmart, Mercado Pago… Aparece como atajo en el Chat para mandarlo con un toque.">
          <Entrada id="curso-link" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" type="url" inputMode="url" />
        </Campo>
      </form>
    </Dialogo>
  );
}
