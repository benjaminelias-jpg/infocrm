import { useEffect, useRef, useState } from 'react';
import { api, fmtFecha, fmtNum, hace, plural } from '../../api';
import {
  Boton, Campo, Entrada, PasosGuiados, Verificacion, Desplegable, useAviso, useEsMovil, type EstadoPaso,
} from '../../ui';
import PruebaEnVivo from './PruebaEnVivo';
import { B, DetalleTecnico, Direccion, Instrucciones } from './comun';
import { LogoApp } from './LogoApp';

// Instagram, paso a paso.
//  · Con la app de la PLATAFORMA (lo normal): 3 pasos, igual en escritorio y
//    celular → tu cuenta es profesional · [Conectar con Instagram] · probá con un DM.
//  · Con app propia (sin app del CRM, o "avanzado"): además los datos de la
//    app de Meta y activar los avisos de Meta (se tilda solo cuando llega el
//    primer aviso).
// Las confirmaciones ("Ya es profesional", "Ya activé el permiso") se guardan
// en la cuenta: valen en cualquier celular, compu o para cualquier persona.

const PERMISO = [
  <>En la app de Instagram: tu perfil → <B>☰</B> → <B>Configuración y actividad</B>.</>,
  <><B>Mensajes y respuestas a historias</B> → <B>Herramientas conectadas</B>.</>,
  <>Activá <B>Permitir acceso a los mensajes</B>.</>,
];

const causasDm = (propia: boolean) => [
  <>No está activado <B>Permitir acceso a los mensajes</B> en la app de Instagram (Configuración → Mensajes → Herramientas conectadas).</>,
  'El DM salió de la misma cuenta conectada: tiene que ser desde otra cuenta.',
  ...(propia ? [
    'Tu app de Meta está en modo desarrollo: solo llegan DMs de cuentas con un rol en la app (agregalas como evaluadoras).',
    'Faltan los avisos de Meta: completá el paso «Activá los avisos de Meta».',
  ] : []),
];

export interface PropsGuiaInstagram {
  ig: any;
  ultimoSync?: string | null;
  onCambio: () => void;
  /** En el éxito de la prueba: abrir la ficha del lead. */
  onVerLead?: (leadId: string) => void;
  /** En el éxito de la prueba: cerrar la guía. */
  onListo?: () => void;
  /** "Paso 2 de 3" para el encabezado de la hoja. */
  onProgreso?: (texto: string | null) => void;
}

