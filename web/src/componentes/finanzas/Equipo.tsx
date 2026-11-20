import { useState } from 'react';
import { api, fmtDinero, hace, plural } from '../../api';
import { textoDe } from '../../textos';
import {
  Avatar, Boton, BotonIcono, Campo, Chevron, Chip, Copiar, Desplegable, Dialogo, Entrada, ErrorCarga, Esqueleto, FilaChips,
  Interruptor, ItemMenu, Seleccion, SeparadorMenu, TituloSeccion, Vacio, useAviso, useCarga,
} from '../../ui';
import Icono from '../Iconos';
import {
  EntradaPorcentaje, MenuPuntos, SelectorPeriodo, ejemploPct, fechaCorta, fmtDineroExacto, parseMonto, pctTexto, usePeriodo,
} from './comun';
import type { Miembro, RespEquipo } from './tipos';

// Tu equipo, UNA sola lista: las personas con comisión y los usuarios del
// CRM (los que se asignan en el Pipeline y el Chat). Cada uno con su rol, su
// comisión (se toca para cambiarla) y cuánto le corresponde en el período.
// Solo el dueño o un administrador pueden sumar, editar o dar de baja.
// No depende de la pantalla de Finanzas: se puede montar también en Configuración.

type RolUi = 'setter' | 'closer' | 'closer_setter' | 'admin' | 'otro';
const ROLES: Array<{ id: RolUi; e: string; d: string }> = [
  { id: 'setter', e: 'Setter', d: 'Consigue y califica leads' },
  { id: 'closer', e: 'Closer', d: 'Cierra las ventas' },
  { id: 'closer_setter', e: 'Closer y setter', d: 'Hace las dos cosas' },
  { id: 'admin', e: 'Administrador', d: 'Puede configurar todo' },
];
const rolUi = (m: Miembro): RolUi => (m.rol === 'team_lead' || (!m.rol && (m.rol_usuario === 'admin' || m.rol_usuario === 'owner')) ? 'admin'
  : (m.rol ?? m.rol_usuario ?? 'closer') as RolUi);
function rolVisible(m: Miembro) {
  if (m.rol_usuario === 'owner') return 'Dueño';
  if (m.rol === 'closer_setter') return 'Closer y setter';
  if (m.rol === 'team_lead' || m.rol_usuario === 'admin') return 'Administrador';
  if (m.rol) return textoDe('rol_equipo', m.rol);
  return textoDe('rol_usuario', m.rol_usuario);
}
const pctEnCampo = (n: number | null | undefined) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: false }).format(Number(n ?? 0));
const emailValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** Contraseña inicial fácil de dictar: "lomi-taru-4821". */
function generarClave() {
  const s = 'bcdfgjklmnprstvz'; const v = 'aeiou';
  const r = new Uint32Array(9);
  crypto.getRandomValues(r);
  const sil = (i: number) => s[r[i] % s.length] + v[r[i + 1] % v.length];
  return `${sil(0)}${sil(2)}-${sil(4)}${sil(6)}-${String(1000 + (r[8] % 9000))}`;
}

type DialogoEquipo =
  | { tipo: 'nuevo' } | { tipo: 'editar'; m: Miembro } | { tipo: 'acceso'; m: Miembro } | { tipo: 'clave'; m: Miembro }
  | { tipo: 'baja'; m: Miembro } | { tipo: 'ficha'; m: Miembro } | { tipo: 'vincular'; m: Miembro }
  | { tipo: 'credenciales'; nombre: string; email: string; password: string };

