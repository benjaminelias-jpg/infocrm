import { useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { Boton, Verificacion } from '../../ui';

// "Probar ahora": se queda escuchando hasta 2 minutos, te dice qué hacer y
// confirma con el dato real apenas llega. Nunca queda "esperando" sin fin:
// si se acaba el tiempo, explica las causas probables y deja reintentar.

const LIMITE_S = 120;

export type TipoPrueba = 'dm' | 'webhook' | 'clave';

export default function PruebaEnVivo({ tipo, endpointId, claveId, instruccion, causas, textoOk, onOk }: {
  tipo: TipoPrueba;
  endpointId?: string;
  claveId?: string;
  instruccion: React.ReactNode;
  causas: React.ReactNode[];
  /** Mensaje de éxito a medida (recibe lo que llegó). */
  textoOk?: (detalle: any) => React.ReactNode;
  onOk?: (detalle: any) => void;
}) {
  const [estado, setEstado] = useState<'inactivo' | 'esperando' | 'ok' | 'error' | 'vencido'>('inactivo');
  const [restan, setRestan] = useState(LIMITE_S);
  const [detalle, setDetalle] = useState<any>(null);
  const timer = useRef<number | null>(null);
  const reloj = useRef<number | null>(null);
  const onOkRef = useRef(onOk);
  onOkRef.current = onOk;

  function parar() {
    if (timer.current) window.clearInterval(timer.current);
    if (reloj.current) window.clearInterval(reloj.current);
    timer.current = null; reloj.current = null;
  }
  useEffect(() => parar, []);

  function empezar() {
    parar();
    const desde = new Date(Date.now() - 2000).toISOString();
    setEstado('esperando'); setRestan(LIMITE_S); setDetalle(null);
    const fin = Date.now() + LIMITE_S * 1000;
    reloj.current = window.setInterval(() => {
      const s = Math.max(0, Math.round((fin - Date.now()) / 1000));
      setRestan(s);
      if (s === 0) { parar(); setEstado((e) => (e === 'esperando' ? 'vencido' : e)); }
    }, 1000);
    const extra = `${endpointId ? `&endpoint_id=${endpointId}` : ''}${claveId ? `&clave_id=${claveId}` : ''}`;
    timer.current = window.setInterval(async () => {
      try {
        const r = await api<any>(`/ux/integraciones/actividad?desde=${encodeURIComponent(desde)}${extra}`);
        const llego = tipo === 'dm' ? r.dm : tipo === 'clave' ? r.clave : r.webhook;
        if (!llego) return;
        parar();
        setDetalle(llego);
        if (tipo === 'webhook' && llego.estado === 'error') { setEstado('error'); return; }
        setEstado('ok');
        onOkRef.current?.(llego);
      } catch { /* reintenta en el próximo ciclo */ }
    }, 3000);
  }

  const mmss = `${Math.floor(restan / 60)}:${String(restan % 60).padStart(2, '0')}`;
  const quien = detalle?.de ? `@${detalle.de}` : detalle?.nombre ?? 'alguien';
  const ok = textoOk
    ? textoOk(detalle)
    : tipo === 'dm'
      ? <>¡Llegó! DM de <b>{quien}</b>{detalle?.texto ? <>: «{String(detalle.texto).slice(0, 60)}»</> : null}</>
      : tipo === 'clave'
        ? <>¡Funciona! Claude ya está usando tu CRM.</>
        : <>¡Llegó! {detalle?.de || detalle?.nombre ? <>Lead <b>{quien}</b></> : 'Ya entró el primer dato.'}</>;

  return (
    <div className="space-y-2">
      <div className="text-[13px] text-[var(--text-secondary)]">{instruccion}</div>
      {estado === 'inactivo' && <Boton variante="primario" icono="▷" onClick={empezar}>Probar ahora</Boton>}
      {estado !== 'inactivo' && (
        <Verificacion
          estado={estado === 'esperando' ? 'esperando' : estado === 'ok' ? 'ok' : 'error'}
          esperando={<>Esperando que llegue… <span className="cifras">{mmss}</span></>}
          ok={ok}
          error={estado === 'vencido'
            ? 'No llegó nada en 2 minutos.'
            : <>Llegó, pero con un problema: {detalle?.error ?? 'revisá los datos que manda la otra app'}</>}
          accion={estado === 'esperando'
            ? <Boton tamano="xs" variante="fantasma" onClick={() => { parar(); setEstado('inactivo'); }}>Cancelar</Boton>
            : estado !== 'ok' ? <Boton tamano="xs" onClick={empezar}>Volver a probar</Boton> : undefined} />
      )}
      {estado === 'vencido' && causas.length > 0 && (
        <div className="rounded-lg p-3 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
          <div className="mb-1 font-medium">Lo más probable:</div>
          <ul className="list-disc space-y-1 pl-4 text-[var(--text-secondary)]">{causas.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
