import { useState } from 'react';
import { api, fmtDinero, plural } from '../../api';
import { textoDe } from '../../textos';
import {
  Banner, Boton, BotonIcono, Campo, Chip, Desplegable, Dialogo, Entrada, ErrorCarga, Esqueleto, FilaChips, Insignia, ItemMenu,
  SeparadorMenu, TituloSeccion, Vacio, useAviso, useCarga,
} from '../../ui';
import Icono from '../Iconos';
import { EntradaPorcentaje, MenuPuntos, ejemploPct, parseMonto, pctTexto, usePeriodo } from './comun';
import type { Metodo, PropsPestana, RespMetodos } from './tipos';

// Cómo te pagan: cada método con su comisión (se toca el % para cambiarlo,
// con el ejemplo en vivo), cuánto cobraste con cada uno y cuánto se llevó.
// Si entraron cobros de Stripe/Hotmart sin un método con ese nombre, se
// ofrece cargarlo y aplicarle la comisión a esos cobros.

const TIPOS = ['pasarela', 'transferencia', 'tarjeta', 'billetera', 'efectivo', 'crypto', 'otro'];
/** Comisiones típicas (aproximadas, se pueden cambiar). */
const SUGERIDOS: Array<{ nombre: string; tipo: string; pct: number }> = [
  { nombre: 'Stripe', tipo: 'pasarela', pct: 2.9 },
  { nombre: 'PayPal', tipo: 'pasarela', pct: 5.4 },
  { nombre: 'Mercado Pago', tipo: 'pasarela', pct: 6.3 },
  { nombre: 'Hotmart', tipo: 'pasarela', pct: 9.9 },
  { nombre: 'Transferencia', tipo: 'transferencia', pct: 0 },
];
const sugeridoPara = (nombre: string) => SUGERIDOS.find((s) => s.nombre.toLowerCase() === nombre.toLowerCase());
const pctEnCampo = (n: number) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: false }).format(n);