export default function GuiaInstagram({ ig, ultimoSync, onCambio, onVerLead, onListo, onProgreso }: PropsGuiaInstagram) {
  const aviso = useAviso();
  const movil = useEsMovil();
  const [proLocal, setProLocal] = useState(false);
  const [permisoLocal, setPermisoLocal] = useState(false);
  const [verComo, setVerComo] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [tokenAbierto, setTokenAbierto] = useState(false);
  const tokenRef = useRef<HTMLDivElement>(null);

  const plataforma = Boolean(ig?.app_de_plataforma);
  const conectado = Boolean(ig?.conectado);
  const tieneApp = Boolean(ig?.tiene_app);
  const propia = !plataforma; // con app propia hay que hacer los pasos de Meta
  const error: string | null = !conectado && ig?.ultimo_error ? ig.ultimo_error : null;
  // Si ya cargó la app, se conectó o lo intentó (error), la cuenta ya es profesional.
  const pro = proLocal || Boolean(ig?.pasos?.profesional) || tieneApp || conectado || Boolean(ig?.ultimo_error);
  const dms = Number(ig?.dms_7d ?? 0);
  // Si ya llegaron DMs, el permiso ya está dado.
  const permiso = permisoLocal || Boolean(ig?.pasos?.permiso_mensajes) || dms > 0;
  const avisosMeta = Boolean(ig?.ultimo_aviso_meta_en) || dms > 0;
  const dias = ig?.token_expira_en ? Math.ceil((new Date(ig.token_expira_en).getTime() - Date.now()) / 86_400_000) : null;
  const renovacionFallo = ig?.renovacion && !ig.renovacion.ok;
  const debeRenovar = conectado && dias !== null && (dias < 0 || (renovacionFallo && dias <= 15) || (!ig?.se_renueva_sola && dias <= 10));

  async function conectar() {
    setAbriendo(true);
    try {
      const r = await api<{ url: string }>('/instagram/oauth/start');
      window.location.href = r.url; // Meta nos devuelve a /instagram/callback → /conexiones?instagram=ok
    } catch (e: any) { aviso.error(e.message); setAbriendo(false); }
  }

  async function confirmar(paso: 'profesional' | 'permiso_mensajes') {
    if (paso === 'profesional') setProLocal(true); else setPermisoLocal(true);
    try {
      await api('/instagram/pasos', { method: 'PATCH', json: { [paso]: true } });
      onCambio();
    } catch (e: any) { aviso.error(e.message); }
  }

  async function sincronizar() {
    setSincronizando(true);
    try {
      const r = await api<any>('/instagram/sincronizar', { method: 'POST' });
      if (r.ok === false) aviso.error(`No se pudo traer el contenido: ${r.error ?? r.mensaje ?? 'Meta no respondió'}`);
      else aviso.exito(`Listo: ${plural(Number(r.creados ?? 0) + Number(r.actualizados ?? 0), 'publicación', 'publicaciones')} con sus métricas.`);
      onCambio();
    } catch (e: any) { aviso.error(e.message); } finally { setSincronizando(false); }
  }

  function abrirToken() {
    setTokenAbierto(true);
    window.setTimeout(() => tokenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }

  const botonConectar = (texto: string) => (
    <button type="button" onClick={conectar} disabled={abriendo || (!plataforma && !tieneApp)}
      className={`ui-foco inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-[14px] font-semibold text-white disabled:opacity-60 ${movil ? 'w-full' : ''}`}
      style={{ background: 'linear-gradient(90deg,#833ab4,#fd1d1d,#fcb045)' }}>
      <span className="flex h-5 w-5 items-center justify-center rounded bg-white"><LogoApp app="instagram" tam={15} /></span>
      {abriendo ? 'Abriendo Instagram…' : texto}
    </button>
  );

  const pasoPro = {
    titulo: 'Tu cuenta de Instagram es profesional',
    estado: (pro ? 'hecho' : 'actual') as EstadoPaso,
    resumen: 'Cuenta de Creador o Empresa',
    contenido: (
      <div className="space-y-3">
        <p className="text-[13px] text-[var(--text-secondary)]">Tiene que ser de <B>Creador</B> o <B>Empresa</B> (las personales no dejan conectar mensajes).</p>
        {verComo && (
          <Instrucciones app="la app de Instagram" pasos={[
            <>Tu perfil → <B>☰</B> → <B>Configuración y actividad</B> → <B>Tipo de cuenta y herramientas</B>.</>,
            <>Si dice <B>Cambiar a cuenta profesional</B>, tocalo y elegí <B>Creador</B> o <B>Empresa</B>. Si dice «Cambiar a cuenta personal», ya es profesional.</>,
          ]} />
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Boton variante="primario" onClick={() => confirmar('profesional')} anchoCompleto={movil}>Ya es profesional</Boton>
          {!verComo && (
            <button type="button" onClick={() => setVerComo(true)} aria-expanded={verComo}
              className="ui-foco rounded-md px-1 py-1 text-[13px] font-semibold underline" style={{ color: 'var(--accion, var(--series-1))' }}>
              ¿Cómo me fijo?
            </button>
          )}
        </div>
      </div>
    ),
  };

  const pasoApp = {
    titulo: 'Los datos de tu app de Meta',
    estado: (tieneApp ? 'hecho' : pro ? 'actual' : 'pendiente') as EstadoPaso,
    resumen: 'App guardada',
    contenido: <FormApp ig={ig} onGuardada={onCambio} />,
  };

  const pasoConectar = {
    titulo: 'Conectá con Instagram',
    estado: (conectado ? 'hecho' : pro && (plataforma || tieneApp) ? 'actual' : 'pendiente') as EstadoPaso,
    resumen: ig?.username ? `Conectado como @${ig.username}` : 'Conectado',
    contenido: (
      <div className="space-y-3">
        <p className="text-[13px] text-[var(--text-secondary)]">Te llevamos a Instagram para que aceptes y volvés solo acá.</p>
        {botonConectar('Conectar con Instagram')}
      </div>
    ),
  };

  const pasoAvisos = {
    titulo: 'Activá los avisos de Meta',
    estado: (avisosMeta ? 'hecho' : conectado ? 'actual' : 'pendiente') as EstadoPaso,
    resumen: ig?.ultimo_aviso_meta_en ? `Llegó el último aviso ${hace(ig.ultimo_aviso_meta_en)}` : 'Ya llegan los avisos',
    contenido: <AvisosMeta ig={ig} />,
  };

  const pasoProbar = {
    titulo: 'Probá con un DM',
    // Con app propia se puede probar mientras se configuran los avisos: el
    // primer DM que llega es justamente el que tilda "Activá los avisos".
    estado: (conectado ? 'actual' : 'pendiente') as EstadoPaso,
    contenido: conectado && (
      <div className="space-y-3">
        {!permiso && (
          <div className="rounded-lg p-3" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
            <div className="mb-1.5 text-[12px] font-semibold">Antes: dejá que lleguen los mensajes</div>
            <Instrucciones pasos={PERMISO} />
            <Boton tamano="sm" className="mt-2" onClick={() => confirmar('permiso_mensajes')}>Listo, ya lo activé</Boton>
          </div>
        )}
        <PruebaEnVivo tipo="dm" causas={causasDm(propia)} clave="instagram_dm"
          instruccion={<>Desde <B>otra cuenta</B>, mandale un DM a <B>@{ig?.username ?? 'tu cuenta'}</B>. Va a aparecer acá y en el Chat.</>}
          pistaMovil="Podés ir a Instagram, mandar el DM y volver: te avisamos acá."
          onVerLead={onVerLead} onListo={onListo}
          onOk={() => onCambio()} />
      </div>
    ),
  };

  // Pasos según el caso.
  const pasos = conectado
    ? (propia && !avisosMeta ? [pasoAvisos, pasoProbar] : [pasoProbar])
    : plataforma
      ? [pasoPro, pasoConectar, { ...pasoProbar, estado: 'pendiente' as EstadoPaso }]
      : [pasoPro, pasoApp, pasoConectar, { ...pasoAvisos, estado: 'pendiente' as EstadoPaso }, { ...pasoProbar, estado: 'pendiente' as EstadoPaso }];

  const actual = pasos.findIndex((p) => p.estado === 'actual');
  const progreso = !conectado && actual >= 0 ? `Paso ${actual + 1} de ${pasos.length}` : null;
  useEffect(() => { onProgreso?.(progreso); }, [progreso, onProgreso]);

  return (
    <div className="space-y-4">
      {conectado && (
        <div className="space-y-2 rounded-lg p-3" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: 'var(--status-good)' }} aria-hidden>✓</span>
            <span className="text-[14px] font-semibold">Conectado como @{ig.username ?? '—'}</span>
          </div>
          <div className="text-[12px] text-[var(--text-secondary)]">
            {ultimoSync ? `Contenido actualizado ${hace(ultimoSync)}` : 'Todavía no trajimos tus publicaciones'}
            {' · '}
            {ig.se_renueva_sola && !renovacionFallo
              ? <span>la conexión se renueva sola{dias !== null ? ` (vence el ${fmtFecha(ig.token_expira_en)})` : ''}</span>
              : dias !== null
                ? <span style={{ color: debeRenovar ? 'var(--status-critical)' : undefined }}>
                    {dias < 0 ? 'la conexión venció' : `la conexión vence el ${fmtFecha(ig.token_expira_en)}`}{debeRenovar && dias >= 0 ? ` (en ${dias} ${dias === 1 ? 'día' : 'días'})` : ''}
                  </span>
                : <span>la conexión no vence</span>}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {debeRenovar && <Boton tamano="sm" variante="primario" onClick={conectar} cargando={abriendo}>Renovar conexión</Boton>}
            <Boton tamano="sm" onClick={sincronizar} cargando={sincronizando}>Traer mis publicaciones y métricas</Boton>
          </div>
        </div>
      )}

      {conectado && renovacionFallo && (
        <Verificacion estado="aviso" error={<><b>No pudimos renovar la conexión sola.</b> Tocá «Renovar conexión» y aceptá en Instagram (es un toque).</>}
          detalle={ig.renovacion?.error ? <DetalleTecnico>{ig.renovacion.error}</DetalleTecnico> : undefined} />
      )}

      {conectado && dms > 0 && (
        <Verificacion estado="ok" ok={<>Funcionando: <b className="cifras">{fmtNum(dms)}</b> {dms === 1 ? 'DM' : 'DMs'} esta semana{ig.ultimo_dm_en ? <> · el último {hace(ig.ultimo_dm_en)}</> : null}.</>} />
      )}

      {error && <ErrorInstagram mensaje={error} onProbar={conectar} probando={abriendo} onToken={abrirToken} puedeConectar={plataforma || tieneApp} />}

      {!plataforma && !tieneApp && !conectado && (
        <p className="text-[12px] text-[var(--text-muted)]">Para conectar necesitás una app de Meta (es gratis). Si no sabés qué es, pedile ayuda a quien te armó la cuenta.</p>
      )}

      <PasosGuiados pasos={pasos} />

      <div ref={tokenRef}>
        <Desplegable titulo={<span className="text-[13px]">{conectado ? 'Reconectar o usar otra cuenta' : '¿No funciona el botón? Conectá pegando un token'}</span>}
          tarjeta={false} abierto={tokenAbierto} onCambiar={setTokenAbierto}>
          <div className="space-y-3">
            {conectado && (plataforma || tieneApp) && <Boton onClick={conectar} cargando={abriendo}>Reconectar Instagram</Boton>}
            <FormToken onConectado={onCambio} />
          </div>
        </Desplegable>
      </div>
    </div>
  );
}

/** Traduce los errores de Meta a algo entendible + qué hacer; el texto crudo queda plegado. */
export function traducirErrorInstagram(m: string): { titulo: string; hacer: string } {
  if (/no pude identificar tu Instagram/i.test(m)) {
    return {
      titulo: 'Meta aceptó, pero no encontramos tu cuenta de Instagram profesional.',
      hacer: 'Revisá que tu Instagram sea profesional y esté vinculado a tu página de Facebook. Si sigue igual, conectá pegando un token.',
    };
  }
  if (/rechazó el código/i.test(m)) return { titulo: 'Meta no aceptó la autorización (puede haber vencido).', hacer: 'Probá de nuevo y aceptá sin demorarte.' };
  if (/rechazó el token o el ID/i.test(m)) return { titulo: 'Meta no aceptó el token o el ID de Instagram.', hacer: 'Generá el token con los permisos de Instagram (mensajes y datos básicos) y usá el ID de tu cuenta de Instagram.' };
  if (/Faltan las credenciales|Falta la App|Faltan los datos/i.test(m)) return { titulo: 'Faltan los datos de tu app de Meta.', hacer: 'Completá el paso «Los datos de tu app de Meta».' };
  if (/expired|caduc|venci/i.test(m)) return { titulo: 'La conexión con Instagram venció.', hacer: 'Probá de nuevo para renovarla.' };
  return { titulo: 'No se pudo conectar con Instagram.', hacer: 'Probá de nuevo. Si se repite, conectá pegando un token.' };
}

/** El error, con la acción ADENTRO de la caja roja (no un botón bloqueado más abajo). */
function ErrorInstagram({ mensaje, onProbar, probando, onToken, puedeConectar }: {
  mensaje: string; onProbar: () => void; probando: boolean; onToken: () => void; puedeConectar: boolean;
}) {
  const t = traducirErrorInstagram(mensaje);
  return (
    <Verificacion estado="error" error={<><b>{t.titulo}</b> {t.hacer}</>}
      detalle={(
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {puedeConectar && <Boton tamano="sm" variante="primario" onClick={onProbar} cargando={probando}>Probar de nuevo</Boton>}
            <button type="button" onClick={onToken} className="ui-foco text-[12px] font-medium underline text-[var(--text-secondary)]">
              ¿Sigue fallando? Conectá pegando un token
            </button>
          </div>
          <DetalleTecnico>{mensaje}</DetalleTecnico>
        </div>
      )} />
  );
}

/** Con app propia: la URL y el token que se pegan en Meta → Webhooks (una sola vez). */
export function AvisosMeta({ ig }: { ig: any }) {
  return (
    <div className="space-y-3">
      <Instrucciones app="Meta for Developers → tu app → Webhooks → Instagram" pasos={[
        { texto: <>Pegá la <B>URL de devolución</B> y el <B>token de verificación</B> y tocá <B>Verificar y guardar</B>.</>,
          extra: (
            <div className="space-y-2">
              {ig?.webhook_url && <Direccion etiqueta="URL de devolución" url={ig.webhook_url} />}
              {ig?.webhook_verify_token && <Direccion etiqueta="Token de verificación" url={ig.webhook_verify_token} />}
            </div>
          ) },
        <>Suscribite a <B>comments</B>, <B>messages</B>, <B>messaging_postbacks</B>, <B>message_reactions</B>, <B>messaging_referral</B> y <B>mentions</B>.</>,
      ]} />
      <p className="text-[12px] text-[var(--text-muted)]">Este paso se tilda solo cuando llega el primer aviso de Meta. Mientras Meta no apruebe tu app, podés probar los automensajes con «Probar» en el Chat.</p>
    </div>
  );
}

/** Identificador + clave secreta (y opcionales) de una app de Meta propia. */
export function FormApp({ ig, onGuardada }: { ig: any; onGuardada: () => void }) {
  const aviso = useAviso();
  const [f, setF] = useState({ app_id: ig?.app_id ?? '', app_secret: '', config_id: ig?.config_id ?? '', ig_user_id: ig?.ig_user_id ?? '' });
  const [guardando, setGuardando] = useState(false);
  const idInvalido = f.app_id.length > 0 && !/^\d{6,}$/.test(f.app_id);
  const redirect = ig?.redirect_uri ?? `${window.location.origin}/instagram/callback`;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api('/instagram/app', {
        method: 'PUT',
        json: { app_id: f.app_id, app_secret: f.app_secret, config_id: f.config_id || undefined, ig_user_id: f.ig_user_id || undefined },
      });
      aviso.exito('App guardada. Ya podés conectar tu Instagram.');
      setF((x) => ({ ...x, app_secret: '' }));
      onGuardada();
    } catch (err: any) { aviso.error(err.message); } finally { setGuardando(false); }
  }

  return (
    <form onSubmit={guardar} className="space-y-3">
      <Instrucciones pasos={[
        <>Entrá a <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="underline">developers.facebook.com/apps</a> → tu app (con el producto Instagram).</>,
        <>En <B>Configuración → Básica</B> copiá el <B>identificador de la app</B> y la <B>clave secreta</B>.</>,
        { texto: <>En la configuración de inicio de sesión de Instagram, agregá esta <B>URL de redireccionamiento</B>:</>, extra: <Direccion url={redirect} /> },
      ]} />
      <Campo etiqueta="Identificador de la app" error={idInvalido ? 'Es un número que te da Meta (no tu email ni tu usuario).' : undefined}>
        <Entrada value={f.app_id} onChange={(e) => setF((x) => ({ ...x, app_id: e.target.value.trim() }))} inputMode="numeric" placeholder="Solo números" invalido={idInvalido} autoComplete="off" />
      </Campo>
      <Campo etiqueta="Clave secreta de la app">
        <Entrada value={f.app_secret} onChange={(e) => setF((x) => ({ ...x, app_secret: e.target.value.trim() }))} type="password" placeholder="Texto largo de letras y números" autoComplete="off" />
      </Campo>
      <Desplegable titulo={<span className="text-[12px]">Más opciones (solo si tu app usa el inicio de sesión unificado)</span>} tarjeta={false}>
        <div className="space-y-3">
          <Campo etiqueta="Identificador de configuración">
            <Entrada value={f.config_id} onChange={(e) => setF((x) => ({ ...x, config_id: e.target.value.trim() }))} inputMode="numeric" autoComplete="off" />
          </Campo>
          <Campo etiqueta="ID de tu Instagram" ayuda="Configuración del negocio → Cuentas de Instagram → Identificador">
            <Entrada value={f.ig_user_id} onChange={(e) => setF((x) => ({ ...x, ig_user_id: e.target.value.trim() }))} inputMode="numeric" autoComplete="off" />
          </Campo>
        </div>
      </Desplegable>
      <Boton type="submit" variante="primario" cargando={guardando} disabled={!f.app_id || !f.app_secret || idInvalido}>Guardar app</Boton>
    </form>
  );
}

