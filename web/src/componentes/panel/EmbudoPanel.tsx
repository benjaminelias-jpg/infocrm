import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, plural } from '../../api';
import { Ayuda, Girando, SelectorConMas, Vacio, useAviso } from '../../ui';
import { Embudo, type PasoEmbudo } from '../Graficas';
import { IconoPanel } from './iconos';
import type { PipelineResumen } from './tipos';

// Embudo de UN pipeline (antes mezclaba los 7: «Interesado» ×6, «43.400 %»).
// Por defecto, el predeterminado; con varios pipelines, un selector en el
// encabezado (sin "+": un pipeline recién creado no tiene nada que graficar).
// La elección se recuerda en este navegador.

const CLAVE = 'infocrm_panel_pipeline';
export function leerPipelineGuardado(): string | null {
  try { return localStorage.getItem(CLAVE); } catch { return null; }
}
function guardarPipeline(id: string) {
  try { localStorage.setItem(CLAVE, id); } catch { /* sin almacenamiento */ }
}

export function EmbudoPanel({ pipelines, inicial, inicialId, paramsRango, texto, cargandoPanel }: {
  pipelines: PipelineResumen[];
  /** El embudo que ya vino con el Panel (de `inicialId`). */
  inicial: PasoEmbudo[];
  inicialId: string | null;
  /** desde/hasta del período (para pedir el embudo de otro pipeline). */
  paramsRango: string;
  texto: string;
  cargandoPanel?: boolean;
}) {
  const aviso = useAviso();
  const navegar = useNavigate();
  const [elegido, setElegido] = useState<string | null>(() => leerPipelineGuardado());
  const efectivo = elegido && pipelines.some((p) => p.id === elegido) ? elegido : inicialId;
  const [propio, setPropio] = useState<{ id: string; params: string; pasos: PasoEmbudo[] } | null>(null);
  const [cargando, setCargando] = useState(false);

  // Otro pipeline (o el mismo con otro período): se pide solo el embudo.
  // Mientras el Panel entero se recarga no hace falta: ya viene con el
  // pipeline elegido.
  useEffect(() => {
    if (cargandoPanel || !efectivo || efectivo === inicialId) return;
    if (propio && propio.id === efectivo && propio.params === paramsRango) return;
    let vivo = true;
    setCargando(true);
    api<PasoEmbudo[]>(`/analitica/embudo?${paramsRango}&pipeline_id=${encodeURIComponent(efectivo)}`)
      .then((pasos) => { if (vivo) setPropio({ id: efectivo, params: paramsRango, pasos }); })
      .catch((e) => {
        if (!vivo) return;
        aviso.error(`No pudimos traer ese embudo. ${e?.message ?? ''}`.trim());
        setElegido(inicialId);
        if (inicialId) guardarPipeline(inicialId);
      })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; setCargando(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [efectivo, inicialId, paramsRango, cargandoPanel]);

  const pasos = efectivo === inicialId || !propio ? inicial : propio.pasos;
  const mostrando = efectivo === inicialId || !propio ? inicialId : propio.id;
  const hayDatos = pasos.some((p) => p.alcanzaron > 0);
  const pipeActual = pipelines.find((p) => p.id === efectivo);

  function elegir(id: string) {
    setElegido(id);
    guardarPipeline(id);
  }

  return (
    <section className={`tarjeta min-w-0 p-4 transition-opacity ${cargando || cargandoPanel ? 'opacity-60' : ''}`} aria-labelledby="titulo-embudo">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 id="titulo-embudo" className="text-[15px] font-semibold">Embudo</h2>
          <Ayuda titulo="Embudo">
            De los leads que entraron {texto}, cuántos llegaron a cada paso (o más lejos). No es cuántos están ahí
            ahora. «Pasa el 44 %» es cuántos siguieron del paso anterior a este. Tocá un paso para verlo en el pipeline.
          </Ayuda>
          {cargando && <span className="text-[var(--text-muted)]"><Girando tam={13} /></span>}
        </div>
        {pipelines.length > 1 && (
          <SelectorConMas<PipelineResumen> items={pipelines} actualId={efectivo} onElegir={elegir} queEs="pipeline"
            extra={(p) => `${plural(p.abiertos, 'lead abierto', 'leads abiertos')}${p.es_predeterminado ? ' · ★ el principal' : ''}`}
            onGestionar={() => navegar(`/pipeline?p=${encodeURIComponent(efectivo ?? '')}&config=1`)} textoGestionar="Configurar etapas" />
        )}
      </div>
      {pipelines.length <= 1 && pipeActual && <p className="mb-2 text-[12px] text-[var(--text-secondary)]">{pipeActual.nombre}</p>}
      {hayDatos ? (
        <Embudo pasos={pasos} onPaso={(p) => navegar(`/pipeline?p=${encodeURIComponent(mostrando ?? '')}&etapa=${encodeURIComponent(p.id)}`)} />
      ) : (
        <Vacio compacto icono={<IconoPanel nombre="reloj" tam={20} />}
          titulo={texto === 'desde el principio' ? 'Todavía no entró nadie a este pipeline' : `No entró nadie a este pipeline ${texto}`}
          texto="Cuando entren leads, los vas a ver avanzar paso a paso." />
      )}
    </section>
  );
}