export default function Metodos({ version, onCambio, nuevo }: PropsPestana) {
  const aviso = useAviso();
  const [periodo] = usePeriodo();
  const carga = useCarga(() => api<RespMetodos>(`/ux/finanzas/metodos?periodo=${periodo}`), [periodo, version]);
  const [dialogo, setDialogo] = useState<Metodo | { nombre: string; tipo: string; pct: number; aplicar?: boolean } | 'nuevo' | null>(nuevo ? 'nuevo' : null);
  const [borrando, setBorrando] = useState<Metodo | null>(null);
  const d = carga.datos;
  const activos = d?.metodos.filter((m) => m.activo) ?? [];
  const archivados = d?.metodos.filter((m) => !m.activo) ?? [];
  const faltan = SUGERIDOS.filter((s) => !d?.metodos.some((m) => m.nombre.toLowerCase() === s.nombre.toLowerCase()));

  async function aplicar(m: { id: string; nombre: string }) {
    try {
      const r = await api<{ actualizados: number }>(`/ux/finanzas/metodos/${m.id}/aplicar`, { method: 'POST' });
      if (r.actualizados > 0) aviso.exito(`Listo: ${plural(r.actualizados, 'cobro', 'cobros')} de ${m.nombre} ya tienen su comisión.`);
      carga.recargar(true); onCambio();
    } catch (e: any) { aviso.error(e.message); }
  }

  async function crearRapido(s: { nombre: string; tipo: string; pct: number }) {
    try {
      const m = await api<Metodo>('/metodos-pago', { method: 'POST', json: { nombre: s.nombre, tipo: s.tipo, comision_pct: s.pct } });
      aviso.exito(`${s.nombre} agregado (${pctTexto(s.pct)}). Tocá el % si te cobra otra cosa.`);
      await aplicar(m);
    } catch (e: any) { aviso.error(e.message); }
  }

  async function patch(m: Metodo, datos: Record<string, any>, texto: string, deshacer?: Record<string, any>) {
    try {
      await api(`/metodos-pago/${m.id}`, { method: 'PATCH', json: datos });
      carga.recargar(true); onCambio();
      aviso.exito(texto, deshacer ? { texto: 'Deshacer', onClick: () => patch(m, deshacer, 'Listo, como estaba') } : undefined);
    } catch (e: any) { aviso.error(e.message); }
  }

  const fila = (m: Metodo) => (
    <FilaMetodo key={m.id} m={m} texto={d?.periodo.texto ?? ''}
      onPct={(pct) => patch(m, { comision_pct: pct }, `Comisión de ${m.nombre}: ${pctTexto(pct)}. Se aplica a las ventas nuevas.`)}
      onAplicar={() => aplicar(m)} onEditar={() => setDialogo(m)}
      onArchivar={() => patch(m, { activo: false }, `${m.nombre} archivado: ya no aparece al vender`, { activo: true })}
      onRestaurar={() => patch(m, { activo: true }, `${m.nombre} vuelve a aparecer al vender`)}
      onBorrar={() => setBorrando(m)} />
  );

  return (
    <section className="space-y-3" aria-label="Cómo te pagan">
      <TituloSeccion titulo="Cómo te pagan" onMas={() => setDialogo('nuevo')} textoMas="Agregar cómo te pagan"
        subtitulo="Al registrar una venta elegís cómo te pagó y la app descuenta sola la comisión." />

      {d?.sin_metodo.map((s) => (
        <Banner key={s.nombre} tono="aviso"
          accion={<Boton tamano="sm" variante="primario" onClick={() => setDialogo({ nombre: s.nombre, tipo: 'pasarela', pct: sugeridoPara(s.nombre)?.pct ?? 0, aplicar: true })}>Agregar {s.nombre}</Boton>}>
          Te entraron {plural(s.cobros, 'cobro', 'cobros')} por {s.nombre} ({fmtDinero(s.total)}) y no sabemos cuánto te cobra.
        </Banner>
      ))}

      {carga.error && !d ? (
        <div className="tarjeta"><ErrorCarga error={carga.error} titulo="No pudimos cargar cómo te pagan" onReintentar={() => carga.recargar()} /></div>
      ) : !d ? (
        <div className="space-y-2" aria-busy="true" aria-label="Cargando">{[0, 1, 2].map((i) => <Esqueleto key={i} alto={64} className="rounded-xl" />)}</div>
      ) : d.metodos.length === 0 ? (
        <div className="tarjeta">
          <Vacio icono="💳" titulo="Contanos cómo te pagan"
            texto="Elegí los que usás (con su comisión típica; la cambiás cuando quieras) o agregá otro con el +."
            accion={<div className="flex max-w-full flex-wrap justify-center gap-2">
              {/* En varias líneas: en el celular una fila que se desliza haría correr la pantalla de costado. */}
              {SUGERIDOS.map((s) => <Chip key={s.nombre} onClick={() => crearRapido(s)} icono={<Icono nombre="mas" tam={13} />}>{s.nombre} · {pctTexto(s.pct)}</Chip>)}
            </div>} />
        </div>
      ) : (
        <>
          {activos.length > 0 && <div role="list" className="tarjeta divide-y divide-[var(--border-hairline)]">{activos.map(fila)}</div>}
          {faltan.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] text-[var(--text-muted)]">Agregar con un toque:</div>
              <FilaChips>
                {faltan.map((s) => <Chip key={s.nombre} onClick={() => crearRapido(s)} icono={<Icono nombre="mas" tam={13} />}>{s.nombre} · {pctTexto(s.pct)}</Chip>)}
              </FilaChips>
            </div>
          )}
          {archivados.length > 0 && (
            <Desplegable clave="fin-metodos-archivados" titulo={`Archivados (${archivados.length})`} subtitulo="No aparecen al vender">
              <div role="list" className="-mx-3.5 -mb-3.5 divide-y divide-[var(--border-hairline)] border-t border-[var(--border-hairline)]">{archivados.map(fila)}</div>
            </Desplegable>
          )}
        </>
      )}

      {dialogo && <DialogoMetodo inicial={dialogo === 'nuevo' ? null : dialogo} onCerrar={() => setDialogo(null)}
        onListo={async (m, texto, aplicarDespues) => {
          setDialogo(null); aviso.exito(texto);
          if (aplicarDespues) await aplicar(m); else { carga.recargar(true); onCambio(); }
        }} />}
      {borrando && (
        <Dialogo abierto onCerrar={() => setBorrando(null)} titulo={`¿Borrar ${borrando.nombre}?`} autoFoco={false}
          descripcion="Nunca se usó, así que no se pierde nada. No se puede deshacer."
          pie={<>
            <Boton variante="fantasma" onClick={() => setBorrando(null)}>Cancelar</Boton>
            <Boton variante="peligro" onClick={async () => {
              const m = borrando;
              try { await api(`/metodos-pago/${m.id}`, { method: 'DELETE' }); setBorrando(null); carga.recargar(true); aviso.exito(`${m.nombre} borrado`); } catch (e: any) { aviso.error(e.message); }
            }}>Borrar</Boton>
          </>} />
      )}
    </section>
  );
}

