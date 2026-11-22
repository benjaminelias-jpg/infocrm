import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Boton, Verificacion, useEsMovil } from '../../ui';
import { DetalleTecnico } from './comun';

// "Probar ahora": se queda escuchando mientras la guía esté abierta (hasta
// 15 minutos) y confirma con el dato real apenas llega. Sin falsos "No llegó":
//  · TODOS los reintentos usan el mismo "desde" (el del primer Probar), así
//    lo que llegó mientras tanto también cuenta;
//  · a los 2 minutos pasa a ámbar ("sigo escuchando") y muestra las causas
//    probables, pero NO corta;
//  · al volver a la pestaña (ir a Instagram y volver) consulta en el acto;
//  · si el celular recarga la página, retoma la escucha sola.

const SUAVE_S = 120;
const DURO_S = 15 * 60;
/** Un "desde" guardado sirve para reintentar durante una hora. */
const VIGENCIA_DESDE_MS = 60 * 60_000;

export type TipoPrueba = 'dm' | 'webhook' | 'clave';
type Fase = 'inactivo' | 'escuchando' | 'ok' | 'error' | 'vencido';
/** desde: el del primer "Probar". escuchando: si al recargar hay que retomar sola. */
interface Guardado { desde: string; inicio: number; escuchando?: boolean }

