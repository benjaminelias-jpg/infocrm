import { Insignia } from './Basicos';
import { textoDe, tonoDe } from '../textos';

/**
 * Un estado de la base dicho en palabras y con su color:
 * <Estado tipo="venta" valor="en_cuotas" /> → «En cuotas» (azul).
 * Los textos viven en web/src/textos.ts.
 */
export function Estado({ tipo, valor, punto = true }: { tipo: string; valor: string | null | undefined; punto?: boolean }) {
  return <Insignia tono={tonoDe(tipo, valor)} punto={punto}>{textoDe(tipo, valor)}</Insignia>;
}
