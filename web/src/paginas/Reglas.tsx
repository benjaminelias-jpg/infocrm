import { useEffect, useState } from 'react';
import { api, fmtNum, hace } from '../api';
import { Cargando } from '../componentes/Graficas';
import Cabecera from '../componentes/Cabecera';

const EVENTOS = [
  ['lead_creado', 'Entra un lead'],
  ['recurso_entregado', 'Se entrega el recurso'],
  ['respondio_dm', 'Responde por DM'],
  ['reunion_agendada', 'Agenda reunión'],
  ['reunion_realizada', 'Hace la reunión'],
  ['reunion_no_asistio', 'No se presenta'],
  ['venta', 'Compra'],
  ['reembolso', 'Pide reembolso'],
];

const ACCIONES: Record<string, (a: any) => string> = {
  etiquetar: (a) => `añadir la etiqueta "${a.etiqueta}"`,
  quitar_etiqueta: (a) => `quitar la etiqueta "${a.etiqueta}"`,
  mover_etapa: (a) => `mover a la etapa "${a.etapa_slug ?? a.etapa_id}"`,
  asignar: (a) => (a.usuario_id && a.usuario_id !== 'round_robin'
    ? 'asignar a una persona concreta'
    : 'asignar al closer con menos carga'),
  crear_nota: () => 'dejar una nota en el lead',
  webhook_saliente: (a) => `avisar por webhook a ${a.url || '(sin URL configurada)'}`,
  marcar_perdido: (a) => `marcar como perdido (${a.motivo ?? 'sin motivo'})`,
};

const OPERADORES: Record<string, string> = {
  igual: 'es igual a', distinto: 'no es', contiene: 'contiene',
  no_contiene: 'no contiene', mayor_que: 'es mayor que', menor_que: 'es menor que',
  existe: 'tiene valor', no_existe: 'está vacío', empieza_por: 'empieza por',
};

function describir(regla: any) {
  const evento = EVENTOS.find(([v]) => v === regla.disparador?.evento)?.[1]
    ?? regla.disparador?.evento;
  const acciones = (regla.acciones ?? [])
    .map((a: any) => ACCIONES[a.tipo]?.(a) ?? a.tipo)
    .join(', y ');
  const condiciones = (regla.condiciones ?? [])
    .map((c: any) => `${c.campo} ${OPERADORES[c.operador] ?? c.operador}${c.valor !== undefined ? ` ${c.valor}` : ''}`)
    .join(' y ');

  return { evento, acciones, condiciones };
}

export default function Reglas() {
  const [reglas, setReglas] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  async function cargar() {
    setReglas(await api<any[]>('/reglas'));
    setCargando(false);
  }

  useEffect(() => { cargar(); }, []);

  async function alternar(regla: any) {
    await api(`/reglas/${regla.id}`, { method: 'PATCH', json: { activo: !regla.activo } });
    await cargar();
  }

  if (cargando) return <Cargando />;

  return (
    <div className="px-5 py-5 lg:px-8">
      <Cabecera
        titulo="Reglas"
        subtitulo="Qué hace el CRM solo cuando pasa algo. Las etapas ya se mueven solas; esto es todo lo demás."
      />

      <div className="mt-5 space-y-2">
        {reglas.map((r) => {
          const d = describir(r);
          return (
            <article key={r.id} className="tarjeta p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: r.activo ? 'var(--status-good)' : 'var(--baseline)' }}
                      aria-hidden
                    />
                    <h2 className="text-[14px] font-medium">{r.nombre}</h2>
                    {!r.activo && (
                      <span className="text-[11px] text-[var(--text-muted)]">desactivada</span>
                    )}
                  </div>

                  {r.descripcion && (
                    <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{r.descripcion}</p>
                  )}

                  <p className="mt-2 text-[13px]">
                    <span className="text-[var(--text-muted)]">Cuando </span>
                    <span className="font-medium">{d.evento}</span>
                    {d.condiciones && (
                      <>
                        <span className="text-[var(--text-muted)]"> y </span>
                        <span className="font-medium">{d.condiciones}</span>
                      </>
                    )}
                    <span className="text-[var(--text-muted)]">, entonces </span>
                    <span className="font-medium">{d.acciones}</span>
                    <span className="text-[var(--text-muted)]">.</span>
                  </p>

                  <div className="cifras mt-2 flex flex-wrap gap-x-4 text-[11px] text-[var(--text-muted)]">
                    <span>{fmtNum(r.ejecuciones_ok)} ejecuciones</span>
                    {Number(r.ejecuciones_error) > 0 && (
                      <span style={{ color: 'var(--status-critical)' }}>
                        {fmtNum(r.ejecuciones_error)} con error
                      </span>
                    )}
                    {r.ultima_ejecucion_en && <span>última {hace(r.ultima_ejecucion_en)}</span>}
                  </div>
                </div>

                <button
                  onClick={() => alternar(r)}
                  className="shrink-0 rounded-md border border-[var(--border-hairline)] px-3 py-1.5 text-[12px] hover:bg-[var(--page-plane)]"
                >
                  {r.activo ? 'Desactivar' : 'Activar'}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <div className="tarjeta mt-5 p-4">
        <h2 className="text-[14px] font-semibold">Qué se mueve solo sin tocar nada</h2>
        <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
          El recorrido por el embudo no depende de estas reglas: cada etapa tiene asociado un tipo
          de evento, y cuando llega ese webhook la oportunidad se mueve sola. Agendar lleva a
          «Reunión agendada», una venta cierra la oportunidad en «Venta». Las reglas de arriba son
          para lo de más: etiquetar, asignar, avisar fuera.
        </p>
      </div>
    </div>
  );
}
