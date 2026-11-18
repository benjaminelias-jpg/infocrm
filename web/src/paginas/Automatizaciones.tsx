import { useEffect, useState } from 'react';
import { api, fmtNum } from '../api';
import { Cargando, Vacio } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';

export default function Automatizaciones() {
  const [autos, setAutos] = useState<any[]>([]);
  const [contenidos, setContenidos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [aviso, setAviso] = useState<string | null>(null);
  const [reatribuyendo, setReatribuyendo] = useState(false);

  async function cargar() {
    const [a, c] = await Promise.all([
      api<any[]>('/automatizaciones'),
      api<any[]>('/contenidos'),
    ]);
    setAutos(a);
    setContenidos(c);
    setCargando(false);
  }

  useEffect(() => { cargar(); }, []);

  async function enlazar(id: string, contenidoId: string) {
    await api(`/automatizaciones/${id}`, {
      method: 'PATCH',
      json: { contenido_id: contenidoId || null },
    });
    await cargar();
    setAviso(
      'Enlazada. Pulsa "Reatribuir" para recuperar también los leads que ya habían entrado por esta palabra.',
    );
  }

  async function reatribuir() {
    setReatribuyendo(true);
    try {
      const r = await api<any>('/atribucion/reatribuir', { method: 'POST' });
      setAviso(r.mensaje);
      await cargar();
    } finally {
      setReatribuyendo(false);
    }
  }

  const sinEnlazar = autos.filter((a) => !a.contenido_id);
  const palabrasRepetidas = new Map<string, number>();
  for (const a of autos) {
    if (!a.palabra_clave || !a.contenido_id) continue;
    const k = a.palabra_clave.toLowerCase();
    palabrasRepetidas.set(k, (palabrasRepetidas.get(k) ?? 0) + 1);
  }

  if (cargando) return <Cargando />;

  return (
    <div className="px-5 py-5 lg:px-8">
      <Cabecera
        titulo="Automatizaciones"
        subtitulo="El puente entre la palabra que comentan en tu reel y el lead que entra en el CRM"
        derecha={
          <button
            onClick={reatribuir}
            disabled={reatribuyendo}
            className="rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--surface-1)] disabled:opacity-60"
          >
            {reatribuyendo ? 'Reatribuyendo…' : '⟳ Reatribuir leads antiguos'}
          </button>
        }
      />

      {aviso && (
        <div
          className="mt-3 rounded-md px-3 py-2 text-[12px]"
          style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}
        >
          {aviso}
        </div>
      )}

      {sinEnlazar.length > 0 && (
        <div
          className="mt-4 rounded-lg p-3"
          style={{ background: 'var(--page-plane)', border: '1px solid var(--border-hairline)' }}
        >
          <div className="flex items-center gap-1.5 text-[13px] font-medium">
            <span style={{ color: 'var(--status-warning)' }} aria-hidden>⚠</span>
            {sinEnlazar.length} automatizacion{sinEnlazar.length === 1 ? '' : 'es'} sin contenido enlazado
          </div>
          <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
            Los leads que entren por estas palabras no se pueden atribuir a ningún reel. Elige el
            contenido en la tabla de abajo y después pulsa «Reatribuir».
          </p>
        </div>
      )}

      {autos.length === 0 ? (
        <Vacio mensaje="Aún no hay automatizaciones. Se crean solas en cuanto ManyChat manda la primera palabra clave por el webhook." />
      ) : (
        <div className="tarjeta mt-4 overflow-x-auto">
          <table className="w-full min-w-[840px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border-hairline)] text-left text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                <th className="px-4 py-2.5 font-medium">Automatización</th>
                <th className="px-3 py-2.5 font-medium">Palabra</th>
                <th className="px-3 py-2.5 font-medium">Disparo</th>
                <th className="px-3 py-2.5 font-medium">Contenido enlazado</th>
                <th className="px-3 py-2.5 text-right font-medium">Leads</th>
              </tr>
            </thead>
            <tbody>
              {autos.map((a) => {
                const ambigua =
                  a.palabra_clave && (palabrasRepetidas.get(a.palabra_clave.toLowerCase()) ?? 0) > 1;
                return (
                  <tr key={a.id} className="border-b border-[var(--border-hairline)] last:border-0">
                    <td className="px-4 py-2.5">
                      <div className="max-w-[260px] truncate font-medium">{a.nombre}</div>
                      {a.recurso && (
                        <div className="max-w-[260px] truncate text-[11px] text-[var(--text-muted)]">
                          {a.recurso}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {a.palabra_clave && (
                        <span className="flex items-center gap-1.5">
                          <code
                            className="rounded px-1.5 py-0.5 text-[12px]"
                            style={{ background: 'var(--gridline)' }}
                          >
                            {a.palabra_clave}
                          </code>
                          {ambigua && (
                            <span
                              title="Esta palabra está en varios contenidos: la atribución de estos leads es dudosa"
                              style={{ color: 'var(--status-warning)' }}
                              aria-label="Palabra ambigua"
                            >
                              ⚠
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-[var(--text-secondary)]">
                      {a.tipo_disparo}
                    </td>
                    <td className="px-3 py-2.5">
                      <select
                        value={a.contenido_id ?? ''}
                        onChange={(e) => enlazar(a.id, e.target.value)}
                        className="w-full max-w-[280px] rounded-md border bg-transparent px-2 py-1 text-[12px] outline-none"
                        style={{
                          borderColor: a.contenido_id
                            ? 'var(--border-hairline)'
                            : 'var(--status-warning)',
                        }}
                      >
                        <option value="">— sin enlazar —</option>
                        {contenidos.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.titulo}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="cifras px-3 py-2.5 text-right font-medium">{fmtNum(a.leads)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="tarjeta mt-4 p-4">
        <h2 className="text-[14px] font-semibold">Cómo conseguir atribución exacta</h2>
        <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
          En ManyChat la automatización se dispara por palabra, no por post. Si usas la misma palabra
          en varios reels, nadie puede saber de cuál vino el lead: ni este CRM ni ningún otro.
        </p>
        <ul className="mt-3 space-y-1.5 text-[13px] text-[var(--text-secondary)]">
          <li className="flex gap-2">
            <span style={{ color: 'var(--status-good)' }} aria-hidden>✓</span>
            Lo mejor: haz que ManyChat mande el <code className="rounded px-1" style={{ background: 'var(--gridline)' }}>ig_media_id</code> del
            post comentado en el webhook. Es exacto aunque repitas palabra.
          </li>
          <li className="flex gap-2">
            <span style={{ color: 'var(--status-good)' }} aria-hidden>✓</span>
            Alternativa sencilla: una palabra distinta por reel (GUIA1, GUIA2…).
          </li>
          <li className="flex gap-2">
            <span style={{ color: 'var(--status-warning)' }} aria-hidden>⚠</span>
            Si repites palabra, el lead se atribuye al reel publicado más recientemente y queda
            marcado como dudoso. No se tira el dato, pero no te fíes de él para decidir.
          </li>
        </ul>
      </div>
    </div>
  );
}
