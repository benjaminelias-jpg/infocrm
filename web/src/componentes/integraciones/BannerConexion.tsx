import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Boton } from '../../ui';
import { useConexiones, type ClaveApp } from './useConexiones';

// Aviso fijo "donde importa": Instagram desconectado en el Chat o el Panel,
// la conexión que vence, los pagos sin conectar en Finanzas. Se muestra SOLO
// si hace falta (nunca por un error de red) y lleva a la guía de esa app.
// Uso: <BannerConexion app="instagram" />  ·  <BannerConexion app="pagos" cerrable />

const CLAVE_CERRADO = (app: string) => `infocrm_banner_conexion_${app}`;
const DIAS_CERRADO = 7;

function cerradoHace(app: string) {
  try {
    const v = Number(localStorage.getItem(CLAVE_CERRADO(app)) ?? 0);
    return v && Date.now() - v < DIAS_CERRADO * 86_400_000;
  } catch { return false; }
}

export default function BannerConexion({ app = 'instagram', cerrable, className = '' }: {
  app?: Exclude<ClaveApp, 'claude' | 'zapier'>;
  /** Se puede cerrar (vuelve a aparecer a los 7 días). Para avisos que no son urgentes. */
  cerrable?: boolean;
  className?: string;
}) {
  const { estados } = useConexiones();
  const navegar = useNavigate();
  const [cerrado, setCerrado] = useState(() => Boolean(cerrable && cerradoHace(app)));
  const e = estados[app];
  if (cerrado || !e || e.estado === 'conectado' || e.estado === 'desconocido' || e.estado === 'esperando') return null;

  const ir = () => navegar(`/conexiones?abrir=${app}`);
  const cerrar = cerrable ? () => {
    try { localStorage.setItem(CLAVE_CERRADO(app), String(Date.now())); } catch { /* sin almacenamiento */ }
    setCerrado(true);
  } : undefined;
  const boton = (texto: string) => <Boton tamano="sm" variante="primario" onClick={ir}>{texto}</Boton>;

  if (app === 'instagram') {
    if (e.estado === 'desconectado') {
      return <div className={className}><Banner tono="aviso" accion={boton('Conectar')} onCerrar={cerrar}><b>Instagram no está conectado:</b> los DMs no llegan ni salen.</Banner></div>;
    }
    const dias = e.dias ?? null;
    const enDias = dias !== null ? (dias <= 0 ? 'hoy' : dias === 1 ? 'mañana' : `en ${dias} días`) : 'pronto';
    if (e.motivo === 'cortado') {
      return <div className={className}><Banner tono="error" accion={boton('Reconectar')} onCerrar={cerrar}><b>Se cortó la conexión con Instagram:</b> los DMs no llegan ni salen.</Banner></div>;
    }
    if (e.motivo === 'renovacion') {
      return <div className={className}><Banner tono="aviso" accion={boton('Renovar')} onCerrar={cerrar}><b>No pudimos renovar tu conexión con Instagram.</b> Vence {enDias}: renovala con un toque.</Banner></div>;
    }
    if (e.motivo === 'vence') {
      return <div className={className}><Banner tono="aviso" accion={boton('Renovar')} onCerrar={cerrar}>Tu conexión con Instagram vence {enDias}.</Banner></div>;
    }
    return <div className={className}><Banner tono="error" accion={boton('Ver qué pasó')} onCerrar={cerrar}><b>Instagram no se pudo conectar.</b> Los DMs no llegan.</Banner></div>;
  }

  const textos: Record<string, { falta: React.ReactNode; error: React.ReactNode }> = {
    pagos: { falta: <>Conectá tus pagos y <b>cada venta se registra sola</b>, con su importe y de qué contenido vino.</>, error: <>Llegan pagos con errores: revisá la conexión de pagos.</> },
    agenda: { falta: <>Conectá tu agenda y <b>cada llamada agendada mueve al lead sola</b> en el pipeline.</>, error: <>Llegan reuniones con errores: revisá la conexión de tu agenda.</> },
    manychat: { falta: <>Conectá ManyChat y <b>cada lead de tus palabras clave entra solo</b>.</>, error: <>Llegan leads de ManyChat con errores: revisá la conexión.</> },
  };
  const t = textos[app];
  if (e.estado === 'desconectado') {
    return <div className={className}><Banner tono="info" accion={boton('Conectar')} onCerrar={cerrar}>{t.falta}</Banner></div>;
  }
  return <div className={className}><Banner tono="aviso" accion={boton('Revisar')} onCerrar={cerrar}>{t.error}</Banner></div>;
}
