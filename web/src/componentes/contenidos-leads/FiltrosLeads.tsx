import { useEffect, useMemo, useState } from 'react';
import { api, plural } from '../../api';
import { Avatar, Boton, Chip, Dialogo, FilaChips, Seleccion } from '../../ui';
import type { Contexto } from './contexto';
import { ORDEN_TEMPERATURAS, TEMPERATURAS } from './temperatura';

// Filtros de la lista de Leads. Los más usados son chips a la vista (Todos,
// Míos, Sin asignar, Sin leer, Sin atribuir y las etiquetas); el resto vive
// en esta hoja, que dice cuántos leads vas a ver antes de aplicar.

export type Vista = 'todos' | 'mios' | 'sin_asignar' | 'sin_leer' | 'sin_atribuir';
export type Orden = 'reciente' | 'interes' | 'valor' | 'nuevos' | 'antiguos';

export interface Filtros {
  q: string; vista: Vista; etiqueta: string; etapa: string; pipeline: string; resp: string;
  temp: string; calif: string; dias: string; contenido: string; orden: Orden;
}

export const SIN_FILTROS: Filtros = {
  q: '', vista: 'todos', etiqueta: '', etapa: '', pipeline: '', resp: '', temp: '', calif: '', dias: '', contenido: '', orden: 'reciente',
};

/** Los que viven en la hoja (los cuenta el botón "Filtros"). */
export const AVANZADOS: Array<keyof Filtros> = ['etapa', 'resp', 'temp', 'calif', 'dias'];

export const VISTAS: Array<{ id: Vista; etiqueta: string }> = [
  { id: 'todos', etiqueta: 'Todos' },
  { id: 'mios', etiqueta: 'Míos' },
  { id: 'sin_asignar', etiqueta: 'Sin asignar' },
  { id: 'sin_leer', etiqueta: 'Sin leer' },
  { id: 'sin_atribuir', etiqueta: 'Sin reel de origen' },
];

export const ORDENES: Array<{ id: Orden; etiqueta: string; descripcion: string }> = [
  { id: 'reciente', etiqueta: 'Actividad reciente', descripcion: 'Los que se movieron hace poco, arriba' },
  { id: 'interes', etiqueta: 'Más calientes', descripcion: 'Los que más interés mostraron' },
  { id: 'valor', etiqueta: 'Más facturaron', descripcion: 'Los que más te compraron' },
  { id: 'nuevos', etiqueta: 'Entraron hace poco', descripcion: 'Los leads más nuevos' },
  { id: 'antiguos', etiqueta: 'Más antiguos', descripcion: 'Los que entraron primero' },
];

export const CALIFICACIONES: Array<{ id: string; etiqueta: string }> = [
  { id: 'calificado', etiqueta: 'Calificados' },
  { id: 'sin_calificar', etiqueta: 'Sin calificar' },
  { id: 'no_calificado', etiqueta: 'Descartados' },
];

export const DIAS: Array<{ id: string; etiqueta: string }> = [
  { id: '1', etiqueta: 'Hoy' }, { id: '7', etiqueta: 'Últimos 7 días' }, { id: '30', etiqueta: 'Últimos 30 días' }, { id: '90', etiqueta: 'Últimos 90 días' },
];

/** Filtros de la pantalla → parámetros de /ux/leads/lista. */
export function paramsApi(f: Filtros) {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.vista !== 'todos') p.set('vista', f.vista);
  if (f.etiqueta) p.set('etiqueta', f.etiqueta);
  if (f.etapa) p.set('etapa_id', f.etapa);
  if (f.resp) p.set('responsable_id', f.resp);
  if (f.temp) p.set('temperatura', f.temp);
  if (f.calif) p.set('calificacion', f.calif);
  if (f.dias) p.set('dias', f.dias);
  if (f.contenido) p.set('contenido_id', f.contenido);
  if (f.orden !== 'reciente') p.set('orden', f.orden);
  return p;
}

