import { useEffect, useState } from 'react';
import { api, plural } from '../api';
import { Boton, useAviso } from '../ui';

// Leads de prueba: un botón para cargar leads falsos (con su recorrido por el
// pipeline, charlas, reuniones y ventas) y ver el CRM andando; y otro para
// borrarlos todos juntos. Lo real no se toca. Solo dueño o admin.

const CLAVE_OCULTO = 'infocrm_prueba_oculto';

export default function FranjaPrueba({ rol }: { rol?: string }) {
  const puede = rol === 'owner' || rol === 'admin';
  const aviso = useAviso();
  const [n, setN] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [oculto, setOculto] = useState(() => { try { return localStorage.getItem(CLAVE_OCULTO) === '1'; } catch { return false; } });

  useEffect(() => {
    if (!puede) return;
    api<{ leads: number }>('/demo').then((r) => setN(r.leads)).catch(() => setN(null));
  }, [puede]);

  if (!puede || n === null) return null;
  if (n === 0 && oculto) return null;

  async function cargar() {
    setOcupado(true);
    try {
      const r = await api<{ creados: number; ventas: number }>('/demo/cargar?leads=30', { method: 'POST' });
      aviso.exito(`Listo: ${plural(r.creados, 'lead de prueba')} y ${plural(r.ventas, 'venta')}. Recargando…`);
      setTimeout(() => window.location.reload(), 900);
    } catch (e: any) {
      aviso.error(e?.message ?? 'No pudimos cargar los leads de prueba.');
      setOcupado(false);
    }
  }
  async function borrar() {
    setOcupado(true);
    try {
      await api('/demo/borrar', { method: 'POST' });
      try { localStorage.setItem(CLAVE_OCULTO, '1'); } catch { /* sin almacenamiento */ }
      aviso.exito('Borramos los datos de prueba. Recargando…');
      setTimeout(() => window.location.reload(), 900);
    } catch (e: any) {
      aviso.error(e?.message ?? 'No pudimos borrar los datos de prueba.');
      setOcupado(false);
    }
  }

  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-[var(--border-hairline)] px-4 py-2 text-[12px] lg:px-8"
      style={{ background: 'var(--surface-1)' }}>
      {n > 0 ? (
        <>
          <span className="text-[var(--text-secondary)]">Estás viendo <b className="text-[var(--text-primary)]">{plural(n, 'lead de prueba', 'leads de prueba')}</b>. Lo tuyo real no se toca.</span>
          <div className="ml-auto flex gap-2">
            <Boton tamano="xs" variante="secundario" onClick={cargar} disabled={ocupado}>Cargar más</Boton>
            <Boton tamano="xs" variante="secundario" onClick={borrar} disabled={ocupado}>Borrar los de prueba</Boton>
          </div>
        </>
      ) : (
        <>
          <span className="text-[var(--text-secondary)]">¿Querés ver cómo funciona todo? Cargá leads falsos que recorren el pipeline, el chat y las ventas.</span>
          <div className="ml-auto flex gap-2">
            <Boton tamano="xs" variante="primario" onClick={cargar} disabled={ocupado}>{ocupado ? 'Cargando…' : 'Cargar leads de prueba'}</Boton>
            <Boton tamano="xs" variante="fantasma" onClick={() => { setOculto(true); try { localStorage.setItem(CLAVE_OCULTO, '1'); } catch { /* */ } }}>Ahora no</Boton>
          </div>
        </>
      )}
    </div>
  );
}
