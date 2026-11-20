import { useEffect, useMemo, useState } from 'react';
import { fmtNum, hace } from '../../api';
import { Boton, Chip, FilaChips, PasosGuiados, Verificacion, EsqueletoPantalla } from '../../ui';
import PruebaEnVivo from './PruebaEnVivo';
import { B, Bloque, Direccion, Instrucciones, UltimosLlegados, useFuente, usePaso } from './comun';

// Guía para las integraciones que MANDAN datos al CRM por una dirección
// (webhook): ManyChat, la agenda (Calendly, Cal.com…) y los pagos (Stripe,
// Hotmart…). Siempre 3 pasos: copiar la dirección → pegarla en la otra app →
// probar en vivo.

export type ClaseEntrada = 'manychat' | 'agenda' | 'pagos' | 'zapier';

interface Proveedor {
  id: string;
  nombre: string;
  /** Tipo de dirección que pide al servidor (/ux/integraciones/fuente). */
  tipo: string;
  app: string;
  pasos: (url: string) => React.ReactNode[];
  extra?: React.ReactNode;
  prueba: React.ReactNode;
  causas: React.ReactNode[];
}

const JSON_MANYCHAT = JSON.stringify({
  id: '{{user_id}}',
  first_name: '{{first_name}}',
  ig_username: '{{ig_username}}',
  email: '{{email}}',
  custom_fields: { palabra_clave: 'TU_PALABRA', ig_media_id: '{{last_commented_media_id}}' },
}, null, 2);

const JSON_PAGO = JSON.stringify({
  event: 'venta',
  email: 'email del comprador',
  ig_username: 'su @ de Instagram (si lo tenés)',
  amount: 497,
  currency: 'EUR',
  product: 'Nombre del programa',
}, null, 2);

const JSON_LEAD = JSON.stringify({
  ig_username: 'usuario de Instagram',
  first_name: 'nombre',
  email: 'email',
  palabra_clave: 'palabra o campaña de donde vino',
}, null, 2);

const MAL_PEGADA = 'La dirección quedó mal pegada (tiene que ser exactamente la del paso 1).';

