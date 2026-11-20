import { Insignia, type Tono } from '../../ui';

// Una sola señal de calidad del lead, igual en la lista, la tarjeta y la
// ficha: la "temperatura", que sale del puntaje (0-100) que el sistema
// calcula solo con lo que el lead hizo. Reemplaza al número suelto, al
// puntito sin leyenda y a la letra A-D.

export type IdTemperatura = 'frio' | 'tibio' | 'caliente' | 'listo';

export const TEMPERATURAS: Record<IdTemperatura, { etiqueta: string; corta: string; tono: Tono; desde: number; ayuda: string }> = {
  frio: { etiqueta: 'Frío', corta: 'Frío', tono: 'neutro', desde: 0, ayuda: 'Todavía no mostró interés: recién entró o solo pidió el recurso.' },
  tibio: { etiqueta: 'Tibio', corta: 'Tibio', tono: 'amarillo', desde: 25, ayuda: 'Respondió o dejó algún dato. Vale la pena escribirle.' },
  caliente: { etiqueta: 'Caliente', corta: 'Caliente', tono: 'azul', desde: 45, ayuda: 'Conversa, contó de su negocio o agendó. Está avanzando.' },
  listo: { etiqueta: 'Listo para vender', corta: 'Listo', tono: 'verde', desde: 70, ayuda: 'Hizo casi todo el camino: es el momento de cerrar.' },
};

export const ORDEN_TEMPERATURAS: IdTemperatura[] = ['frio', 'tibio', 'caliente', 'listo'];

export function temperaturaDe(score: number | string | null | undefined): IdTemperatura {
  const s = Number(score ?? 0) || 0;
  if (s >= 70) return 'listo';
  if (s >= 45) return 'caliente';
  if (s >= 25) return 'tibio';
  return 'frio';
}

/** Insignia "Caliente · 52". `corta` para tarjetas chicas ("Listo" en vez de "Listo para vender"). */
export function Temperatura({ score, numero = true, corta = false, className = '' }: {
  score: number | string | null | undefined; numero?: boolean; corta?: boolean; className?: string;
}) {
  const t = TEMPERATURAS[temperaturaDe(score)];
  return (
    <Insignia tono={t.tono} punto className={className}>
      {corta ? t.corta : t.etiqueta}
      {numero && <span className="cifras font-normal opacity-75">· {Number(score ?? 0) || 0}</span>}
    </Insignia>
  );
}
