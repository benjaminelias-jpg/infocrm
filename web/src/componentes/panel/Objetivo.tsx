import { useEffect, useRef, useState } from 'react';
import { api, fmtDinero, fmtNum, monedaCuenta, plural } from '../../api';
import { Ayuda, BarraProgreso, Boton, BotonIcono, Campo, Dialogo, Entrada, useAviso } from '../../ui';
import { IconoPanel } from './iconos';
import type { EstadoCuenta, Metas } from './tipos';

// Objetivo del mes: con "+" para ponerlo donde se ve (antes no había forma),
// lápiz para editarlo, la marca de "dónde deberías estar hoy" en cada barra
// y una proyección: a este ritmo, ¿llegás?

/** Qué parte del mes ya pasó (0..1) y cuántos días faltan para el cierre. */
export function ritmoDelMes(ahora = new Date()) {
  const ini = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
  const fin = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 1);
  const fraccion = Math.min(1, Math.max(0, (ahora.getTime() - ini.getTime()) / (fin.getTime() - ini.getTime())));
  const diasRestantes = Math.max(0, Math.ceil((fin.getTime() - ahora.getTime()) / 86_400_000));
  const mes = ahora.toLocaleDateString('es-ES', { month: 'long' });
  return { fraccion, diasRestantes, mes };
}

type Clave = 'leads' | 'calificados' | 'ventas' | 'ingresos';
const METRICAS: Array<{ k: Clave; etiqueta: string; dinero?: boolean }> = [
  { k: 'leads', etiqueta: 'Leads' },
  { k: 'calificados', etiqueta: 'Calificados' },
  { k: 'ventas', etiqueta: 'Ventas' },
  { k: 'ingresos', etiqueta: 'Ingresos', dinero: true },
];

/** 24.576 € → "24,6 mil €" (desde 10.000); menos, completo. */
function dineroCorto(n: number) {
  if (Math.abs(n) < 10_000) return fmtDinero(n);
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: monedaCuenta(), notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch { return fmtDinero(n); }
}

/** "45.000", "45000", "45.000,50", "45.000 €" → número. Vacío → 0. Con letras ("abc", "12k") → NaN. */
function leerNumero(s: string): number {
  const texto = String(s ?? '').trim();
  if (!texto) return 0;
  // Se aceptan espacios y el símbolo de la moneda; cualquier otra cosa no es un número
  // (antes "abc" se leía como 0 y borraba ese objetivo sin avisar).
  const limpio = texto.replace(/[\s€$]|EUR|USD|ARS|MXN|COP|CLP/gi, '');
  if (!/^-?[\d.,]+$/.test(limpio) || !/\d/.test(limpio)) return NaN;
  const normal = limpio.includes(',') ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/\.(?=\d{3}(\D|$))/g, '');
  const v = Number(normal);
  return Number.isFinite(v) ? v : NaN;
}