function FilaMetodo({ m, texto, onPct, onAplicar, onEditar, onArchivar, onRestaurar, onBorrar }: {
  m: Metodo; texto: string; onPct: (pct: number) => void; onAplicar: () => void; onEditar: () => void;
  onArchivar: () => void; onRestaurar: () => void; onBorrar: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [pct, setPct] = useState(pctEnCampo(Number(m.comision_pct)));
  const n = parseMonto(pct);
  const ok = Number.isFinite(n) && n >= 0 && n <= 100;
  return (
    <div role="listitem" className="px-3.5 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[14px] font-medium ${m.activo ? '' : 'text-[var(--text-secondary)]'}`}>{m.nombre}</span>
            <Insignia>{textoDe('metodo', m.tipo)}</Insignia>
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--text-muted)] first-letter:uppercase">
            {Number(m.cobrado) > 0 ? `${texto}: ${fmtDinero(m.cobrado)} cobrados · ${fmtDinero(m.comision)} de comisión` : m.usos ? `Sin cobros ${texto}` : 'Todavía no se usó'}
          </div>
        </div>
        {!editando && (
          <button type="button" onClick={() => setEditando(true)} aria-label={`Comisión de ${m.nombre}: ${pctTexto(m.comision_pct)}. Cambiar`}
            className="ui-foco cifras h-9 shrink-0 rounded-lg border border-[var(--border-hairline)] px-3 text-[13px] font-semibold hover:bg-[var(--page-plane)]">
            {pctTexto(m.comision_pct)}
          </button>
        )}
        <MenuPuntos etiqueta={`Más opciones de ${m.nombre}`}>
          <ItemMenu onClick={onEditar}>Editar</ItemMenu>
          {m.activo ? <ItemMenu onClick={onArchivar} descripcion="Deja de aparecer al vender">Archivar</ItemMenu> : <ItemMenu onClick={onRestaurar}>Restaurar</ItemMenu>}
          {m.usos === 0 && <><SeparadorMenu /><ItemMenu peligro onClick={onBorrar}>Borrar</ItemMenu></>}
        </MenuPuntos>
      </div>
      {editando && (
        <form noValidate className="mt-2.5 flex flex-wrap items-start gap-2" onSubmit={(e) => { e.preventDefault(); if (ok) { onPct(n); setEditando(false); } }}>
          <Campo ayuda={ok ? ejemploPct(n, 'te cobra') : undefined} error={!ok ? 'Un número entre 0 y 100' : undefined}>
            <EntradaPorcentaje valor={pct} onCambiar={setPct} autoFocus ancho={110} etiqueta={`Comisión de ${m.nombre}`} />
          </Campo>
          <Boton variante="primario" type="submit" disabled={!ok}>Guardar</Boton>
          <BotonIcono etiqueta="Cancelar" tamano="md" onClick={() => { setEditando(false); setPct(pctEnCampo(Number(m.comision_pct))); }}><Icono nombre="cerrar" tam={16} /></BotonIcono>
        </form>
      )}
      {m.activo && m.sin_comision > 0 && Number(m.comision_pct) > 0 && !editando && (
        <button type="button" onClick={onAplicar} className="ui-foco mt-1.5 rounded text-[12px] font-medium text-[var(--series-1)] hover:underline">
          Aplicar {pctTexto(m.comision_pct)} a {plural(m.sin_comision, 'cobro anterior', 'cobros anteriores')} sin comisión
        </button>
      )}
    </div>
  );
}

