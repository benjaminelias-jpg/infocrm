import { useEffect, useState } from 'react';
import { api, fmtDinero } from '../../api';
import { Boton, Campo, Chip, Dialogo, Entrada, FilaChips, Interruptor, Seleccion, useAviso } from '../../ui';

// Diálogos del tablero al soltar una tarjeta en una etapa de cierre:
//  - Venta: registra la venta de verdad (Finanzas + Panel + reglas) y la mueve.
//  - Perdido: pregunta por qué (para aprender de las pérdidas) y la mueve.

export function DialogoVenta({ tarjeta, etapa, onCerrar, onListo }: {
  tarjeta: any; etapa: { id: string; nombre: string };
  onCerrar: () => void;
  /** registrada=false → "Solo moverlo". */
  onListo: (registrada: boolean, texto: string) => Promise<void> | void;
}) {
  const aviso = useAviso();
  const [productos, setProductos] = useState<any[]>([]);
  const [metodos, setMetodos] = useState<any[]>([]);
  const [productoId, setProductoId] = useState('');
  const [metodoId, setMetodoId] = useState('');
  const [monto, setMonto] = useState(Number(tarjeta.valor) > 0 ? String(Math.round(Number(tarjeta.valor))) : '');
  const [cuotas, setCuotas] = useState(false);
  const [numCuotas, setNumCuotas] = useState('3');
  const [ocupado, setOcupado] = useState<'venta' | 'mover' | null>(null);
  const quien = tarjeta.ig_username ? `@${tarjeta.ig_username}` : tarjeta.nombre || 'este lead';

  useEffect(() => {
    api<any[]>('/productos').then((p) => setProductos(p.filter((x) => x.activo !== false))).catch(() => {});
    api<any[]>('/metodos-pago').then((m) => setMetodos(m.filter((x) => x.activo !== false))).catch(() => {});
  }, []);

  function elegirProducto(id: string) {
    setProductoId(id);
    const p = productos.find((x) => x.id === id);
    if (p && Number(p.precio_lista) > 0 && !monto) setMonto(String(Math.round(Number(p.precio_lista))));
  }

  const importe = Number(String(monto).replace(/\./g, '').replace(',', '.'));
  const valido = importe > 0 && (!cuotas || Number(numCuotas) >= 2);

  async function registrar() {
    if (!valido) return;
    setOcupado('venta');
    try {
      await api('/ventas/registrar', {
        method: 'POST',
        json: {
          lead_id: tarjeta.lead_id, precio_acordado: importe,
          producto_id: productoId || undefined, metodo_pago_id: metodoId || undefined,
          tipo_cobro: cuotas ? 'cuotas' : 'unico', num_cuotas: cuotas ? Number(numCuotas) : 1,
        },
      });
      await api(`/oportunidades/${tarjeta.oportunidad_id}/etapa`, { method: 'POST', json: { etapa_id: etapa.id } });
      await onListo(true, `¡Venta de ${quien} por ${fmtDinero(importe)}! Ya está en Finanzas y en el Panel.`);
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(null); }
  }

  async function soloMover() {
    setOcupado('mover');
    try {
      await api(`/oportunidades/${tarjeta.oportunidad_id}/etapa`, { method: 'POST', json: { etapa_id: etapa.id } });
      await onListo(false, `${quien} pasó a «${etapa.nombre}» (sin registrar la venta).`);
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(null); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={`🎉 ¡Venta de ${quien}!`} ancho={480}
      descripcion="Registrala y queda en Finanzas, en el Panel y dispara tus reglas de compra."
      pie={<>
        <Boton variante="fantasma" onClick={soloMover} cargando={ocupado === 'mover'}>Solo moverlo</Boton>
        <Boton variante="primario" onClick={registrar} cargando={ocupado === 'venta'} disabled={!valido}>Registrar venta</Boton>
      </>}>
      <div className="space-y-3">
        <Campo etiqueta="Monto" htmlFor="venta-monto" error={monto && !(importe > 0) ? 'Escribí un monto mayor a 0' : undefined}>
          <Entrada id="venta-monto" value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d.,]/g, ''))}
            inputMode="decimal" placeholder="Ej.: 997" autoFocus />
        </Campo>
        {productos.length > 0 && (
          <Campo etiqueta="Curso o programa" htmlFor="venta-producto">
            <Seleccion id="venta-producto" value={productoId} onChange={(e) => elegirProducto(e.target.value)}>
              <option value="">Sin elegir</option>
              {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </Seleccion>
          </Campo>
        )}
        {metodos.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">¿Cómo pagó?</div>
            <FilaChips>
              {metodos.map((m) => <Chip key={m.id} activo={metodoId === m.id} onClick={() => setMetodoId(metodoId === m.id ? '' : m.id)}>{m.nombre}</Chip>)}
            </FilaChips>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Interruptor activo={cuotas} onCambiar={setCuotas} etiqueta="En cuotas" />
          {cuotas && (
            <span className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
              <Entrada value={numCuotas} onChange={(e) => setNumCuotas(e.target.value.replace(/\D/g, '').slice(0, 2))}
                inputMode="numeric" className="!w-16 text-center" aria-label="Cantidad de cuotas" /> cuotas
            </span>
          )}
        </div>
      </div>
    </Dialogo>
  );
}

const MOTIVOS = ['No le interesa', 'No califica', 'Le pareció caro', 'Dejó de responder', 'Eligió otra opción', 'No era el momento'];

export function DialogoPerdido({ tarjeta, etapa, onCerrar, onListo }: {
  tarjeta: any; etapa: { id: string; nombre: string };
  onCerrar: () => void; onListo: (texto: string) => Promise<void> | void;
}) {
  const aviso = useAviso();
  const [motivo, setMotivo] = useState('');
  const [otro, setOtro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const quien = tarjeta.ig_username ? `@${tarjeta.ig_username}` : tarjeta.nombre || 'este lead';
  const final = motivo === 'Otro' ? otro.trim() : motivo;

  async function guardar() {
    setOcupado(true);
    try {
      await api('/ux/pipeline/perdido', { method: 'POST', json: { oportunidad_id: tarjeta.oportunidad_id, etapa_id: etapa.id, motivo: final || undefined } });
      await onListo(`${quien} pasó a «${etapa.nombre}»${final ? ` · motivo: ${final.toLowerCase()}` : ''}.`);
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={`¿Por qué se perdió ${quien}?`} ancho={460} autoFoco={false}
      descripcion="Así ves después qué frena tus ventas. Es opcional."
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={guardar} cargando={ocupado}>Pasar a «{etapa.nombre}»</Boton>
      </>}>
      <div className="space-y-3">
        <FilaChips>
          {[...MOTIVOS, 'Otro'].map((m) => <Chip key={m} activo={motivo === m} onClick={() => setMotivo(motivo === m ? '' : m)}>{m}</Chip>)}
        </FilaChips>
        {motivo === 'Otro' && (
          <Entrada value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="Contalo en pocas palabras" autoFocus maxLength={200} />
        )}
      </div>
    </Dialogo>
  );
}