export function ObjetivoMes({ metas, estado, editando, onEditar, onCerrar, onGuardado }: {
  metas: Metas | undefined; estado: EstadoCuenta | null;
  editando: boolean; onEditar: () => void; onCerrar: () => void; onGuardado: () => void;
}) {
  const { fraccion, diasRestantes, mes } = ritmoDelMes();
  const tiene = Boolean(metas?.tiene_meta && metas.objetivo);

  return (
    <section id="objetivo-mes" className="scroll-mt-20" aria-label="Objetivo del mes">
      {tiene ? (
        <div className="tarjeta p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-[15px] font-semibold">Objetivo de {mes}</h2>
              <Ayuda titulo="Objetivo del mes">
                Cuenta lo que entró desde el 1 de {mes}. La rayita marca dónde deberías estar hoy para llegar al objetivo:
                verde si vas al ritmo, amarillo si un poco atrás y rojo si bastante atrás.
              </Ayuda>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="text-[12px] text-[var(--text-secondary)]">
                {diasRestantes > 0 ? `${diasRestantes === 1 ? 'Falta' : 'Faltan'} ${plural(diasRestantes, 'día', 'días')}` : 'Último día'}
              </span>
              <BotonIcono etiqueta="Editar objetivo" tamano="md" onClick={onEditar}><IconoPanel nombre="lapiz" tam={15} /></BotonIcono>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-4 lg:grid-cols-4">
            {METRICAS.filter((m) => Number(metas!.objetivo![m.k] ?? 0) > 0).map((m) => {
              const objetivo = Number(metas!.objetivo![m.k]);
              const real = Number(metas!.real?.[m.k] ?? 0);
              const fmt = m.dinero ? (n: number) => fmtDinero(n) : (n: number) => fmtNum(n);
              // En la barra, la plata en corto ("24,6 mil €") para que la etiqueta no se corte en el celular.
              const corto = m.dinero ? dineroCorto : fmt;
              const cumplido = real >= objetivo;
              const proyeccion = fraccion > 0.04 ? real / fraccion : null;
              const porDia = diasRestantes > 0 ? Math.ceil((objetivo - real) / diasRestantes) : null;
              return (
                <div key={m.k} className="min-w-0">
                  <div className="text-[12px] text-[var(--text-secondary)]">{m.etiqueta}</div>
                  <div className="mb-1.5 truncate text-[13px] text-[var(--text-secondary)]">
                    <b className="text-[16px] font-semibold text-[var(--text-primary)]">{corto(real)}</b> / {corto(objetivo)}
                  </div>
                  <BarraProgreso valor={real} meta={objetivo} ritmo={fraccion} />
                  <p className="mt-1.5 text-[12px] leading-snug text-[var(--text-secondary)]">
                    {cumplido
                      ? <span style={{ color: 'color-mix(in srgb, var(--status-good) 72%, var(--text-primary))' }}>✓ Cumplido</span>
                      : <>
                        {proyeccion !== null && <span className="block">A este ritmo: ~{fmt(Math.round(proyeccion))}</span>}
                        {porDia !== null && porDia > 0 && <span className="block">Necesitás {fmt(porDia)} por día</span>}
                      </>}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-[var(--baseline)] px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ background: 'color-mix(in srgb, var(--series-1) 12%, transparent)', color: 'var(--series-1)' }}>
            <IconoPanel nombre="objetivo" tam={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold">Objetivo de {mes}</h2>
              <button type="button" onClick={onEditar} aria-label="Poner el objetivo del mes"
                className="ui-foco flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[18px] font-medium text-white shadow-sm hover:brightness-110 md:h-9 md:w-9"
                style={{ background: 'var(--accion)' }}>+</button>
            </div>
            <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">Poné cuántos leads, ventas e ingresos querés este mes y te mostramos todos los días si vas al ritmo.</p>
          </div>
        </div>
      )}

      <DialogoObjetivo abierto={editando} onCerrar={onCerrar} metas={metas} estado={estado} mes={mes}
        onGuardado={() => { onCerrar(); onGuardado(); }} />
    </section>
  );
}

export function DialogoObjetivo({ abierto, onCerrar, metas, estado, mes, onGuardado }: {
  abierto: boolean; onCerrar: () => void; metas: Metas | undefined; estado: EstadoCuenta | null; mes: string;
  onGuardado: () => void;
}) {
  const aviso = useAviso();
  const [valores, setValores] = useState<Record<Clave, string>>({ leads: '', calificados: '', ventas: '', ingresos: '' });
  const [errores, setErrores] = useState<Partial<Record<Clave, string>>>({});
  const [guardando, setGuardando] = useState(false);

  // Al abrir (solo en ese momento: si el Panel se actualiza de fondo no se
  // pisa lo que la persona está escribiendo): lo que ya tenía, o lo del mes
  // pasado + 10 % (redondeado lindo).
  const yaAbierto = useRef(false);
  useEffect(() => {
    if (!abierto) { yaAbierto.current = false; return; }
    if (yaAbierto.current) return;
    yaAbierto.current = true;
    const base = metas?.tiene_meta && metas.objetivo ? metas.objetivo : estado?.sugerido;
    setValores({
      leads: base?.leads ? fmtNum(base.leads) : '',
      calificados: base?.calificados ? fmtNum(base.calificados) : '',
      ventas: base?.ventas ? fmtNum(base.ventas) : '',
      ingresos: base?.ingresos ? fmtNum(base.ingresos) : '',
    });
    setErrores({});
  }, [abierto, metas, estado]);

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    const nums = {} as Record<Clave, number>;
    const errs: Partial<Record<Clave, string>> = {};
    for (const m of METRICAS) {
      const v = leerNumero(valores[m.k]);
      if (Number.isNaN(v) || v < 0) errs[m.k] = 'Escribí un número (o dejalo vacío)';
      else nums[m.k] = m.dinero ? Math.round(v * 100) / 100 : Math.round(v);
    }
    setErrores(errs);
    if (Object.keys(errs).length) return;
    if (!nums.leads && !nums.calificados && !nums.ventas && !nums.ingresos) {
      setErrores({ leads: 'Poné al menos un número' });
      return;
    }
    setGuardando(true);
    try {
      await api('/metas', {
        method: 'PUT',
        json: { leads_meta: nums.leads, calificados_meta: nums.calificados, ventas_meta: nums.ventas, ingresos_meta: nums.ingresos },
      });
      aviso.exito(`Objetivo de ${mes} guardado`);
      onGuardado();
    } catch (err: any) {
      aviso.error(err?.message ?? 'No pudimos guardar el objetivo');
    } finally {
      setGuardando(false);
    }
  }

  const tiene = Boolean(metas?.tiene_meta);
  // "Precargado con lo del mes pasado" solo si de verdad hay algo precargado
  // (en una cuenta nueva el mes pasado está en cero y los campos vienen vacíos).
  const haySugerido = Boolean(estado && Object.values(estado.sugerido ?? {}).some((v) => Number(v) > 0));
  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo={tiene ? `Editar el objetivo de ${mes}` : `Objetivo de ${mes}`}
      descripcion={tiene ? undefined : haySugerido
        ? 'Te lo dejamos precargado con lo del mes pasado + 10 %. Cambialo como quieras.'
        : 'Poné cuánto querés lograr este mes. Lo que no quieras medir, dejalo vacío.'}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" cargando={guardando} onClick={() => guardar()}>Guardar objetivo</Boton>
      </>}>
      <form onSubmit={guardar} className="grid grid-cols-2 gap-3" noValidate>
        {METRICAS.map((m) => (
          <Campo key={m.k} etiqueta={m.etiqueta} htmlFor={`objetivo-${m.k}`} error={errores[m.k]}
            ayuda={estado && Number(estado.mes_pasado?.[m.k] ?? 0) > 0 ? `El mes pasado: ${m.dinero ? fmtDinero(estado.mes_pasado[m.k]) : fmtNum(estado.mes_pasado[m.k])}` : undefined}>
            <Entrada id={`objetivo-${m.k}`} inputMode={m.dinero ? 'decimal' : 'numeric'} autoComplete="off"
              value={valores[m.k]} invalido={Boolean(errores[m.k])} placeholder="0"
              onChange={(e) => setValores((v) => ({ ...v, [m.k]: e.target.value }))} />
          </Campo>
        ))}
        {/* Enter en cualquier campo guarda */}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Dialogo>
  );
}
