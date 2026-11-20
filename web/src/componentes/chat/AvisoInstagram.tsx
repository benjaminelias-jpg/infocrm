import { useNavigate } from 'react-router-dom';
import { Boton } from '../../ui';
import { esDueno, type EstadoIG } from './datos';

// Aviso FIJO cuando Instagram no está conectado (o se cortó): lo que se
// escribe queda guardado en el Chat pero no le llega al lead. Con la acción
// para arreglarlo ahí mismo (o, si no sos el dueño, a quién pedírselo).

export function AvisoInstagram({ estado, compacto }: { estado: EstadoIG | null; compacto?: boolean }) {
  const navegar = useNavigate();
  if (!estado || estado === 'conectado') return null;
  const dueno = esDueno();
  const cortado = estado === 'cortado';
  const titulo = cortado ? 'Se cortó la conexión con Instagram.' : 'Instagram no está conectado.';
  const detalle = dueno
    ? 'Lo que escribas queda guardado acá, pero no le llega al lead.'
    : 'Lo que escribas queda guardado acá, pero no le llega al lead. Pedile al dueño que lo conecte.';
  const accion = dueno && (
    <Boton tamano={compacto ? 'xs' : 'sm'} variante="primario" onClick={() => navegar('/conexiones?abrir=instagram')}>
      {cortado ? 'Reconectar' : compacto ? 'Conectar' : 'Conectar Instagram'}
    </Boton>
  );
  if (compacto) {
    return (
      <div role="status" className="flex items-center gap-2 border-b px-3 py-1.5 text-[12px]"
        style={{ background: 'color-mix(in srgb, var(--status-warning) 14%, var(--page-plane))', borderColor: 'color-mix(in srgb, var(--status-warning) 35%, transparent)' }}>
        <span aria-hidden>⚠️</span>
        <span className="min-w-0 flex-1 truncate"><strong className="font-semibold">{titulo}</strong> No le llega al lead.</span>
        {accion}
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-[13px]"
      style={{ background: 'color-mix(in srgb, var(--status-warning) 12%, var(--page-plane))', borderColor: 'color-mix(in srgb, var(--status-warning) 35%, transparent)' }}>
      <span aria-hidden>⚠️</span>
      <span className="min-w-0 flex-1"><strong className="font-semibold">{titulo}</strong> {detalle}</span>
      {accion}
    </div>
  );
}