const PROVEEDORES: Record<ClaseEntrada, Proveedor[]> = {
  manychat: [{
    id: 'manychat', nombre: 'ManyChat', tipo: 'manychat', app: 'ManyChat',
    pasos: () => [
      <>Abrí el flujo de tu palabra clave y tocá <B>+ Acción → Solicitud externa</B> (External Request).</>,
      <>Método <B>POST</B> y en URL pegá tu dirección.</>,
      <>En <B>Body</B> elegí JSON y pegá esto (los {'{{…}}'} se insertan con <B>+ Variable</B>):</>,
      <>Guardá y <B>publicá</B> el flujo.</>,
    ],
    extra: <Bloque texto={JSON_MANYCHAT} />,
    prueba: <>Comentá la palabra clave en tu reel desde otra cuenta, o tocá <B>Test Request</B> dentro de la Solicitud externa.</>,
    causas: [
      MAL_PEGADA,
      'La Solicitud externa no está en el flujo que se disparó, o el flujo no está publicado.',
      'Tu ManyChat no es Pro: la Solicitud externa solo está en el plan pago.',
    ],
  }],
  agenda: [
    {
      id: 'calendly', nombre: 'Calendly', tipo: 'agenda', app: 'Zapier o Make (con Calendly)',
      pasos: () => [
        <>Creá un Zap con el disparador <B>Calendly → Invitee Created</B>.</>,
        <>Acción: <B>Webhooks by Zapier → POST</B> (en Make: módulo <B>HTTP → Make a request</B>).</>,
        <>URL: pegá tu dirección. Tipo de datos: <B>JSON</B>.</>,
        <>Mandá <B>email</B> y <B>name</B> del invitado (y <B>ig_username</B> si preguntás el Instagram en el formulario).</>,
        <>Publicá el Zap.</>,
      ],
      extra: <p className="text-[12px] text-[var(--text-muted)]">Si tu plan de Calendly tiene webhooks propios, también podés pegar la dirección ahí para el evento «invitee.created».</p>,
      prueba: <>Agendate una reunión de prueba con otro email.</>,
      causas: [MAL_PEGADA, 'El Zap o escenario no está publicado/activo.', 'El disparador no es «reunión creada» (Invitee Created).'],
    },
    {
      id: 'calcom', nombre: 'Cal.com', tipo: 'agenda', app: 'Cal.com',
      pasos: () => [
        <>Entrá a <B>Configuración → Desarrollador → Webhooks</B> y tocá <B>Nuevo</B>.</>,
        <>Pegá tu dirección en <B>URL del suscriptor</B>.</>,
        <>En eventos dejá <B>Reserva creada</B> (y si querés, <B>Reserva cancelada</B>).</>,
        <>Guardá.</>,
      ],
      prueba: <>Agendate una reunión de prueba con otro email.</>,
      causas: [MAL_PEGADA, 'El webhook quedó desactivado en Cal.com.', 'No marcaste «Reserva creada».'],
    },
    {
      id: 'otra', nombre: 'Otra agenda', tipo: 'agenda', app: 'tu app de agenda',
      pasos: () => [
        <>Buscá <B>Webhooks</B> o <B>Notificaciones</B> y pegá tu dirección para «reunión agendada».</>,
        <>¿No tiene? Conectala con <B>Zapier</B> o <B>Make</B>: «nueva reunión» → POST a tu dirección con <B>email</B>, <B>name</B> e <B>ig_username</B>.</>,
      ],
      prueba: <>Agendate una reunión de prueba con otro email.</>,
      causas: [MAL_PEGADA, 'El aviso de la otra app no está activo.'],
    },
  ],
  pagos: [
    {
      id: 'stripe', nombre: 'Stripe', tipo: 'stripe', app: 'Stripe',
      pasos: () => [
        <>Entrá a <B>Desarrolladores → Webhooks</B> y tocá <B>Agregar destino</B>.</>,
        <>Elegí los eventos <B>checkout.session.completed</B> (ventas) y <B>charge.refunded</B> (devoluciones).</>,
        <>Pegá tu dirección como <B>URL del endpoint</B> y guardá.</>,
      ],
      extra: <p className="text-[12px] text-[var(--text-muted)]">No agregues otros eventos de pago (como payment_intent.succeeded): contarían la misma venta dos veces. Los importes de Stripe vienen en céntimos: el CRM ya los convierte.</p>,
      prueba: <>Hacé una compra en modo de prueba de Stripe, o reenviá un evento desde su registro de eventos.</>,
      causas: [MAL_PEGADA, 'Elegiste otros eventos y no checkout.session.completed.', 'El webhook está en modo de prueba y la compra la hiciste en modo real (o al revés).'],
    },
    {
      id: 'hotmart', nombre: 'Hotmart', tipo: 'hotmart', app: 'Hotmart',
      pasos: () => [
        <>Entrá a <B>Herramientas → Webhook</B> y tocá <B>Registrar webhook</B>.</>,
        <>Elegí tu producto y la versión <B>2.0</B>.</>,
        <>Pegá tu dirección y marcá <B>Compra aprobada</B>, <B>Compra reembolsada</B> y <B>Contracargo</B>.</>,
        <>Guardá.</>,
      ],
      prueba: <>Usá el botón de prueba del webhook en Hotmart o hacé una compra de prueba.</>,
      causas: [MAL_PEGADA, 'El webhook está registrado para otro producto.', 'Elegiste la versión 1.0 en vez de la 2.0.'],
    },
    {
      id: 'otra', nombre: 'Otra (Kunfupay, PayPal…)', tipo: 'pagos', app: 'tu plataforma de pagos',
      pasos: () => [
        <>Buscá <B>Webhooks</B> o <B>Notificaciones</B> y pegá tu dirección para el aviso de <B>pago aprobado</B>.</>,
        <>Si podés elegir qué datos mandar, mandá algo así (para devoluciones, <B>"event": "reembolso"</B>):</>,
      ],
      extra: <Bloque texto={JSON_PAGO} />,
      prueba: <>Hacé un pago de prueba.</>,
      causas: [MAL_PEGADA, 'Tu plataforma no tiene avisos por webhook: conectala con Zapier o Make.', 'El aviso no trae el email ni el @ del comprador.'],
    },
  ],
  zapier: [{
    id: 'zapier', nombre: 'Zapier / Make', tipo: 'zapier', app: 'Zapier o Make',
    pasos: () => [
      <>Al final de tu Zap (o escenario) agregá <B>Webhooks by Zapier → POST</B> (en Make: <B>HTTP → Make a request</B>).</>,
      <>URL: pegá tu dirección. Tipo de datos: <B>JSON</B>.</>,
      <>Mandá estos datos (con los nombres tal cual):</>,
    ],
    extra: <Bloque texto={JSON_LEAD} />,
    prueba: <>Ejecutá el Zap o escenario una vez (en Zapier: <B>Test step</B>).</>,
    causas: [MAL_PEGADA, 'El Zap o escenario no está publicado.', 'No mandaste ningún dato que identifique a la persona (@, email o nombre).'],
  }],
};

