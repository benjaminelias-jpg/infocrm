import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { Boton, Campo, Chip, Dialogo, Entrada, FilaChips, Seleccion, useAviso } from '../../ui';
import type { Contexto } from './contexto';

// Cargar un lead a mano desde Leads (el mismo "lead rápido" del Pipeline):
// @usuario o nombre, en qué etapa entra y una etiqueta opcional. Si ese
// @usuario ya está, lo avisa antes (para no moverlo sin querer).

const PARECE_USUARIO = /^@?[a-z0-9._]{2,30}$/i;

export default function NuevoLead({ ctx, inicial = '', onCerrar, onCreado, onVerFicha }: {
  ctx: Contexto | null; inicial?: string; onCerrar: () => void;
  onCreado: (r: { lead_id: string; ya_existia: boolean }, quien: string) => void;
  onVerFicha: (id: string) => void;
}) {
  const aviso = useAviso();
  const [texto, setTexto] = useState(inicial);
  const [etapaId, setEtapaId] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [existe, setExiste] = useState<null | { id: string; etapa?: string; pipeline?: string }>(null);
  const [guardando, setGuardando] = useState(false);

  const pipelines = ctx?.pipelines ?? [];
  const abiertas = useMemo(() => pipelines.map((p) => ({ ...p, etapas: p.etapas.filter((e) => e.tipo === 'abierta') })), [pipelines]);
  // Por defecto: la primera etapa abierta del pipeline principal.
  useEffect(() => {
    if (etapaId || !abiertas.length) return;
    const p = abiertas.find((x) => x.es_predeterminado) ?? abiertas[0];
    if (p?.etapas[0]) setEtapaId(p.etapas[0].id);
  }, [abiertas, etapaId]);

  const limpio = texto.trim();
  const esUsuario = PARECE_USUARIO.test(limpio) && !/\s/.test(limpio);
  const usuario = esUsuario ? limpio.replace(/^@/, '') : '';
  const etapa = pipelines.flatMap((p) => p.etapas).find((e) => e.id === etapaId);

  // ¿Ya existe ese @usuario?
  useEffect(() => {
    setExiste(null);
    if (!usuario) return;
    let vivo = true;
    const t = window.setTimeout(() => {
      api<any>(`/ux/pipeline/existe?usuario=${encodeURIComponent(usuario)}`)
        .then((r) => { if (vivo && r.existe) setExiste({ id: r.id, etapa: r.etapa, pipeline: r.pipeline }); })
        .catch(() => {});
    }, 300);
    return () => { vivo = false; window.clearTimeout(t); };
  }, [usuario]);

  async function crear(e?: React.FormEvent) {
    e?.preventDefault();
    if (!limpio || !etapaId) return;
    setGuardando(true);
    try {
      const r = await api<{ lead_id: string; ya_existia: boolean }>('/ux/pipeline/lead-rapido', {
        method: 'POST',
        json: { etapa_id: etapaId, ...(esUsuario ? { usuario } : { nombre: limpio }), ...(etiqueta.trim() ? { etiqueta: etiqueta.trim() } : {}) },
      });
      onCreado(r, esUsuario ? `@${usuario}` : limpio);
    } catch (err: any) {
      aviso.error(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo="Nuevo lead" ancho={460}
      descripcion="Para alguien que te escribió por otro lado o que conociste en persona."
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={() => crear()} cargando={guardando} disabled={!limpio || !etapaId}>
          {existe ? `Moverlo a «${etapa?.nombre ?? 'esa etapa'}»` : 'Cargar lead'}
        </Boton>
      </>}>
      <form onSubmit={crear} className="space-y-3">
        <Campo etiqueta="@usuario de Instagram o nombre"
          ayuda={!limpio ? 'Ej. @juan.perez o Juan Pérez' : esUsuario ? `Lo guardamos como usuario de Instagram: @${usuario}` : 'Lo guardamos como nombre (sin Instagram)'}>
          <Entrada value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="@usuario o nombre" maxLength={120}
            autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Campo>
        {existe && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-[12px]"
            style={{ background: 'color-mix(in srgb, var(--status-warning) 14%, var(--surface-1))' }}>
            <span>@{usuario} ya está en tus leads{existe.etapa ? `, en «${existe.etapa}»` : ''}{existe.pipeline ? ` (${existe.pipeline})` : ''}.</span>
            <Boton tamano="sm" variante="fantasma" onClick={() => onVerFicha(existe.id)}>Ver su ficha</Boton>
          </div>
        )}
        <Campo etiqueta="Entra en la etapa">
          <Seleccion value={etapaId} onChange={(e) => setEtapaId(e.target.value)}>
            {abiertas.length === 0 && <option value="">Cargando etapas…</option>}
            {abiertas.map((p) => (
              <optgroup key={p.id} label={p.nombre}>
                {p.etapas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </optgroup>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Etiqueta (opcional)">
          <Entrada value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Ej. evento-octubre" maxLength={60} />
        </Campo>
        {(ctx?.etiquetas ?? []).length > 0 && (
          <FilaChips>
            {(ctx?.etiquetas ?? []).slice(0, 8).map((t) => (
              <Chip key={t.etiqueta} activo={etiqueta === t.etiqueta} onClick={() => setEtiqueta(etiqueta === t.etiqueta ? '' : t.etiqueta)}>{t.etiqueta}</Chip>
            ))}
          </FilaChips>
        )}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialogo>
  );
}