export default function Equipo({ version = 0, nuevo }: { version?: number; nuevo?: boolean }) {
  const aviso = useAviso();
  const [periodo, setPeriodo] = usePeriodo();
  const carga = useCarga(() => api<RespEquipo>(`/ux/finanzas/equipo?periodo=${periodo}`), [periodo, version]);
  const [dialogo, setDialogo] = useState<DialogoEquipo | null>(nuevo ? { tipo: 'nuevo' } : null);
  const d = carga.datos;
  const puede = Boolean(d?.puede_gestionar);
  const activos = d?.miembros.filter((m) => m.activo) ?? [];
  const bajas = d?.miembros.filter((m) => !m.activo) ?? [];
  const sinFicha = d?.miembros.filter((m) => !m.persona_id && m.activo) ?? [];

  const listo = (texto: string) => { setDialogo(null); carga.recargar(true); aviso.exito(texto); };

  async function patchPct(m: Miembro, pct: number) {
    try {
      await api(`/ux/finanzas/equipo/${m.persona_id}`, { method: 'PATCH', json: { comision_venta_pct: pct } });
      carga.recargar(true);
      aviso.exito(`Comisión de ${m.nombre}: ${pctTexto(pct)} de cada venta (se aplica a las ventas nuevas).`);
    } catch (e: any) { aviso.error(e.message); }
  }
  async function alta(m: Miembro) {
    try { await api(`/ux/finanzas/equipo/${m.persona_id}/alta`, { method: 'POST' }); listo(`${m.nombre} volvió al equipo${m.usuario_id ? ' y puede entrar al CRM' : ''}.`); } catch (e: any) { aviso.error(e.message); }
  }

  const fila = (m: Miembro) => (
    <FilaMiembro key={m.clave} m={m} puede={puede} yo={d?.yo} periodo={periodo} texto={d?.periodo.texto ?? ''}
      hayUsuariosSinFicha={sinFicha.length > 0}
      onPct={(pct) => patchPct(m, pct)} onDialogo={(tipo) => setDialogo({ tipo, m } as DialogoEquipo)} onAlta={() => alta(m)} />
  );

  return (
    <section className="space-y-3" aria-label="Equipo">
      <SelectorPeriodo valor={periodo} onCambiar={setPeriodo} />
      <TituloSeccion titulo="Tu equipo" onMas={puede ? () => setDialogo({ tipo: 'nuevo' }) : undefined} textoMas="Sumar a alguien"
        subtitulo={d ? `${plural(activos.length, 'persona')} · comisiones ${d.periodo.texto}: ${fmtDinero(d.total_comisiones)}` : ' '} />
      {d && !puede && <p className="text-[12px] text-[var(--text-muted)]">Solo el dueño o un administrador pueden cambiar el equipo.</p>}

      {carga.error && !d ? (
        <div className="tarjeta"><ErrorCarga error={carga.error} titulo="No pudimos cargar tu equipo" onReintentar={() => carga.recargar()} /></div>
      ) : !d ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando">{[0, 1, 2].map((i) => <Esqueleto key={i} alto={68} className="rounded-xl" />)}</div>
      ) : activos.length === 0 ? (
        <div className="tarjeta">
          <Vacio icono="🤝" titulo="Sumá a tu equipo"
            texto="Closers y setters con su comisión: cada venta calcula sola lo que le toca a cada uno. Si querés, también pueden entrar al CRM."
            accion={puede ? <Boton variante="primario" onClick={() => setDialogo({ tipo: 'nuevo' })}>Sumar a alguien</Boton> : undefined} />
        </div>
      ) : (
        <div role="list" className="tarjeta divide-y divide-[var(--border-hairline)]">{activos.map(fila)}</div>
      )}
      {bajas.length > 0 && (
        <Desplegable clave="fin-equipo-bajas" titulo={`Dados de baja (${bajas.length})`} subtitulo="No aparecen al vender ni entran al CRM; sus ventas quedan">
          <div role="list" className="-mx-3.5 -mb-3.5 divide-y divide-[var(--border-hairline)] border-t border-[var(--border-hairline)]">{bajas.map(fila)}</div>
        </Desplegable>
      )}

      {dialogo?.tipo === 'nuevo' && <DialogoPersona onCerrar={() => setDialogo(null)}
        onListo={(nombre, acceso) => {
          carga.recargar(true);
          if (acceso) setDialogo({ tipo: 'credenciales', nombre, ...acceso });
          else listo(`${nombre} ya está en tu equipo`);
        }} />}
      {dialogo?.tipo === 'editar' && <DialogoPersona m={dialogo.m} onCerrar={() => setDialogo(null)} onListo={(nombre) => listo(`${nombre} actualizado`)} />}
      {(dialogo?.tipo === 'acceso' || dialogo?.tipo === 'clave') && (
        <DialogoAcceso m={dialogo.m} soloClave={dialogo.tipo === 'clave'} onCerrar={() => setDialogo(null)}
          onListo={(acc) => { carga.recargar(true); setDialogo({ tipo: 'credenciales', nombre: dialogo.m.nombre, ...acc }); }} />
      )}
      {dialogo?.tipo === 'ficha' && <DialogoFicha m={dialogo.m} onCerrar={() => setDialogo(null)} onListo={() => listo(`Listo: ${dialogo.m.nombre} ya tiene su comisión`)} />}
      {dialogo?.tipo === 'vincular' && <DialogoVincular m={dialogo.m} usuarios={sinFicha} onCerrar={() => setDialogo(null)} onListo={() => listo(`${dialogo.m.nombre} quedó enlazado con su usuario del CRM`)} />}
      {dialogo?.tipo === 'baja' && <DialogoBaja m={dialogo.m} onCerrar={() => setDialogo(null)} onListo={(t) => listo(t)} />}
      {dialogo?.tipo === 'credenciales' && <DialogoCredenciales {...dialogo} onCerrar={() => setDialogo(null)} />}
    </section>
  );
}

