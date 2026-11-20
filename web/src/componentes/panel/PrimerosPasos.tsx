import { useNavigate } from 'react-router-dom';
import { fmtFecha, fmtNum, plural } from '../../api';
import { BarraProgreso, Boton, Dialogo, PasosGuiados, type EstadoPaso } from '../../ui';
import { IconoPanel } from './iconos';
import { TIPO_CONTENIDO } from './textos';
import type { EstadoCuenta, Mudo } from './tipos';

// Cuenta nueva: en vez de un muro de ceros, los 4 primeros pasos (el que
// sigue, abierto; los hechos, con ✓). Se va sola cuando entran leads.

export function PrimerosPasos({ estado, onObjetivo }: { estado: EstadoCuenta; onObjetivo: () => void }) {
  const navegar = useNavigate();
  const pasos = [
    {
      titulo: 'Conectá tu Instagram', hecho: estado.instagram_conectado,
      texto: 'Así entran solos los comentarios y los DMs, y les respondés desde el Chat.',
      boton: 'Conectar Instagram', ir: () => navegar('/conexiones?abrir=instagram'),
    },
    {
      titulo: 'Creá tu primer automensaje', hecho: estado.automensajes > 0,
      texto: 'Cuando alguien comenta una palabra en tu reel, le llega tu recurso por DM.',
      boton: 'Crear automensaje', ir: () => navegar('/flujos'),
    },
    {
      titulo: 'Cargá tu curso con su link de pago', hecho: estado.cursos_con_link > 0,
      texto: 'Para vender por DM con un toque y saber cuánto factura cada reel.',
      boton: 'Cargar mi curso', ir: () => navegar('/finanzas?tab=cursos'),
    },
    {
      titulo: 'Poné tu objetivo del mes', hecho: estado.objetivo_mes,
      texto: 'Todos los días te mostramos si vas al ritmo.',
      boton: 'Poner objetivo', ir: onObjetivo,
    },
  ];
  const hechos = pasos.filter((p) => p.hecho).length;
  const actual = pasos.findIndex((p) => !p.hecho);

  return (
    <section className="tarjeta p-4" aria-labelledby="titulo-primeros-pasos">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 id="titulo-primeros-pasos" className="text-[16px] font-semibold">Primeros pasos</h2>
          <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">Con esto listo, tu panel empieza a llenarse solo.</p>
        </div>
        <span className="shrink-0 text-[12px] font-medium text-[var(--text-secondary)]">{hechos} de {pasos.length} listos</span>
      </div>
      <div className="mb-4"><BarraProgreso valor={hechos} meta={pasos.length} alto={6} /></div>
      <PasosGuiados pasos={pasos.map((p, i) => {
        const estadoPaso: EstadoPaso = p.hecho ? 'hecho' : i === actual ? 'actual' : 'pendiente';
        return {
          estado: estadoPaso,
          // Los pendientes también se pueden tocar (no hace falta seguir el orden).
          titulo: estadoPaso === 'pendiente'
            ? <button type="button" onClick={p.ir} className="ui-foco -my-2 inline-flex min-h-[40px] items-center gap-1 rounded text-left hover:text-[var(--text-primary)] md:min-h-[32px]">{p.titulo} <IconoPanel nombre="flecha" tam={13} /></button>
            : p.titulo,
          resumen: p.hecho ? 'Listo' : undefined,
          contenido: (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[12px] leading-snug text-[var(--text-secondary)]">{p.texto}</p>
              <Boton variante="primario" onClick={p.ir}>{p.boton}</Boton>
            </div>
          ),
        };
      })} />
    </section>
  );
}

/** Lista de lo publicado que no trajo ningún lead (desde "Para hoy"). */
export function DialogoMudos({ abierto, onCerrar, mudos, texto }: { abierto: boolean; onCerrar: () => void; mudos: Mudo[]; texto: string }) {
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} autoFoco={false}
      titulo={`${plural(mudos.length, 'publicación', 'publicaciones')} sin ningún lead`}
      descripcion={`Lo que publicaste ${texto} (hace más de 3 días) y no trajo a nadie. Revisá el gancho o el llamado a la acción.`}>
      <ul className="divide-y divide-[var(--border-hairline)] pb-1">
        {mudos.map((c) => {
          const vistas = Number(c.reproducciones ?? 0) || Number(c.alcance ?? 0);
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{c.titulo}</div>
                <div className="text-[12px] text-[var(--text-secondary)]">
                  {TIPO_CONTENIDO[c.tipo] ?? 'Contenido'} · {fmtFecha(c.publicado_en)}{vistas ? ` · ${fmtNum(vistas)} ${c.reproducciones ? 'vistas' : 'de alcance'}` : ''}
                </div>
              </div>
              {c.permalink && (
                <a href={c.permalink} target="_blank" rel="noreferrer"
                  className="ui-foco inline-flex h-10 shrink-0 items-center gap-1 rounded-lg border border-[var(--border-hairline)] px-2.5 text-[12px] font-medium hover:bg-[var(--page-plane)] md:h-9">
                  <IconoPanel nombre="externo" tam={13} /> Ver
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </Dialogo>
  );
}
