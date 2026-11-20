import { useState } from 'react';
import { api, fmtFecha, hace } from '../../api';
import {
  Boton, Campo, Entrada, PasosGuiados, Verificacion, Desplegable, useAviso, Insignia,
} from '../../ui';
import PruebaEnVivo from './PruebaEnVivo';
import { B, Direccion, Instrucciones } from './comun';

// Instagram, paso a paso: cuenta profesional → app de Meta → conectar →
// permitir el acceso a los mensajes → probar con un DM real.

const leer = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };
const marcar = (k: string, v: boolean) => { try { v ? localStorage.setItem(k, '1') : localStorage.removeItem(k); } catch { /* sin almacenamiento */ } };
const K_PRO = 'infocrm_ig_profesional';
const K_PERMISO = 'infocrm_ig_permiso_mensajes';

const CAUSAS_DM = [
  'No activaste «Permitir acceso a los mensajes» en la app de Instagram (paso anterior).',
  'El DM salió de la misma cuenta conectada: tiene que ser desde otra cuenta.',
  'Tu app de Meta está en modo desarrollo: solo llegan DMs de cuentas con un rol en la app (agregalas como evaluadoras).',
  'Faltan los avisos de Meta: abrí «Recibir DMs al instante» más abajo.',
];

export default function GuiaInstagram({ ig, ultimoSync, onCambio }: {
  ig: any; ultimoSync?: string | null; onCambio: () => void;
}) {
  const aviso = useAviso();
  const [pro, setPro] = useState(() => leer(K_PRO));
  const [permiso, setPermiso] = useState(() => leer(K_PERMISO));
  const [abriendo, setAbriendo] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const conectado = Boolean(ig?.conectado);
  const tieneApp = Boolean(ig?.tiene_app);
  const dias = ig?.token_expira_en ? Math.ceil((new Date(ig.token_expira_en).getTime() - Date.now()) / 86_400_000) : null;

  async function conectar() {
    setAbriendo(true);
    try {
      const r = await api<{ url: string }>('/instagram/oauth/start');
      window.location.href = r.url; // Meta nos devuelve a /instagram/callback → /conexiones?instagram=ok
    } catch (e: any) { aviso.error(e.message); setAbriendo(false); }
  }

  async function sincronizar() {
    setSincronizando(true);
    try {
      const r = await api<any>('/instagram/sincronizar', { method: 'POST' });
      if (r.ok === false) aviso.error(`No se pudo traer el contenido: ${r.error ?? r.mensaje ?? 'Meta no respondió'}`);
      else aviso.exito(`Listo: ${Number(r.creados ?? 0) + Number(r.actualizados ?? 0)} publicaciones con sus métricas.`);
      onCambio();
    } catch (e: any) { aviso.error(e.message); } finally { setSincronizando(false); }
  }

  const pasoPermiso = {
    titulo: 'Permití el acceso a los mensajes',
    estado: (permiso ? 'hecho' : 'actual') as 'hecho' | 'actual',
    resumen: <button type="button" className="underline" onClick={() => { setPermiso(false); marcar(K_PERMISO, false); }}>Ver cómo</button>,
    contenido: (
      <div className="space-y-3">
        <Instrucciones app="la app de Instagram (en el celular)" pasos={[
          <>Tocá tu perfil → <B>☰</B> → <B>Configuración y actividad</B>.</>,
          <><B>Mensajes y respuestas a historias</B> → <B>Herramientas conectadas</B>.</>,
          <>Activá <B>Permitir acceso a los mensajes</B>.</>,
        ]} />
        <Boton variante="primario" onClick={() => { setPermiso(true); marcar(K_PERMISO, true); }}>Listo, ya lo activé</Boton>
      </div>
    ),
  };
  const pasoProbar = {
    titulo: 'Probá con un DM',
    estado: (permiso ? 'actual' : 'pendiente') as 'actual' | 'pendiente',
    contenido: (
      <PruebaEnVivo tipo="dm" causas={CAUSAS_DM}
        instruccion={<>Desde <B>otra cuenta</B>, mandale un DM a <B>@{ig?.username ?? 'tu cuenta'}</B>. Va a aparecer acá y en el Chat.</>}
        onOk={() => onCambio()} />
    ),
  };

  return (
    <div className="space-y-4">
      {conectado ? (
        <div className="space-y-2 rounded-xl p-3" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
          <div className="flex flex-wrap items-center gap-2">
            <Insignia tono="verde" punto>Conectado</Insignia>
            <span className="text-[14px] font-semibold">@{ig.username ?? '—'}</span>
          </div>
          <div className="text-[12px] text-[var(--text-secondary)]">
            {ultimoSync ? `Contenido actualizado ${hace(ultimoSync)}` : 'Todavía no trajimos tus publicaciones'}
            {dias !== null && (
              <span style={{ color: dias <= 10 ? 'var(--status-critical)' : undefined }}>
                {' · '}la conexión vence el {fmtFecha(ig.token_expira_en)}{dias <= 10 ? ` (en ${Math.max(0, dias)} días: reconectá)` : ''}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Boton tamano="sm" icono="↻" onClick={sincronizar} cargando={sincronizando}>Traer mis publicaciones y métricas</Boton>
            {dias !== null && dias <= 10 && <Boton tamano="sm" variante="primario" onClick={conectar} cargando={abriendo}>Reconectar</Boton>}
          </div>
        </div>
      ) : ig?.ultimo_error ? (
        <ErrorInstagram mensaje={ig.ultimo_error} />
      ) : null}

      {conectado ? (
        <div>
          <div className="mb-2 text-[13px] font-semibold">Para que los DMs lleguen al Chat</div>
          <PasosGuiados pasos={[pasoPermiso, pasoProbar]} />
        </div>
      ) : (
        <PasosGuiados pasos={[
          {
            titulo: 'Tu Instagram tiene que ser profesional',
            estado: pro ? 'hecho' : 'actual',
            resumen: 'Cuenta de Creador o Empresa',
            contenido: (
              <div className="space-y-3">
                <Instrucciones app="Instagram" pasos={[
                  <>Perfil → <B>☰</B> → <B>Configuración y actividad</B> → <B>Tipo de cuenta y herramientas</B>.</>,
                  <>Tocá <B>Cambiar a cuenta profesional</B> y elegí <B>Creador</B> o <B>Empresa</B>.</>,
                ]} />
                <Boton variante="primario" onClick={() => { setPro(true); marcar(K_PRO, true); }}>Ya es profesional</Boton>
              </div>
            ),
          },
          {
            titulo: 'Los datos de tu app de Meta',
            estado: tieneApp ? 'hecho' : pro ? 'actual' : 'pendiente',
            resumen: 'App guardada',
            contenido: <FormApp ig={ig} onGuardada={onCambio} />,
          },
          {
            titulo: 'Conectá tu Instagram',
            estado: tieneApp && pro ? 'actual' : 'pendiente',
            contenido: (
              <div className="space-y-3">
                <p className="text-[13px] text-[var(--text-secondary)]">Te llevamos a Instagram para que aceptes y volvés solo acá.</p>
                <button type="button" onClick={conectar} disabled={abriendo}
                  className="ui-foco inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[14px] font-semibold text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(90deg,#833ab4,#fd1d1d,#fcb045)' }}>
                  {abriendo ? 'Abriendo Instagram…' : 'Conectar Instagram'}
                </button>
                <FormToken onConectado={onCambio} />
              </div>
            ),
          },
          { ...pasoPermiso, estado: 'pendiente' as const },
          { ...pasoProbar, estado: 'pendiente' as const },
        ]} />
      )}

      <Desplegable titulo="Recibir DMs y comentarios al instante" subtitulo="Configuración de los avisos de Meta (una sola vez)" clave="ig_avisos_meta">
        <div className="space-y-3">
          <Instrucciones app="Meta for Developers → tu app → Webhooks → Instagram" pasos={[
            <>Pegá la <B>URL de devolución</B> y el <B>token de verificación</B> de abajo y tocá <B>Verificar y guardar</B>.</>,
            <>Suscribite a <B>comments</B>, <B>messages</B>, <B>messaging_postbacks</B>, <B>message_reactions</B>, <B>messaging_referral</B> y <B>mentions</B>.</>,
          ]} />
          {ig?.webhook_url && <Direccion etiqueta="URL de devolución" url={ig.webhook_url} />}
          {ig?.webhook_verify_token && <Direccion etiqueta="Token de verificación" url={ig.webhook_verify_token} />}
          <p className="text-[11px] text-[var(--text-muted)]">Cada aviso de Meta se verifica con la firma de tu App Secret. Mientras Meta no apruebe tu app, podés probar los automensajes con «🧪 Probar» en el Chat.</p>
        </div>
      </Desplegable>

      {conectado && (
        <Desplegable titulo="Reconectar o usar otra cuenta" clave="ig_reconectar">
          <div className="space-y-3">
            <Boton onClick={conectar} cargando={abriendo}>↻ Reconectar Instagram</Boton>
            <FormToken onConectado={onCambio} />
            <Desplegable titulo={<span className="text-[12px]">Cambiar los datos de la app de Meta</span>} tarjeta={false}>
              <FormApp ig={ig} onGuardada={onCambio} />
            </Desplegable>
          </div>
        </Desplegable>
      )}
    </div>
  );
}

/** Traduce los errores de Meta a algo entendible + qué hacer; el texto crudo queda plegado. */
export function traducirErrorInstagram(m: string): { titulo: string; hacer: string } {
  if (/no pude identificar tu Instagram/i.test(m)) {
    return {
      titulo: 'Meta aceptó, pero no encontramos tu cuenta de Instagram profesional.',
      hacer: 'Revisá que tu Instagram sea profesional y esté vinculado a tu página de Facebook. Si sigue igual, conectá pegando un token (abajo).',
    };
  }
  if (/rechazó el código/i.test(m)) return { titulo: 'Meta no aceptó la autorización (puede haber vencido).', hacer: 'Tocá «Conectar Instagram» otra vez y aceptá sin demorarte.' };
  if (/rechazó el token o el ID/i.test(m)) return { titulo: 'Meta no aceptó el token o el ID de Instagram.', hacer: 'Generá el token con los permisos instagram_basic e instagram_manage_messages y usá el ID de tu cuenta de Instagram.' };
  if (/Faltan las credenciales|Falta la App/i.test(m)) return { titulo: 'Faltan los datos de tu app de Meta.', hacer: 'Completá el paso «Los datos de tu app de Meta».' };
  if (/expired|caduc|venci/i.test(m)) return { titulo: 'La conexión con Instagram venció.', hacer: 'Tocá «Conectar Instagram» para renovarla.' };
  return { titulo: 'No se pudo conectar con Instagram.', hacer: 'Probá de nuevo. Si se repite, conectá pegando un token (abajo).' };
}

function ErrorInstagram({ mensaje }: { mensaje: string }) {
  const t = traducirErrorInstagram(mensaje);
  return (
    <div className="space-y-1.5">
      <Verificacion estado="error" error={<><b>{t.titulo}</b> {t.hacer}</>} />
      <details className="px-1 text-[11px] text-[var(--text-muted)]">
        <summary className="cursor-pointer select-none">Detalle técnico</summary>
        <p className="mt-1 break-words">{mensaje}</p>
      </details>
    </div>
  );
}

/** App ID + App Secret (y opcionales) de la app de Meta. */
function FormApp({ ig, onGuardada }: { ig: any; onGuardada: () => void }) {
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
        <>En la configuración de inicio de sesión de Instagram, agregá esta <B>URL de redireccionamiento</B>:</>,
      ]} />
      <Direccion url={redirect} />
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
          <Campo etiqueta="ID de tu Instagram" ayuda="Business settings → Cuentas de Instagram → Identificador">
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
    <Desplegable titulo={<span className="text-[12px]">¿No funciona el botón? Conectá pegando un token</span>} tarjeta={false}>
      <form onSubmit={enviar} className="space-y-3">
        <p className="text-[12px] text-[var(--text-muted)]">
          En Meta: Business settings → Usuarios del sistema → asigná tu Instagram y generá un token con <code>instagram_basic</code> e <code>instagram_manage_messages</code>.
          Si el token dura poco, el CRM lo cambia solo por uno de ~60 días.
        </p>
        <Campo etiqueta="ID de tu Instagram">
          <Entrada value={igId} onChange={(e) => setIgId(e.target.value)} inputMode="numeric" placeholder="p. ej. 17841400000000000" autoComplete="off" />
        </Campo>
        <Campo etiqueta="Token">
          <Entrada value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" />
        </Campo>
        <Boton type="submit" cargando={enviando} disabled={token.trim().length < 10 || igId.trim().length < 5}>Conectar con token</Boton>
      </form>
    </Desplegable>
  );
}