function FilaMiembro({ m, puede, yo, periodo, texto, hayUsuariosSinFicha, onPct, onDialogo, onAlta }: {
  m: Miembro; puede: boolean; yo?: string; periodo: string; texto: string; hayUsuariosSinFicha: boolean;
  onPct: (pct: number) => void; onDialogo: (tipo: 'editar' | 'acceso' | 'clave' | 'baja' | 'ficha' | 'vincular') => void; onAlta: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [pct, setPct] = useState(pctEnCampo(m.comision_venta_pct));
  const [verVentas, setVerVentas] = useState(false);
  const n = parseMonto(pct);
  const ok = Number.isFinite(n) && n >= 0 && n <= 100;
  const soyYo = Boolean(yo && m.usuario_id === yo);

  return (
    <div role="listitem" className={`px-3.5 py-3 ${m.activo ? '' : 'opacity-80'}`}>
      <div className="flex items-center gap-3">
        <Avatar id={m.clave} nombre={m.nombre} tam={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium">{m.nombre}{soyYo && <span className="font-normal text-[var(--text-muted)]"> (vos)</span>}</div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-[var(--text-muted)]">
            <span>{rolVisible(m)}</span>
            <span aria-hidden>·</span>
            {m.acceso
              ? <span style={{ color: 'var(--status-good)' }}>Entra al CRM{m.ultimo_acceso_en ? <span className="text-[var(--text-muted)]"> · entró {hace(m.ultimo_acceso_en)}</span> : ''}</span>
              : <span>{m.activo ? 'Sin acceso al CRM' : 'De baja'}</span>}
          </div>
        </div>
        {m.persona_id ? (
          !editando && (puede
            ? <button type="button" onClick={() => setEditando(true)} aria-label={`Comisión de ${m.nombre}: ${pctTexto(m.comision_venta_pct)}. Cambiar`}
              className="ui-foco cifras h-9 shrink-0 rounded-lg border border-[var(--border-hairline)] px-3 text-[13px] font-semibold hover:bg-[var(--page-plane)]">{pctTexto(m.comision_venta_pct)}</button>
            : <span className="cifras shrink-0 text-[13px] font-semibold">{pctTexto(m.comision_venta_pct)}</span>)
        ) : puede && m.activo ? (
          <Boton tamano="sm" onClick={() => onDialogo('ficha')} className="shrink-0">Ponerle comisión</Boton>
        ) : null}
        {puede && (
          <MenuPuntos etiqueta={`Más opciones de ${m.nombre}`}>
            {m.persona_id && <ItemMenu onClick={() => onDialogo('editar')}>Editar</ItemMenu>}
            {m.persona_id && !m.usuario_id && m.activo && <ItemMenu onClick={() => onDialogo('acceso')} descripcion="Con email y una contraseña inicial">Darle acceso al CRM</ItemMenu>}
            {m.persona_id && !m.usuario_id && m.activo && hayUsuariosSinFicha && <ItemMenu onClick={() => onDialogo('vincular')} descripcion="Es la misma persona que entra al CRM">Enlazar con su usuario</ItemMenu>}
            {m.usuario_id && m.persona_id && m.acceso && (m.rol_usuario !== 'owner' || soyYo) && <ItemMenu onClick={() => onDialogo('clave')}>Nueva contraseña</ItemMenu>}
            {!m.persona_id && m.activo && <ItemMenu onClick={() => onDialogo('ficha')}>Ponerle comisión</ItemMenu>}
            {m.persona_id && m.activo && <><SeparadorMenu /><ItemMenu peligro onClick={() => onDialogo('baja')} descripcion="Sus ventas y comisiones quedan">Dar de baja</ItemMenu></>}
            {m.persona_id && !m.activo && <ItemMenu onClick={onAlta}>Volver a sumarlo</ItemMenu>}
          </MenuPuntos>
        )}
      </div>

      {editando && (
        <form className="mt-2.5 flex flex-wrap items-start gap-2 pl-12" onSubmit={(e) => { e.preventDefault(); if (ok) { onPct(n); setEditando(false); } }}>
          <Campo ayuda={ok ? ejemploPct(n, 'le tocan') : undefined} error={!ok ? 'Un número entre 0 y 100' : undefined}>
            <EntradaPorcentaje valor={pct} onCambiar={setPct} autoFocus ancho={110} etiqueta={`Comisión de ${m.nombre}`} />
          </Campo>
          <Boton variante="primario" type="submit" disabled={!ok}>Guardar</Boton>
          <BotonIcono etiqueta="Cancelar" tamano="md" onClick={() => { setEditando(false); setPct(pctEnCampo(m.comision_venta_pct)); }}><Icono nombre="cerrar" tam={16} /></BotonIcono>
        </form>
      )}

      {m.persona_id && m.ventas > 0 && (
          <div className="mt-1 pl-12">
            <button type="button" onClick={() => setVerVentas((v) => !v)} aria-expanded={verVentas}
              className="ui-foco -ml-1 inline-flex min-h-[32px] items-center gap-1 rounded px-1 text-left text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <Chevron abierto={verVentas} tam={14} />
              <span className="first-letter:uppercase">{texto}: {plural(m.ventas, 'venta')} · le corresponden <strong className="cifras text-[var(--text-primary)]">{fmtDineroExacto(m.comision)}</strong></span>
            </button>
            {verVentas && <VentasDe personaId={m.persona_id} periodo={periodo} />}
          </div>
      )}
    </div>
  );
}

function VentasDe({ personaId, periodo }: { personaId: string; periodo: string }) {
  const carga = useCarga(() => api<any[]>(`/ux/finanzas/equipo/${personaId}/ventas?periodo=${periodo}`), [personaId, periodo]);
  if (carga.error) return <ErrorCarga compacto error={carga.error} onReintentar={() => carga.recargar()} />;
  if (!carga.datos) return <Esqueleto alto={36} className="mt-1.5 rounded-lg" />;
  return (
    <ul className="mt-1.5 divide-y divide-[var(--border-hairline)] rounded-lg border border-[var(--border-hairline)] text-[12px]">
      {carga.datos.map((v) => (
        <li key={v.id} className="flex items-center gap-2 px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate">
            {v.lead_nombre ?? (v.ig_username ? `@${v.ig_username}` : 'Sin lead')}
            <span className="text-[var(--text-muted)]"> · {v.producto ?? 'sin curso'} · {fechaCorta(v.fecha)}{v.como === 'setter' ? ' · como setter' : ''}</span>
          </span>
          <span className="cifras shrink-0 font-semibold">{fmtDineroExacto(v.comision, v.moneda)}</span>
        </li>
      ))}
    </ul>
  );
}

function DialogoPersona({ m, onCerrar, onListo }: {
  m?: Miembro; onCerrar: () => void; onListo: (nombre: string, acceso?: { email: string; password: string }) => void;
}) {
  const aviso = useAviso();
  const [nombre, setNombre] = useState(m?.nombre ?? '');
  const [rol, setRol] = useState<RolUi>(m ? rolUi(m) : 'closer');
  const [pct, setPct] = useState(m ? pctEnCampo(m.comision_venta_pct) : '');
  const [acceso, setAcceso] = useState(false);
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState(generarClave);
  const [tocado, setTocado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const n = pct.trim() ? parseMonto(pct) : 0;
  const okPct = Number.isFinite(n) && n >= 0 && n <= 100;
  const okAcceso = !acceso || (emailValido(email) && clave.length >= 8);
  const ok = nombre.trim().length > 0 && okPct && okAcceso;
  const roles = m?.rol === 'otro' ? [...ROLES, { id: 'otro' as RolUi, e: 'Otro', d: '' }] : ROLES;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setTocado(true);
    if (!ok) return;
    setOcupado(true);
    try {
      if (m?.persona_id) {
        await api(`/ux/finanzas/equipo/${m.persona_id}`, { method: 'PATCH', json: { nombre: nombre.trim(), rol, comision_venta_pct: n } });
        onListo(nombre.trim());
      } else {
        const r = await api<{ acceso: { email: string; password: string } | null }>('/ux/finanzas/equipo', {
          method: 'POST',
          json: { nombre: nombre.trim(), rol, comision_venta_pct: n, acceso: acceso ? { email: email.trim(), password: clave } : null },
        });
        onListo(nombre.trim(), r.acceso ?? undefined);
      }
    } catch (err: any) { aviso.error(err.message); } finally { setOcupado(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={m ? `Editar a ${m.nombre}` : 'Sumar a alguien al equipo'} ancho={460}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" type="submit" form="form-persona" cargando={ocupado} disabled={tocado && !ok}>{m ? 'Guardar' : 'Sumar'}</Boton>
      </>}>
      <form id="form-persona" onSubmit={guardar} className="space-y-3.5">
        <Campo etiqueta="Nombre" htmlFor="persona-nombre" error={tocado && !nombre.trim() ? 'Poné el nombre' : undefined}>
          <Entrada id="persona-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: Marco Pérez" maxLength={120} />
        </Campo>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Rol</div>
          <FilaChips>{roles.map((r) => <Chip key={r.id} activo={rol === r.id} onClick={() => setRol(r.id)}>{r.e}</Chip>)}</FilaChips>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{roles.find((r) => r.id === rol)?.d}</p>
        </div>
        <Campo etiqueta="Comisión por venta" htmlFor="persona-pct" ayuda={okPct ? ejemploPct(n, 'le tocan') ?? undefined : undefined}
          error={tocado && !okPct ? 'Un número entre 0 y 100' : undefined}>
          <EntradaPorcentaje id="persona-pct" valor={pct} onCambiar={setPct} ancho={140} />
        </Campo>
        {!m && (
          <div className="space-y-3 rounded-xl px-3.5 py-3" style={{ background: 'var(--page-plane)' }}>
            <Interruptor activo={acceso} onCambiar={setAcceso} etiqueta="Puede entrar al CRM (ve sus leads y el Chat)" />
            {acceso && (
              <>
                <Campo etiqueta="Email" htmlFor="persona-email" error={tocado && !emailValido(email) ? 'Revisá el email' : undefined}>
                  <Entrada id="persona-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="marco@tuequipo.com" />
                </Campo>
                <CampoClave clave={clave} setClave={setClave} tocado={tocado} />
              </>
            )}
          </div>
        )}
      </form>
    </Dialogo>
  );
}

function CampoClave({ clave, setClave, tocado }: { clave: string; setClave: (c: string) => void; tocado: boolean }) {
  return (
    <Campo etiqueta="Contraseña inicial" htmlFor="persona-clave" error={tocado && clave.length < 8 ? 'Al menos 8 caracteres' : undefined}
      ayuda="Se la pasás vos. La vas a ver una sola vez después de guardar.">
      <div className="flex gap-2">
        <Entrada id="persona-clave" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="new-password" className="font-mono" />
        <BotonIcono etiqueta="Generar otra" variante="secundario" tamano="md" onClick={() => setClave(generarClave())}><Icono nombre="sincronizar" tam={16} /></BotonIcono>
      </div>
    </Campo>
  );
}

function DialogoAcceso({ m, soloClave, onCerrar, onListo }: {
  m: Miembro; soloClave: boolean; onCerrar: () => void; onListo: (acc: { email: string; password: string }) => void;
}) {
  const aviso = useAviso();
  const [email, setEmail] = useState(m.email ?? '');
  const [clave, setClave] = useState(generarClave);
  const [tocado, setTocado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const ok = clave.length >= 8 && (soloClave || emailValido(email));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setTocado(true);
    if (!ok) return;
    setOcupado(true);
    try {
      const r = soloClave
        ? await api<{ email: string; password: string }>(`/ux/finanzas/equipo/${m.persona_id}/clave`, { method: 'POST', json: { password: clave } })
        : (await api<{ acceso: { email: string; password: string } }>(`/ux/finanzas/equipo/${m.persona_id}/acceso`, { method: 'POST', json: { email: email.trim(), password: clave } })).acceso;
      onListo(r);
    } catch (err: any) { aviso.error(err.message); } finally { setOcupado(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={soloClave ? `Nueva contraseña para ${m.nombre}` : `Darle acceso a ${m.nombre}`} ancho={440}
      descripcion={soloClave ? 'La anterior deja de funcionar.' : 'Va a poder entrar al CRM, ver sus leads y el Chat.'}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" type="submit" form="form-acceso" cargando={ocupado} disabled={tocado && !ok}>{soloClave ? 'Cambiar contraseña' : 'Darle acceso'}</Boton>
      </>}>
      <form id="form-acceso" onSubmit={guardar} className="space-y-3.5">
        {!soloClave && (
          <Campo etiqueta="Email" htmlFor="acceso-email" error={tocado && !emailValido(email) ? 'Revisá el email' : undefined}>
            <Entrada id="acceso-email" type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@tuequipo.com" />
          </Campo>
        )}
        <CampoClave clave={clave} setClave={setClave} tocado={tocado} />
      </form>
    </Dialogo>
  );
}

function DialogoCredenciales({ nombre, email, password, onCerrar }: { nombre: string; email: string; password: string; onCerrar: () => void }) {
  const todo = `Entrá a ${window.location.origin}\nEmail: ${email}\nContraseña: ${password}`;
  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={`Listo: ${nombre} ya puede entrar`} ancho={440} autoFoco={false}
      descripcion="Pasale estos datos. La contraseña no se vuelve a mostrar (si se la olvida, le ponés una nueva desde ⋯)."
      pie={<><Copiar texto={todo} etiqueta="Copiar todo" className="!h-9" /><Boton variante="primario" onClick={onCerrar}>Listo</Boton></>}>
      <dl className="space-y-2.5 rounded-xl px-3.5 py-3" style={{ background: 'var(--page-plane)' }}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0"><dt className="text-[11px] text-[var(--text-muted)]">Email</dt><dd className="truncate text-[14px]">{email}</dd></div>
          <Copiar texto={email} />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0"><dt className="text-[11px] text-[var(--text-muted)]">Contraseña</dt><dd className="font-mono text-[15px] font-semibold tracking-wide">{password}</dd></div>
          <Copiar texto={password} />
        </div>
      </dl>
    </Dialogo>
  );
}

function DialogoFicha({ m, onCerrar, onListo }: { m: Miembro; onCerrar: () => void; onListo: () => void }) {
  const aviso = useAviso();
  const [rol, setRol] = useState<RolUi>(rolUi(m));
  const [pct, setPct] = useState(m.rol_usuario === 'owner' ? '0' : '');
  const [ocupado, setOcupado] = useState(false);
  const n = pct.trim() ? parseMonto(pct) : 0;
  const ok = Number.isFinite(n) && n >= 0 && n <= 100;
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    setOcupado(true);
    try {
      await api(`/ux/finanzas/equipo/usuario/${m.usuario_id}/ficha`, { method: 'POST', json: { comision_venta_pct: n, rol } });
      onListo();
    } catch (err: any) { aviso.error(err.message); } finally { setOcupado(false); }
  }
  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={`Comisión de ${m.nombre}`} ancho={420}
      descripcion="Ya entra al CRM. Con su comisión, aparece al registrar ventas y se calcula lo que le toca."
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" type="submit" form="form-ficha" cargando={ocupado} disabled={!ok}>Guardar</Boton>
      </>}>
      <form id="form-ficha" onSubmit={guardar} className="space-y-3.5">
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Rol en las ventas</div>
          <FilaChips>{ROLES.map((r) => <Chip key={r.id} activo={rol === r.id} onClick={() => setRol(r.id)}>{r.e}</Chip>)}</FilaChips>
        </div>
        <Campo etiqueta="Comisión por venta" htmlFor="ficha-pct" ayuda={ok ? ejemploPct(n, 'le tocan') ?? undefined : undefined} error={!ok ? 'Un número entre 0 y 100' : undefined}>
          <EntradaPorcentaje id="ficha-pct" valor={pct} onCambiar={setPct} ancho={140} autoFocus />
        </Campo>
      </form>
    </Dialogo>
  );
}