function leer(clave: string): Guardado | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(clave) ?? 'null');
    return v && typeof v.desde === 'string' && typeof v.inicio === 'number' ? v : null;
  } catch { return null; }
}
function guardar(clave: string, v: Guardado | null) {
  try { if (v) sessionStorage.setItem(clave, JSON.stringify(v)); else sessionStorage.removeItem(clave); } catch { /* sin almacenamiento */ }
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function PruebaEnVivo({
  tipo, endpointId, claveId, instruccion, causas, textoOk, onOk, clave, onVerLead, onListo, explicarError, onVerPaso, pistaMovil,
}: {
  tipo: TipoPrueba;
  endpointId?: string;
  claveId?: string;
  instruccion: React.ReactNode;
  causas: React.ReactNode[];
  /** Mensaje de éxito a medida (recibe lo que llegó). */
  textoOk?: (detalle: any) => React.ReactNode;
  onOk?: (detalle: any) => void;
  /** Dónde se guarda el "desde" de esta prueba (por defecto: tipo + dirección). */
  clave?: string;
  /** En el éxito: [Ver el lead]. */
  onVerLead?: (leadId: string) => void;
  /** En el éxito: [Listo] (cierra la guía). */
  onListo?: () => void;
  /** Traduce el error según la app (código del servidor + detalle técnico). */
  explicarError?: (codigo: string | null, detalle: string | null) => React.ReactNode;
  /** En el error: [Ver el paso] (vuelve al paso de configuración). */
  onVerPaso?: () => void;
  /** Texto bajo el botón en el celular (false para no mostrarlo). */
  pistaMovil?: React.ReactNode | false;
}) {
  const movil = useEsMovil();
  const claveStore = `infocrm_prueba_${clave ?? `${tipo}_${endpointId ?? claveId ?? 'general'}`}`;
  const [fase, setFase] = useState<Fase>('inactivo');
  const [inicio, setInicio] = useState<number | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const [detalle, setDetalle] = useState<any>(null);
  const desde = useRef<string | null>(null);
  const consultando = useRef(false);
  const ultimaConsulta = useRef(0);
  const vivo = useRef(true);
  const onOkRef = useRef(onOk);
  onOkRef.current = onOk;

  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  /** Deja de escuchar sin perder el "desde" (el próximo intento lo reutiliza). */
  const pausarGuardado = useCallback(() => {
    const g = leer(claveStore);
    if (g) guardar(claveStore, { ...g, escuchando: false });
  }, [claveStore]);

  const consultar = useCallback(async () => {
    if (!desde.current || consultando.current) return;
    consultando.current = true;
    ultimaConsulta.current = Date.now();
    try {
      const extra = `${endpointId ? `&endpoint_id=${endpointId}` : ''}${claveId ? `&clave_id=${claveId}` : ''}`;
      const r = await api<any>(`/ux/integraciones/actividad?desde=${encodeURIComponent(desde.current)}${extra}`);
      const llego = tipo === 'dm' ? r.dm : tipo === 'clave' ? r.clave : r.webhook;
      if (!llego || !vivo.current) return;
      setDetalle(llego);
      if (tipo === 'webhook' && llego.estado === 'error') {
        const g = leer(claveStore);
        if (g) guardar(claveStore, { ...g, escuchando: false });
        setFase('error');
        return;
      }
      setFase('ok');
      guardar(claveStore, null); // la próxima prueba arranca de cero
      onOkRef.current?.(llego);
    } catch { /* sin red: reintenta en el próximo ciclo */ } finally { consultando.current = false; }
  }, [claveId, claveStore, endpointId, tipo]);

  /**
   * Empieza (o retoma) a escuchar con el MISMO "desde" de la primera prueba.
   * `despuesDe`: después de un error, se escucha lo que llegue DESPUÉS de ese
   * intento fallido (si no, se volvería a mostrar el mismo error).
   */
  const empezar = useCallback((retomar?: Guardado, despuesDe?: string) => {
    const g = retomar ?? leer(claveStore);
    const valido = g && Date.now() - g.inicio < VIGENCIA_DESDE_MS;
    let base: Guardado = valido ? g! : { desde: new Date(Date.now() - 5000).toISOString(), inicio: Date.now() };
    if (despuesDe) {
      const t = new Date(despuesDe).getTime() + 1;
      if (Number.isFinite(t) && t > new Date(base.desde).getTime()) base = { ...base, desde: new Date(t).toISOString() };
    }
    guardar(claveStore, { ...base, escuchando: true });
    desde.current = base.desde;
    setInicio(retomar ? retomar.inicio : Date.now());
    setAhora(Date.now());
    setDetalle(null);
    setFase('escuchando');
    void consultar();
  }, [claveStore, consultar]);

  // Si la página se recargó en medio de una prueba (iOS al volver de otra app), se retoma sola.
  useEffect(() => {
    const g = leer(claveStore);
    if (g?.escuchando && Date.now() - g.inicio < DURO_S * 1000) empezar(g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveStore]);

  // Reloj: avanza cada segundo, consulta cada 3 s (6 s después de los 2 min) y corta a los 15 min.
  useEffect(() => {
    if (fase !== 'escuchando' || inicio === null) return;
    const t = window.setInterval(() => {
      const n = Date.now();
      setAhora(n);
      const s = (n - inicio) / 1000;
      if (s >= DURO_S) { setFase('vencido'); pausarGuardado(); return; }
      if (n - ultimaConsulta.current >= (s < SUAVE_S ? 3000 : 6000)) void consultar();
    }, 1000);
    return () => window.clearInterval(t);
  }, [fase, inicio, consultar]);

  // Al volver a la pestaña (o a la ventana): consultar en el acto.
  useEffect(() => {
    if (fase !== 'escuchando' && fase !== 'vencido') return;
    const volver = () => {
      if (document.visibilityState !== 'visible') return;
      setAhora(Date.now());
      void consultar();
    };
    document.addEventListener('visibilitychange', volver);
    window.addEventListener('focus', volver);
    return () => { document.removeEventListener('visibilitychange', volver); window.removeEventListener('focus', volver); };
  }, [fase, consultar]);

  const seg = inicio ? Math.max(0, Math.floor((ahora - inicio) / 1000)) : 0;
  const demorado = fase === 'escuchando' && seg >= SUAVE_S;
  const quien = detalle?.de ? `@${detalle.de}` : detalle?.nombre ?? null;
  const ok = textoOk
    ? textoOk(detalle)
    : tipo === 'dm'
      ? <><b>¡Llegó!</b> DM de <b>{quien ?? 'alguien'}</b>{detalle?.texto ? <>: «{String(detalle.texto).slice(0, 60)}»</> : null}</>
      : tipo === 'clave'
        ? <><b>¡Funciona!</b> Claude ya está usando tu CRM.</>
        : <><b>¡Llegó!</b> {quien ? <>Lead <b>{quien}</b></> : 'Ya entró el primer dato.'}</>;
  const errorTexto = explicarError?.(detalle?.codigo ?? null, detalle?.error ?? null)
    ?? <>Llegó, pero hubo un problema al guardarlo. Revisá los datos que manda la otra app.</>;
  const listaCausas = causas.length > 0 && (
    <div className="rounded-lg p-3 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
      <div className="mb-1 font-semibold">Lo más probable:</div>
      <ul className="list-disc space-y-1 pl-4 text-[var(--text-secondary)]">{causas.map((c, i) => <li key={i}>{c}</li>)}</ul>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="text-[13px] text-[var(--text-secondary)]">{instruccion}</div>

      {fase === 'inactivo' && (
        <div className="space-y-1.5">
          <Boton variante="primario" onClick={() => empezar()} anchoCompleto={movil}>Probar ahora</Boton>
          {movil && pistaMovil !== false && (
            <p className="text-[12px] text-[var(--text-muted)]">{pistaMovil ?? 'Podés ir a la otra app y volver: te avisamos acá apenas llegue.'}</p>
          )}
        </div>
      )}

      {fase === 'escuchando' && (
        <Verificacion estado={demorado ? 'esperando' : 'escuchando'}
          esperando={demorado
            ? <>Todavía no llegó… <b>sigo escuchando</b> hasta 15 minutos. <span className="cifras text-[var(--text-muted)]">{mmss(seg)}</span></>
            : <>Escuchando… hacé la prueba ahora. <span className="cifras text-[var(--text-muted)]">{mmss(seg)}</span></>}
          accion={<Boton tamano="xs" variante="fantasma" onClick={() => { pausarGuardado(); setFase('inactivo'); }}>{demorado ? 'Dejar de escuchar' : 'Cancelar'}</Boton>} />
      )}
      {demorado && listaCausas}

      {fase === 'ok' && (
        <Verificacion estado="ok" ok={ok}
          detalle={(onVerLead && detalle?.lead_id) || onListo ? (
            <div className="flex flex-wrap gap-2">
              {onVerLead && detalle?.lead_id && <Boton tamano="sm" variante="primario" onClick={() => onVerLead(detalle.lead_id)}>Ver el lead</Boton>}
              {onListo && <Boton tamano="sm" onClick={onListo}>Listo</Boton>}
              <Boton tamano="sm" variante="fantasma" onClick={() => { guardar(claveStore, null); empezar(); }}>Probar otra vez</Boton>
            </div>
          ) : undefined}
          accion={!onVerLead && !onListo ? <Boton tamano="xs" variante="fantasma" onClick={() => { guardar(claveStore, null); empezar(); }}>Probar otra vez</Boton> : undefined} />
      )}

      {fase === 'error' && (
        <Verificacion estado="error" error={errorTexto}
          detalle={(
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {onVerPaso && <Boton tamano="sm" variante="primario" onClick={onVerPaso}>Ver el paso</Boton>}
                <Boton tamano="sm" onClick={() => empezar(undefined, detalle?.en)}>Volver a probar</Boton>
              </div>
              {detalle?.error && <DetalleTecnico>{detalle.error}</DetalleTecnico>}
            </div>
          )} />
      )}

      {fase === 'vencido' && (
        <>
          <Verificacion estado="aviso" error={<>No llegó nada en 15 minutos.</>}
            accion={<Boton tamano="xs" onClick={() => empezar()}>Volver a probar</Boton>} />
          {listaCausas}
        </>
      )}
    </div>
  );
}