function DialogoMetodo({ inicial, onCerrar, onListo }: {
  inicial: Metodo | { nombre: string; tipo: string; pct: number; aplicar?: boolean } | null; onCerrar: () => void;
  onListo: (m: { id: string; nombre: string }, texto: string, aplicar: boolean) => void;
}) {
  const aviso = useAviso();
  const existente = inicial && 'id' in inicial ? inicial : null;
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [tipo, setTipo] = useState(inicial?.tipo ?? 'pasarela');
  const [pct, setPct] = useState(inicial ? pctEnCampo(Number('id' in inicial ? inicial.comision_pct : inicial.pct)) : '');
  const [tocado, setTocado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const n = pct.trim() ? parseMonto(pct) : 0;
  const ok = nombre.trim().length > 0 && Number.isFinite(n) && n >= 0 && n <= 100;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setTocado(true);
    if (!ok) return;
    setOcupado(true);
    try {
      const datos = { nombre: nombre.trim(), tipo, comision_pct: n };
      if (existente) {
        await api(`/metodos-pago/${existente.id}`, { method: 'PATCH', json: datos });
        onListo(existente, `${datos.nombre} actualizado`, false);
      } else {
        const m = await api<Metodo>('/metodos-pago', { method: 'POST', json: datos });
        onListo(m, `${datos.nombre} agregado (${pctTexto(n)})`, true);
      }
    } catch (err: any) { aviso.error(err.message); } finally { setOcupado(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={existente ? `Editar ${existente.nombre}` : 'Agregar cómo te pagan'} ancho={440}
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" type="submit" form="form-metodo" cargando={ocupado} disabled={tocado && !ok}>{existente ? 'Guardar' : 'Agregar'}</Boton>
      </>}>
      <form noValidate id="form-metodo" onSubmit={guardar} className="space-y-3.5">
        <Campo etiqueta="Nombre" htmlFor="metodo-nombre" error={tocado && !nombre.trim() ? 'Poné el nombre' : undefined}>
          <Entrada id="metodo-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Stripe, PayPal, transferencia…" maxLength={80} />
        </Campo>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Tipo</div>
          <FilaChips>{TIPOS.map((t) => <Chip key={t} activo={tipo === t} onClick={() => setTipo(t)}>{textoDe('metodo', t)}</Chip>)}</FilaChips>
        </div>
        <Campo etiqueta="Comisión que te cobra" htmlFor="metodo-pct" ayuda={ejemploPct(n, 'te cobra') ?? undefined}
          error={tocado && !(Number.isFinite(n) && n >= 0 && n <= 100) ? 'Un número entre 0 y 100' : undefined}>
          <EntradaPorcentaje id="metodo-pct" valor={pct} onCambiar={setPct} ancho={140} />
        </Campo>
        {'aplicar' in (inicial ?? {}) && <p className="text-[12px] text-[var(--text-muted)]">Se aplica también a los cobros de {nombre || 'esta pasarela'} que ya entraron sin comisión.</p>}
      </form>
    </Dialogo>
  );
}
