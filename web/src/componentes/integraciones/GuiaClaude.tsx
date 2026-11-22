import { useState } from 'react';
import { api, hace } from '../../api';
import {
  Boton, BotonIcono, Desplegable, Entrada, ErrorCarga, Esqueleto, Insignia, Interruptor, ItemMenu, Menu, PasosGuiados,
  TituloSeccion, Verificacion, useAviso, useCarga, type EstadoPaso,
} from '../../ui';
import Icono from '../Iconos';
import PruebaEnVivo from './PruebaEnVivo';
import { B, Bloque, Direccion, Instrucciones, ItemConfirmar } from './comun';

// "Tu Claude": una dirección que se pega en Claude → Conectores.
// Por dentro es una clave de la cuenta (tipo "claude"); la dirección se
// muestra una sola vez. Por defecto Claude SOLO MIRA (números, leads,
// fichas); con el interruptor también puede hacer cambios (mover etapas,
// dejar notas, registrar ventas). Si ya hay una conexión, la guía abre
// mostrándola (no como si no hubiera nada).

interface Clave { id: string; nombre: string; prefijo: string; solo_lectura: boolean; ultimo_uso_en: string | null; creado_en: string }

export default function GuiaClaude({ onCambio, onListo }: { apiUrl?: string; onCambio?: () => void; onListo?: () => void }) {
  const aviso = useAviso();
  const { datos: claves, setDatos, error, recargar } = useCarga(() => api<Clave[]>('/ux/integraciones/claude'), []);
  const [armando, setArmando] = useState(false);
  const [puedeEscribir, setPuedeEscribir] = useState(false);
  const [nueva, setNueva] = useState<{ id: string; url: string; solo_lectura: boolean } | null>(null);
  const [creando, setCreando] = useState(false);
  const [pegada, setPegada] = useState(false);

  async function crear() {
    setCreando(true);
    try {
      const r = await api<Clave & { url: string }>('/ux/integraciones/claude', { method: 'POST', json: { puede_escribir: puedeEscribir } });
      setNueva({ id: r.id, url: r.url, solo_lectura: r.solo_lectura });
      setPegada(false);
      void recargar(true);
      onCambio?.();
    } catch (e: any) { aviso.error(e.message); } finally { setCreando(false); }
  }

  async function cambiar(c: Clave, cambios: { nombre?: string; puede_escribir?: boolean }) {
    setDatos((l) => l?.map((x) => (x.id === c.id ? { ...x, ...(cambios.nombre ? { nombre: cambios.nombre } : {}), ...(cambios.puede_escribir !== undefined ? { solo_lectura: !cambios.puede_escribir } : {}) } : x)) ?? l);
    try {
      await api(`/ux/integraciones/claude/${c.id}`, { method: 'PATCH', json: cambios });
      if (cambios.puede_escribir !== undefined) aviso.exito(cambios.puede_escribir ? 'Listo: ahora también puede hacer cambios.' : 'Listo: ahora solo mira, no toca nada.');
    } catch (e: any) { aviso.error(e.message); void recargar(true); }
  }

  async function desconectar(c: Clave) {
    try {
      await api(`/api-keys/${c.id}`, { method: 'DELETE' });
      if (nueva?.id === c.id) setNueva(null);
      void recargar(true); onCambio?.();
      aviso.exito('Listo: esa conexión ya no tiene acceso a tu CRM.');
    } catch (e: any) { aviso.error(e.message); }
  }

  if (error && !claves) return <ErrorCarga compacto error={error} titulo="No pudimos ver tus conexiones de Claude" onReintentar={() => recargar()} />;
  if (!claves) return <div className="space-y-2"><Esqueleto alto={48} /><Esqueleto alto={48} /></div>;

  const hay = claves.length > 0;
  const pasos = !hay || armando || nueva;
  const usada = claves.map((c) => c.ultimo_uso_en).filter(Boolean).sort().pop() ?? null;
  const comando = nueva ? `claude mcp add --transport http infocrm ${nueva.url}` : '';

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[var(--text-secondary)]">
        Preguntale cosas como <i>«¿qué reel me trajo más ventas este mes?»</i> y te responde con tus datos.
      </p>

      {hay && !pasos && (
        <Verificacion estado={usada ? 'ok' : 'esperando'}
          ok={<><b>Claude conectado</b> · lo usaste {hace(usada)}.</>}
          esperando={<><b>Conexión creada</b> · todavía no la usaste. Abrí Claude y preguntale algo de tu CRM.</>} />
      )}

      {pasos && (
        <PasosGuiados pasos={[
          {
            titulo: 'Creá tu conexión',
            estado: (nueva ? 'hecho' : 'actual') as EstadoPaso,
            resumen: nueva?.solo_lectura === false ? 'Conexión creada · puede hacer cambios' : 'Conexión creada · solo mira',
            contenido: (
              <div className="space-y-3">
                <div className="rounded-lg p-3 text-[12px]" style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}>
                  <div className="font-semibold">Qué puede hacer Claude</div>
                  <p className="mt-0.5 text-[var(--text-secondary)]">Siempre: ver tus números, buscar leads y leer sus fichas.</p>
                  <div className="mt-2">
                    <Interruptor activo={puedeEscribir} onCambiar={setPuedeEscribir}
                      etiqueta={<span className="text-[13px] text-[var(--text-primary)]">Que también pueda hacer cambios (mover etapas, dejar notas, registrar ventas)</span>} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Boton variante="primario" onClick={crear} cargando={creando}>Crear mi conexión</Boton>
                  {hay && <Boton variante="fantasma" onClick={() => setArmando(false)}>Cancelar</Boton>}
                </div>
              </div>
            ),
          },
          {
            titulo: 'Pegala en Claude',
            estado: (!nueva ? 'pendiente' : pegada ? 'hecho' : 'actual') as EstadoPaso,
            resumen: <button type="button" className="underline" onClick={() => setPegada(false)}>Ver la dirección</button>,
            contenido: nueva && (
              <div className="space-y-3">
                <Direccion url={nueva.url} secreta />
                <p className="text-[12px] text-[var(--text-muted)]">Se muestra una sola vez: copiala ahora.</p>
                <Instrucciones app="Claude (claude.ai o la app)" pasos={[
                  <>Andá a <B>Configuración → Conectores</B>.</>,
                  <>Tocá <B>Agregar conector personalizado</B>.</>,
                  <>Nombre: <B>InfoCRM</B>. URL: pegá tu dirección. Tocá <B>Agregar</B>.</>,
                ]} />
                <Desplegable titulo={<span className="text-[12px]">¿Usás Claude Code (la terminal)?</span>} tarjeta={false}>
                  <Bloque titulo="Comando para la terminal" texto={comando} />
                </Desplegable>
                <Boton variante="primario" onClick={() => setPegada(true)}>Listo, ya la pegué</Boton>
              </div>
            ),
          },
          {
            titulo: 'Probalo',
            estado: (nueva && pegada ? 'actual' : 'pendiente') as EstadoPaso,
            contenido: nueva && (
              <PruebaEnVivo tipo="clave" claveId={nueva.id} clave={`claude_${nueva.id}`}
                instruccion={<>Abrí un chat nuevo en Claude y preguntale: <B>«¿Cuántos leads entraron esta semana en InfoCRM?»</B></>}
                causas={[
                  'La dirección quedó incompleta: tiene que terminar en /mcp/ic_… tal cual la copiaste.',
                  'El conector está apagado en ese chat: activalo en el menú de herramientas.',
                  'Claude respondió sin usar el conector: pedile «usá InfoCRM».',
                ]}
                pistaMovil="Podés ir a la app de Claude, preguntarle y volver: te avisamos acá."
                textoOk={() => <><b>¡Funciona!</b> Claude ya está leyendo tu CRM.</>}
                onListo={onListo ? () => { setNueva(null); setArmando(false); onListo(); } : undefined}
                onOk={() => { void recargar(true); onCambio?.(); }} />
            ),
          },
        ]} />
      )}

      {hay && (
        <div>
          <TituloSeccion titulo="Conexiones activas" onMas={!pasos ? () => { setArmando(true); setNueva(null); setPuedeEscribir(false); } : undefined} textoMas="Conectar otro Claude" />
          <div className="space-y-2">
            {claves.map((c) => <FilaClave key={c.id} c={c} onCambiar={(x) => cambiar(c, x)} onDesconectar={() => desconectar(c)} />)}
          </div>
          <p className="mt-2 text-[12px] text-[var(--text-muted)]">¿Perdiste la dirección? Conectá otro Claude y desconectá el viejo.</p>
        </div>
      )}
    </div>
  );
}