export default function GuiaEntrada({ clase, preferido, onCambio }: {
  clase: ClaseEntrada;
  /** Proveedor que ya está en uso (para preseleccionarlo). */
  preferido?: string;
  onCambio?: () => void;
}) {
  const lista = PROVEEDORES[clase];
  const [provId, setProvId] = useState(() => lista.find((p) => p.id === preferido)?.id ?? lista[0].id);
  const prov = useMemo(() => lista.find((p) => p.id === provId) ?? lista[0], [lista, provId]);
  const { fuente, error } = useFuente(prov.tipo);
  const [refrescar, setRefrescar] = useState(0);
  const recibidos = Number(fuente?.total_recibidos ?? 0);
  const yaFunciona = recibidos > 0;
  const { estado, siguiente, ir } = usePaso(3, 0);

  // Si ya viene funcionando, abrimos directo en "Probar".
  useEffect(() => { if (yaFunciona) ir(2); }, [yaFunciona, provId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      {lista.length > 1 && (
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">¿Cuál usás?</div>
          <FilaChips>
            {lista.map((p) => <Chip key={p.id} activo={p.id === provId} onClick={() => { setProvId(p.id); ir(0); }}>{p.nombre}</Chip>)}
          </FilaChips>
        </div>
      )}

      {error && <Verificacion estado="error" error={error} />}
      {!fuente && !error && <EsqueletoPantalla tarjetas={0} filas={3} />}

      {fuente && (
        <>
          {yaFunciona && (
            <Verificacion estado="ok" ok={<>Funcionando: {recibidos === 1 ? 'ya llegó' : 'ya llegaron'} <b className="cifras">{fmtNum(recibidos)}</b>{fuente.ultimo_evento_en ? <> · el último {hace(fuente.ultimo_evento_en)}</> : null}</>} />
          )}
          <PasosGuiados pasos={[
            {
              titulo: 'Copiá tu dirección',
              estado: estado(0),
              resumen: <button type="button" className="underline" onClick={() => ir(0)}>Ver la dirección</button>,
              contenido: (
                <div className="space-y-3">
                  <Direccion url={fuente.url} secreta />
                  <Boton variante="primario" onClick={siguiente}>Listo, ya la copié</Boton>
                </div>
              ),
            },
            {
              titulo: `Pegala en ${prov.app}`,
              estado: estado(1),
              resumen: <button type="button" className="underline" onClick={() => ir(1)}>Ver los pasos</button>,
              contenido: (
                <div className="space-y-3">
                  <Instrucciones pasos={prov.pasos(fuente.url)} />
                  {prov.extra}
                  <div className="flex flex-wrap gap-2">
                    <Boton variante="primario" onClick={siguiente}>Listo, siguiente</Boton>
                    <Boton variante="fantasma" onClick={() => ir(0)}>Volver</Boton>
                  </div>
                </div>
              ),
            },
            {
              titulo: 'Probá que llega',
              estado: estado(2),
              contenido: (
                <div className="space-y-3">
                  <PruebaEnVivo tipo="webhook" endpointId={fuente.id} instruccion={prov.prueba} causas={prov.causas}
                    onOk={() => { setRefrescar((n) => n + 1); onCambio?.(); }} />
                  <UltimosLlegados endpointId={fuente.id} refrescar={refrescar} />
                </div>
              ),
            },
          ]} />
        </>
      )}
    </div>
  );
}