export default function FiltrosLeads({ filtros, ctx, onAplicar, onCerrar }: {
  filtros: Filtros; ctx: Contexto | null; onAplicar: (cambios: Partial<Filtros>) => void; onCerrar: () => void;
}) {
  const [b, setB] = useState<Filtros>(filtros);
  const [total, setTotal] = useState<number | null>(null);
  const pipelines = ctx?.pipelines ?? [];
  const pipeDeEtapa = pipelines.find((p) => p.etapas.some((e) => e.id === b.etapa));
  const [pipeId, setPipeId] = useState<string>(() => pipeDeEtapa?.id ?? pipelines.find((p) => p.es_predeterminado)?.id ?? pipelines[0]?.id ?? '');
  const pipe = pipelines.find((p) => p.id === pipeId) ?? pipelines.find((p) => p.es_predeterminado) ?? pipelines[0];
  const cambiar = (c: Partial<Filtros>) => setB((x) => ({ ...x, ...c }));

  // Cuántos vas a ver con lo elegido (antes de aplicar).
  const consulta = useMemo(() => { const p = paramsApi(b); p.set('limite', '1'); return p.toString(); }, [b]);
  useEffect(() => {
    let vivo = true;
    const t = window.setTimeout(() => {
      api<{ total: number }>(`/ux/leads/lista?${consulta}`).then((r) => { if (vivo) setTotal(r.total); }).catch(() => {});
    }, 200);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [consulta]);

  const limpiar = () => setB((x) => ({ ...x, etapa: '', resp: '', temp: '', calif: '', dias: '' }));

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo="Filtrar leads" ancho={520} autoFoco={false}
      pie={<>
        <Boton variante="fantasma" onClick={limpiar}>Limpiar</Boton>
        <Boton variante="primario" onClick={() => onAplicar({ etapa: b.etapa, resp: b.resp, temp: b.temp, calif: b.calif, dias: b.dias })}>
          {total === null ? 'Ver leads' : total === 0 ? 'Ninguno coincide' : `Ver ${plural(total, 'lead')}`}
        </Boton>
      </>}>
      <div className="space-y-4 pb-1">
        <Grupo titulo="Temperatura">
          <FilaChips>
            {ORDEN_TEMPERATURAS.map((t) => (
              <Chip key={t} activo={b.temp === t} onClick={() => cambiar({ temp: b.temp === t ? '' : t })}>{TEMPERATURAS[t].etiqueta}</Chip>
            ))}
          </FilaChips>
        </Grupo>

        <Grupo titulo="Etapa">
          {pipelines.length > 1 && (
            <Seleccion value={pipe?.id ?? ''} onChange={(e) => setPipeId(e.target.value)} aria-label="Pipeline" className="mb-2">
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </Seleccion>
          )}
          <FilaChips>
            {(pipe?.etapas ?? []).map((e) => (
              <Chip key={e.id} activo={b.etapa === e.id} onClick={() => cambiar({ etapa: b.etapa === e.id ? '' : e.id })}
                icono={<span className="h-2 w-2 rounded-full" style={{ background: e.color }} aria-hidden />}>{e.nombre}</Chip>
            ))}
            {!ctx && <span className="text-[12px] text-[var(--text-muted)]">Cargando etapas…</span>}
          </FilaChips>
        </Grupo>

        {(ctx?.usuarios ?? []).length > 0 && (
          <Grupo titulo="Lo atiende">
            <FilaChips>
              {(ctx?.usuarios ?? []).map((u) => (
                <Chip key={u.id} activo={b.resp === u.id} onClick={() => cambiar({ resp: b.resp === u.id ? '' : u.id })}
                  icono={<Avatar id={u.id} nombre={u.nombre} tam={16} />}>{u.nombre}</Chip>
              ))}
            </FilaChips>
          </Grupo>
        )}

        <Grupo titulo="Entró">
          <FilaChips>
            {DIAS.map((d) => <Chip key={d.id} activo={b.dias === d.id} onClick={() => cambiar({ dias: b.dias === d.id ? '' : d.id })}>{d.etiqueta}</Chip>)}
          </FilaChips>
        </Grupo>

        <Grupo titulo="Calificación">
          <FilaChips>
            {CALIFICACIONES.map((c) => <Chip key={c.id} activo={b.calif === c.id} onClick={() => cambiar({ calif: b.calif === c.id ? '' : c.id })}>{c.etiqueta}</Chip>)}
          </FilaChips>
        </Grupo>
      </div>
    </Dialogo>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[12px] font-semibold text-[var(--text-secondary)]">{titulo}</h3>
      {children}
    </section>
  );
}
