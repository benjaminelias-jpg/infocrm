import { useState } from 'react';
import { api } from '../../api';
import { Boton, Campo, Dialogo, Entrada, useAviso } from '../../ui';

// "Probar automensajes" (solo el dueño): simula que este lead hace algo en
// Instagram. Los automensajes corren de verdad en el CRM (pueden cambiarle la
// etapa o el puntaje), pero no se manda nada a Instagram.

const OPCIONES: Array<{ id: string; texto: string; icono: string; pide?: string }> = [
  { id: 'dm', texto: 'Te escribe por DM', icono: '💬', pide: 'Qué te escribe' },
  { id: 'comentario', texto: 'Comenta un reel', icono: '🗨️', pide: 'Qué comenta (ej. GUIA)' },
  { id: 'historia', texto: 'Responde tu historia', icono: '📸', pide: 'Qué responde' },
  { id: 'mencion', texto: 'Te menciona', icono: '@' },
  { id: 'reaccion', texto: 'Reacciona a un mensaje', icono: '❤️' },
  { id: 'anuncio', texto: 'Viene de un anuncio', icono: '📣' },
];

export function ProbarLead({ abierto, onCerrar, leadId, nombre, onListo }: {
  abierto: boolean; onCerrar: () => void; leadId: string; nombre: string; onListo: () => void;
}) {
  const aviso = useAviso();
  const [tipo, setTipo] = useState('dm');
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const op = OPCIONES.find((o) => o.id === tipo)!;

  async function probar(e?: React.FormEvent) {
    e?.preventDefault();
    setOcupado(true);
    try {
      const r = await api<any>('/instagram/simular-evento', {
        method: 'POST', json: { lead_id: leadId, tipo, texto: op.pide ? texto.trim() || undefined : undefined },
      });
      aviso.info(r?.reanudado ? '🧪 El lead respondió y su automensaje siguió donde estaba.'
        : r?.flujo ? `🧪 Se disparó el automensaje «${r.flujo}»${r.omitido ? ` (${r.omitido})` : ''}.`
          : '🧪 Listo. Ningún automensaje coincide con esto.');
      setTexto('');
      onCerrar();
      onListo();
    } catch (err: any) {
      aviso.error(err.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo="Probar tus automensajes" ancho={480} autoFoco={false}
      descripcion={`Hacé de cuenta que ${nombre} hace algo en Instagram. Tus automensajes corren de verdad en el CRM con este lead, pero no se manda nada a Instagram.`}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={() => probar()} cargando={ocupado}>Probar</Boton>
      </>}>
      <form onSubmit={probar} className="space-y-3">
        <div className="text-[12px] font-medium text-[var(--text-secondary)]">¿Qué hace?</div>
        <div className="grid grid-cols-2 gap-1.5">
          {OPCIONES.map((o) => (
            <button key={o.id} type="button" onClick={() => setTipo(o.id)} aria-pressed={tipo === o.id}
              className="ui-foco flex min-h-[44px] items-center gap-2 rounded-xl border px-3 py-2 text-left text-[13px] transition-colors"
              style={tipo === o.id
                ? { borderColor: 'var(--series-1)', background: 'color-mix(in srgb, var(--series-1) 10%, var(--surface-1))', fontWeight: 600 }
                : { borderColor: 'var(--border-hairline)' }}>
              <span aria-hidden>{o.icono}</span>{o.texto}
            </button>
          ))}
        </div>
        {op.pide && (
          <Campo etiqueta={op.pide} htmlFor="probar-texto" ayuda="Escribí la palabra clave de tu automensaje para ver si se dispara.">
            <Entrada id="probar-texto" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Ej. GUIA" maxLength={1000} />
          </Campo>
        )}
      </form>
    </Dialogo>
  );
}