/** Plan B: conectar pegando un token (cuando el botón de Instagram falla). */
function FormToken({ onConectado }: { onConectado: () => void }) {
  const aviso = useAviso();
  const [token, setToken] = useState('');
  const [igId, setIgId] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<any>('/instagram/conectar-token', { method: 'POST', json: { access_token: token.trim(), ig_user_id: igId.trim() } });
      aviso.exito(r.mensaje ?? 'Instagram conectado.');
      setToken('');
      onConectado();
    } catch (err: any) { aviso.error(err.message); } finally { setEnviando(false); }
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <p className="text-[12px] text-[var(--text-muted)]">
        En Meta: Configuración del negocio → Usuarios del sistema → asigná tu Instagram y generá un token con los permisos de Instagram (datos básicos y mensajes).
        Si el token dura poco, el CRM lo cambia solo por uno de unos 60 días.
      </p>
      <Campo etiqueta="ID de tu Instagram">
        <Entrada value={igId} onChange={(e) => setIgId(e.target.value)} inputMode="numeric" placeholder="p. ej. 17841400000000000" autoComplete="off" />
      </Campo>
      <Campo etiqueta="Token">
        <Entrada value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
      </Campo>
      <Boton type="submit" cargando={enviando} disabled={token.trim().length < 10 || igId.trim().length < 5}>Conectar con token</Boton>
    </form>
  );
}