function DialogoVincular({ m, usuarios, onCerrar, onListo }: { m: Miembro; usuarios: Miembro[]; onCerrar: () => void; onListo: () => void }) {
  const aviso = useAviso();
  const [usuarioId, setUsuarioId] = useState(usuarios[0]?.usuario_id ?? '');
  const [ocupado, setOcupado] = useState(false);
  async function guardar() {
    setOcupado(true);
    try { await api(`/ux/finanzas/equipo/${m.persona_id}/vincular`, { method: 'POST', json: { usuario_id: usuarioId } }); onListo(); } catch (e: any) { aviso.error(e.message); } finally { setOcupado(false); }
  }
  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={`¿${m.nombre} ya entra al CRM?`} ancho={420} autoFoco={false}
      descripcion="Elegí su usuario: así, quien atiende al lead en el Pipeline se completa solo como closer de la venta."
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={guardar} cargando={ocupado} disabled={!usuarioId}>Enlazar</Boton>
      </>}>
      <Campo etiqueta="Su usuario del CRM" htmlFor="vincular-usuario">
        <Seleccion id="vincular-usuario" value={usuarioId} onChange={(e) => setUsuarioId(e.target.value)}>
          {usuarios.map((u) => <option key={u.usuario_id!} value={u.usuario_id!}>{u.nombre}{u.email ? ` · ${u.email}` : ''}</option>)}
        </Seleccion>
      </Campo>
    </Dialogo>
  );
}