function FilaClave({ c, onCambiar, onDesconectar }: { c: Clave; onCambiar: (x: { nombre?: string; puede_escribir?: boolean }) => void; onDesconectar: () => void }) {
  const [renombrando, setRenombrando] = useState(false);
  const [nombre, setNombre] = useState(c.nombre);
  const guardar = () => {
    setRenombrando(false);
    const n = nombre.trim();
    if (n && n !== c.nombre) onCambiar({ nombre: n }); else setNombre(c.nombre);
  };
  return (
    <div className="tarjeta flex items-center gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        {renombrando ? (
          <Entrada autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} onBlur={guardar} maxLength={60} aria-label="Nombre de la conexión"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); guardar(); } if (e.key === 'Escape') { e.stopPropagation(); setNombre(c.nombre); setRenombrando(false); } }} />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setRenombrando(true)} title="Tocá para cambiarle el nombre"
              className="ui-foco min-w-0 truncate rounded text-left text-[13px] font-semibold hover:underline">{c.nombre}</button>
            {c.solo_lectura ? <Insignia>Solo mira</Insignia> : <Insignia tono="azul">Puede hacer cambios</Insignia>}
          </div>
        )}
        <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
          {c.ultimo_uso_en ? `Usada ${hace(c.ultimo_uso_en)}` : `Creada ${hace(c.creado_en)} · todavía sin usar`}
        </div>
      </div>
      <Menu alinear="derecha" ancho={260} titulo={c.nombre} disparador={({ alternar, abierto, ref }) => (
        <BotonIcono ref={ref} etiqueta="Más acciones" onClick={alternar} aria-expanded={abierto}><Icono nombre="puntos" tam={18} /></BotonIcono>
      )}>
        <ItemMenu onClick={() => setRenombrando(true)}>Cambiar el nombre</ItemMenu>
        {c.solo_lectura
          ? <ItemMenu onClick={() => onCambiar({ puede_escribir: true })} descripcion="Mover etapas, dejar notas, registrar ventas">Permitir que haga cambios</ItemMenu>
          : <ItemMenu onClick={() => onCambiar({ puede_escribir: false })} descripcion="Ve todo, pero no cambia nada">Que solo mire</ItemMenu>}
        <ItemConfirmar onConfirmar={onDesconectar} confirmar="¿Quitarle el acceso? Tocá de nuevo">Desconectar</ItemConfirmar>
      </Menu>
    </div>
  );
}
