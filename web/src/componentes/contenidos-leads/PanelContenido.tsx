import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, fmtDinero, fmtFecha, fmtNum, fmtPct, plural } from '../../api';
import { Ayuda, Boton, BotonIcono, Chip, ErrorCarga, Esqueleto, FilaChips, IdentidadLead, Insignia, Vacio } from '../../ui';
import Icono from '../Iconos';
import { useFicha } from '../useFicha';
import PanelLateral from './PanelLateral';
import Portada from './Portada';
import MenuAngulo from './MenuAngulo';
import { Temperatura } from './temperatura';
import { guardarListaFicha } from './listaFicha';
import { ANGULO, MIN_LEADS_ROL, ROL_CONTENIDO, TIPO_CONTENIDO } from './textos';

// Ficha de un contenido: de un vistazo, cuánto trajo (leads → reuniones →
// ventas → plata), qué hacer con él, cómo le fue en Instagram, con qué
// palabras te comentan y quiénes son sus leads (cada uno abre su ficha).

export default function PanelContenido({ fila, diasRol, onCerrar, onAngulo }: {
  fila: any; diasRol: number; onCerrar: () => void; onAngulo: (angulo: string | null) => void;
}) {
  const navegar = useNavigate();
  const ficha = useFicha();
  const [detalle, setDetalle] = useState<any>(null);
  const [leads, setLeads] = useState<any[] | null>(null);
  const [totalLeads, setTotalLeads] = useState<number | null>(null);
  const [error, setError] = useState<any>(null);

  async function cargar() {
    setError(null);
    try {
      const [d, l] = await Promise.all([
        api<any>(`/contenidos/${fila.id}`),
        api<any>(`/ux/leads/lista?contenido_id=${fila.id}&limite=8`),
      ]);
      setDetalle(d);
      setLeads(l.leads);
      setTotalLeads(l.total);
      guardarListaFicha(l.leads.map((x: any) => x.id), fila.titulo);
    } catch (e: any) { setError(e); }
  }
  useEffect(() => { cargar(); }, [fila.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const rol = Number(fila.rol_leads) >= MIN_LEADS_ROL ? ROL_CONTENIDO[fila.rol] : null;
  const palabras: string[] = Array.from(new Set<string>((detalle?.automatizaciones ?? []).map((a: any) => a.palabra_clave).filter(Boolean)));
  const embudo = fila.angulo ? ANGULO[fila.angulo]?.embudo : null;
  const ig: Array<[string, number | null | undefined]> = [
    ['Vistas', fila.ig_reproducciones], ['Alcance', fila.ig_alcance], ['Me gusta', fila.ig_likes],
    ['Comentarios', fila.ig_comentarios], ['Guardados', fila.ig_guardados], ['Compartidos', fila.ig_compartidos],
  ];
  const conIg = ig.filter(([, v]) => Number(v) > 0);

  const cabecera = (
    <div className="flex items-start gap-3 px-4 pb-3 pt-1.5 md:px-5 md:pt-4">
      <Portada url={fila.thumbnail_url} tipo={fila.tipo} embudo={embudo} tam="md" />
      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-2 text-[16px] font-semibold leading-snug tracking-tight">{fila.titulo}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-[var(--text-muted)]">
          <span>{TIPO_CONTENIDO[fila.tipo] ?? 'Contenido'}</span>
          {fila.publicado_en && <span>· {fmtFecha(fila.publicado_en)}</span>}
          {fila.permalink && (
            <a href={fila.permalink} target="_blank" rel="noreferrer" className="ui-foco rounded font-medium text-[var(--series-1)] hover:underline">
              · Ver en Instagram ↗
            </a>
          )}
        </div>
        <div className="mt-1.5"><MenuAngulo angulo={fila.angulo} onElegir={onAngulo} /></div>
      </div>
      <BotonIcono etiqueta="Cerrar" onClick={onCerrar} className="-mr-2 shrink-0"><Icono nombre="cerrar" tam={18} /></BotonIcono>
    </div>
  );

  return (
    <PanelLateral etiqueta={`Contenido: ${fila.titulo}`} onCerrar={onCerrar} cabecera={cabecera} z={45} ancho={480}>
      <div className="space-y-5 px-4 py-4 md:px-5">
        {/* Embudo de este contenido */}
        <section>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Lo que trajo en el período</h3>
          <div className="grid grid-cols-4 gap-1.5">
            <Paso valor={fmtNum(fila.leads)} etiqueta={Number(fila.leads) === 1 ? 'lead' : 'leads'} />
            <Paso valor={fmtNum(fila.reuniones_agendadas)} etiqueta={Number(fila.reuniones_agendadas) === 1 ? 'reunión' : 'reuniones'} />
            <Paso valor={fmtNum(fila.ventas)} etiqueta={Number(fila.ventas) === 1 ? 'venta' : 'ventas'} />
            <Paso valor={fmtDinero(fila.ingresos)} etiqueta="facturado" fuerte />
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-secondary)]">
            Compra el <b className="cifras">{fmtPct(fila.tasa_lead_venta)}</b> de sus leads · cada lead vale <b className="cifras">{fmtDinero(fila.valor_por_lead)}</b>
          </p>
        </section>

        {/* Qué hacer */}
        <section className="rounded-xl p-3" style={{ background: 'var(--page-plane)' }}>
          <h3 className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Qué hacer con este contenido
            <Ayuda titulo="¿Cómo se decide?">Se juzga con los últimos {diasRol} días (así no cambia por mirar una semana floja): cuántos leads trae comparado con tus otros contenidos y cuántos terminan comprando.</Ayuda>
          </h3>
          {rol ? (
            <div className="space-y-1.5">
              <div><Insignia tono={rol.tono}>{rol.etiqueta}</Insignia></div>
              <p className="text-[13px] leading-relaxed">{rol.ayuda}</p>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--text-secondary)]">
              Todavía es pronto para opinar: trajo {plural(fila.rol_leads ?? 0, 'lead')} en {diasRol} días (hacen falta {MIN_LEADS_ROL}).
            </p>
          )}
        </section>

        {Number(fila.leads_dudosos) > 0 && (
          <section className="rounded-xl p-3" style={{ background: 'color-mix(in srgb, var(--status-warning) 12%, var(--surface-1))' }}>
            <p className="text-[13px] font-medium">{fmtNum(fila.leads_dudosos)} de {plural(fila.leads, 'lead')} con origen dudoso</p>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]">
              Comentaron una palabra que usás en varios contenidos, así que no sabemos con seguridad cuál los trajo. Usá una palabra distinta en cada reel.
            </p>
            <Boton tamano="sm" className="mt-2" onClick={() => navegar('/flujos?tab=manychat')}>Ver tus palabras clave</Boton>
          </section>
        )}

        {conIg.length > 0 && (
          <section>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">En Instagram</h3>
            <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
              {conIg.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] text-[var(--text-muted)]">{k}</dt>
                  <dd className="cifras text-[14px] font-semibold">{fmtNum(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {palabras.length > 0 && (
          <section>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Te comentan</h3>
            <FilaChips>{palabras.map((p) => <Chip key={p}>«{p}»</Chip>)}</FilaChips>
          </section>
        )}

        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Sus leads</h3>
            {totalLeads !== null && totalLeads > 0 && (
              <button type="button" onClick={() => navegar(`/leads?contenido=${fila.id}`)}
                className="ui-foco -mr-1.5 h-8 rounded-md px-2 text-[12px] font-medium text-[var(--series-1)] hover:bg-[var(--page-plane)]">
                Ver {totalLeads === 1 ? 'el lead' : `los ${fmtNum(totalLeads)}`} →
              </button>
            )}
          </div>
          {error ? <ErrorCarga compacto error={error} onReintentar={cargar} titulo="No pudimos traer sus leads" />
            : leads === null ? <div className="space-y-2">{[0, 1, 2].map((i) => <Esqueleto key={i} alto={44} className="rounded-lg" />)}</div>
              : leads.length === 0 ? <Vacio compacto icono={<Icono nombre="leads" tam={18} />} titulo="Todavía no trajo leads" />
                : (
                  <ul className="-mx-2">
                    {leads.map((l) => (
                      <li key={l.id}>
                        <IdentidadLead id={l.id} nombre={[l.nombre, l.apellido].filter(Boolean).join(' ')} usuario={l.ig_username} foto={l.avatar_url}
                          onClick={() => ficha.abrir(l.id)} className="w-full px-2 py-1.5 hover:bg-[var(--page-plane)]"
                          derecha={<Temperatura score={l.score} corta numero={false} />} />
                      </li>
                    ))}
                  </ul>
                )}
        </section>
      </div>
    </PanelLateral>
  );
}

function Paso({ valor, etiqueta, fuerte }: { valor: string; etiqueta: string; fuerte?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg px-2 py-2 text-center" style={{ background: fuerte ? 'color-mix(in srgb, var(--status-good) 12%, var(--surface-1))' : 'var(--page-plane)' }}>
      <div className="cifras truncate text-[15px] font-semibold" style={fuerte ? { color: 'var(--status-good)' } : undefined}>{valor}</div>
      <div className="truncate text-[11px] text-[var(--text-muted)]">{etiqueta}</div>
    </div>
  );
}