function DialogoBaja({ m, onCerrar, onListo }: { m: Miembro; onCerrar: () => void; onListo: (texto: string) => void }) {
  const aviso = useAviso();
  const [ocupado, setOcupado] = useState(false);
  async function confirmar() {
    setOcupado(true);
    try {
      const r = await api<{ acceso_cortado: boolean }>(`/ux/finanzas/equipo/${m.persona_id}/baja`, { method: 'POST' });
      onListo(`${m.nombre} quedó de baja${r.acceso_cortado ? ' y ya no puede entrar al CRM' : ''}. Sus ventas siguen guardadas.`);
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(false); }
  }
  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={`¿Dar de baja a ${m.nombre}?`} ancho={420} autoFoco={false}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="peligro" onClick={confirmar} cargando={ocupado}>Dar de baja</Boton>
      </>}>
      <ul className="list-disc space-y-1 pl-5 text-[13px] text-[var(--text-secondary)]">
        <li>Deja de aparecer al registrar ventas.</li>
        {m.acceso && m.rol_usuario !== 'owner' && <li>No puede entrar más al CRM.</li>}
        <li>Sus ventas y comisiones quedan guardadas.</li>
        <li>Lo podés volver a sumar cuando quieras.</li>
      </ul>
    </Dialogo>
  );
}
