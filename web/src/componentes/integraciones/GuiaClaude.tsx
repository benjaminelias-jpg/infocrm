import { useEffect, useState } from 'react';
import { api, hace } from '../../api';
import { Boton, BotonConfirmar, Insignia, PasosGuiados, Verificacion, useAviso, Desplegable } from '../../ui';
import PruebaEnVivo from './PruebaEnVivo';
import { B, Bloque, Direccion, Instrucciones } from './comun';

// "Conectá tu Claude": una dirección que se pega en Claude → Conectores.
// Por dentro es una clave de API de la cuenta; la dirección se muestra una
// sola vez (como toda clave). Si se pierde, se crea otra y se borra la vieja.

interface Clave { id: string; nombre: string; prefijo: string; ultimo_uso_en: string | null; revocado_en: string | null; creado_en: string }

export default function GuiaClaude({ apiUrl, onCambio }: { apiUrl: string; onCambio?: () => void }) {
  const aviso = useAviso();
  const [claves, setClaves] = useState<Clave[] | null>(null);
  const [nueva, setNueva] = useState<{ id: string; url: string } | null>(null);
  const [creando, setCreando] = useState(false);
  const [listo, setListo] = useState(false);

  async function cargar() {
    const todas = await api<Clave[]>('/api-keys');
    setClaves(todas.filter((c) => !c.revocado_en));
  }
  useEffect(() => { cargar().catch((e) => aviso.error(e.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function crear() {
    setCreando(true);
    try {
      const r = await api<{ id: string; clave: string }>('/api-keys', { method: 'POST', json: { nombre: 'Claude' } });
      setNueva({ id: r.id, url: `${apiUrl.replace(/\/$/, '')}/mcp/${r.clave}` });
      await cargar(); onCambio?.();
    } catch (e: any) { aviso.error(e.message); } finally { setCreando(false); }
  }

  async function desconectar(c: Clave) {
    try {
      await api(`/api-keys/${c.id}`, { method: 'DELETE' });
      if (nueva?.id === c.id) setNueva(null);
      await cargar(); onCambio?.();
      aviso.exito('Listo: esa conexión ya no tiene acceso a tu CRM.');
    } catch (e: any) { aviso.error(e.message); }
  }

  const comando = nueva ? `claude mcp add --transport http infocrm ${nueva.url}` : '';

  return (
    <div className="space-y-4">
      <p className="text-[13px] text-[var(--text-secondary)]">
        Después podés preguntarle cosas como <i>«¿qué reel me trajo más ventas este mes?»</i> o <i>«pasá a @ana a llamada agendada»</i> y lo hace sobre tu CRM.
      </p>

      <PasosGuiados pasos={[
        {
          titulo: 'Creá tu conexión',
          estado: nueva ? 'hecho' : 'actual',
          resumen: 'Conexión creada',
          contenido: (
            <div className="space-y-2">
              <p className="text-[13px] text-[var(--text-secondary)]">Te damos una dirección personal para tu Claude. Se muestra una sola vez.</p>
              <Boton variante="primario" onClick={crear} cargando={creando} icono="✦">Crear mi conexión</Boton>
            </div>
          ),
        },
        {
          titulo: 'Pegala en Claude',
          estado: !nueva ? 'pendiente' : listo ? 'hecho' : 'actual',
          resumen: <button type="button" className="underline" onClick={() => setListo(false)}>Ver la dirección</button>,
          contenido: nueva && (
            <div className="space-y-3">
              <Direccion url={nueva.url} secreta />
              <Instrucciones app="Claude (claude.ai o la app)" pasos={[
                <>Andá a <B>Configuración → Conectores</B>.</>,
                <>Tocá <B>Agregar conector personalizado</B>.</>,
                <>Nombre: <B>InfoCRM</B>. URL: pegá tu dirección. Tocá <B>Agregar</B>.</>,
              ]} />
              <Desplegable titulo={<span className="text-[12px]">¿Usás Claude Code (terminal)?</span>} tarjeta={false}>
                <Bloque texto={comando} />
              </Desplegable>
              <Boton variante="primario" onClick={() => setListo(true)}>Listo, ya la pegué</Boton>
            </div>
          ),
        },
        {
          titulo: 'Probalo',
          estado: nueva && listo ? 'actual' : 'pendiente',
          contenido: nueva && (
            <PruebaEnVivo tipo="clave" claveId={nueva.id}
              instruccion={<>Abrí un chat nuevo en Claude y preguntale: <B>«¿Cuántos leads entraron esta semana en InfoCRM?»</B></>}
              causas={[
                'La dirección quedó incompleta: tiene que terminar en /mcp/ic_… tal cual la copiaste.',
                'El conector está apagado en ese chat: activalo en el menú de herramientas (el ícono de controles).',
                'Claude respondió sin usar el conector: pedile explícitamente «usá InfoCRM».',
              ]}
              textoOk={() => <>¡Funciona! Claude ya está leyendo tu CRM.</>}
              onOk={() => { aviso.exito('Claude conectado'); onCambio?.(); }} />
          ),
        },
      ]} />

      {claves && claves.length > 0 && (
        <div className="space-y-2">
          <div className="text-[12px] font-medium text-[var(--text-secondary)]">Conexiones activas</div>
          {claves.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2.5" style={{ border: '1px solid var(--border-hairline)' }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  <span className="truncate">{c.nombre}</span>
                  {c.ultimo_uso_en ? <Insignia tono="verde">en uso</Insignia> : <Insignia>sin usar</Insignia>}
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">
                  {c.ultimo_uso_en ? `Usada ${hace(c.ultimo_uso_en)}` : `Creada ${hace(c.creado_en)}`} · empieza con {c.prefijo}
                </div>
              </div>
              <BotonConfirmar tamano="xs" onConfirmar={() => desconectar(c)} confirmar="¿Quitarle el acceso?">Desconectar</BotonConfirmar>
            </div>
          ))}
          <p className="text-[11px] text-[var(--text-muted)]">¿Perdiste la dirección? Creá una conexión nueva y desconectá la vieja.</p>
        </div>
      )}
      {claves && claves.length === 0 && !nueva && (
        <Verificacion estado="inactivo" esperando="Todavía no conectaste ningún Claude." />
      )}
    </div>
  );
}
