import { useState } from 'react';
import { api, fmtDinero } from '../../api';
import { Boton, BotonIcono, Campo, Chip, Entrada, FilaChips, Seleccion, useAviso } from '../../ui';
import Icono from '../Iconos';
import type { LeadElegido } from './BuscadorLead';
import { EntradaDinero, EntradaPorcentaje, fmtDineroExacto, parseMonto, pctTexto } from './comun';

// Campos de una venta que comparten "Registrar venta" (Finanzas, Pipeline y
// Chat) y "Editar venta": el curso y cómo te pagó, con el "+" al lado para
// crearlos ahí mismo, y quién la cerró con su %.

export interface Producto { id: string; nombre: string; precio_lista: number | null; moneda?: string | null }
export interface MetodoCobro { id: string; nombre: string; tipo?: string; comision_pct: number }
export interface Persona { id: string; nombre: string; rol: string; comision_venta_pct: number; usuario_id?: string | null }
export interface ContextoVenta {
  moneda: string; hoy: string;
  productos: Producto[]; metodos: MetodoCobro[]; equipo: Persona[];
  lead: LeadElegido | null;
  sugerido: { closer_id: string | null; setter_id: string | null };
}

export const cierra = (p: Persona) => ['closer', 'closer_setter', 'team_lead'].includes(p.rol);
export const consigue = (p: Persona) => ['setter', 'closer_setter'].includes(p.rol);

export function CampoCurso({ productos, valor, onElegir, onCreado, moneda, id = 'venta-curso' }: {
  productos: Producto[]; valor: string; onElegir: (id: string) => void; onCreado: (p: Producto) => void; moneda?: string; id?: string;
}) {
  const aviso = useAviso();
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function crear() {
    if (!nombre.trim()) return;
    setOcupado(true);
    try {
      const p = await api<Producto>('/productos', {
        method: 'POST',
        json: { nombre: nombre.trim(), precio_lista: parseMonto(precio) > 0 ? parseMonto(precio) : undefined, moneda },
      });
      onCreado(p);
      setCreando(false); setNombre(''); setPrecio('');
      aviso.exito(`Curso «${p.nombre}» creado`);
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(false); }
  }

  return (
    <Campo etiqueta="¿Qué compró?" htmlFor={id}>
      <div className="flex gap-2">
        <Seleccion id={id} value={valor} onChange={(e) => onElegir(e.target.value)} className="flex-1">
          <option value="">{productos.length ? 'Sin curso' : 'Todavía no cargaste cursos'}</option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}{Number(p.precio_lista) > 0 ? ` · ${fmtDinero(p.precio_lista, p.moneda ?? undefined)}` : ''}</option>
          ))}
        </Seleccion>
        <BotonIcono etiqueta="Crear un curso" variante="secundario" tamano="md" aria-expanded={creando} onClick={() => setCreando((v) => !v)}>
          <Icono nombre={creando ? 'cerrar' : 'mas'} tam={17} />
        </BotonIcono>
      </div>
      {creando && (
        <div className="mt-1.5 space-y-2 rounded-lg border border-[var(--border-hairline)] p-2.5" style={{ background: 'var(--page-plane)' }}>
          <div className="grid grid-cols-[1fr_118px] gap-2">
            <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del curso" aria-label="Nombre del curso" autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); crear(); } }} />
            <EntradaDinero valor={precio} onCambiar={setPrecio} placeholder="Precio" moneda={moneda} />
          </div>
          <div className="flex justify-end gap-2">
            <Boton tamano="sm" variante="fantasma" onClick={() => setCreando(false)}>Cancelar</Boton>
            <Boton tamano="sm" variante="primario" disabled={!nombre.trim()} cargando={ocupado} onClick={crear}>Crear curso</Boton>
          </div>
        </div>
      )}
    </Campo>
  );
}

export function CampoMetodo({ metodos, valor, onElegir, onCreado }: {
  metodos: MetodoCobro[]; valor: string; onElegir: (id: string) => void; onCreado: (m: MetodoCobro) => void;
}) {
  const aviso = useAviso();
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [pct, setPct] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function crear() {
    if (!nombre.trim()) return;
    setOcupado(true);
    try {
      const m = await api<MetodoCobro>('/metodos-pago', {
        method: 'POST', json: { nombre: nombre.trim(), tipo: 'pasarela', comision_pct: parseMonto(pct) || 0 },
      });
      onCreado(m);
      setCreando(false); setNombre(''); setPct('');
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(false); }
  }

  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">¿Cómo te pagó?</div>
      <FilaChips>
        {metodos.map((m) => (
          <Chip key={m.id} activo={valor === m.id} onClick={() => onElegir(valor === m.id ? '' : m.id)}>
            {m.nombre}{Number(m.comision_pct) > 0 ? ` · ${pctTexto(m.comision_pct)}` : ''}
          </Chip>
        ))}
        <Chip activo={creando} onClick={() => setCreando((v) => !v)} icono={<Icono nombre="mas" tam={13} />}>
          {metodos.length ? 'Otro' : 'Agregar cómo te pagan'}
        </Chip>
      </FilaChips>
      {creando && (
        <div className="mt-2 space-y-2 rounded-lg border border-[var(--border-hairline)] p-2.5" style={{ background: 'var(--page-plane)' }}>
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <Entrada value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Stripe, PayPal, transferencia…" aria-label="Nombre" autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); crear(); } }} />
            <EntradaPorcentaje valor={pct} onCambiar={setPct} etiqueta="Comisión que te cobra" />
          </div>
          <p className="text-[11px] text-[var(--text-muted)]">La comisión que te cobra por cada venta (0 si no te cobra nada).</p>
          <div className="flex justify-end gap-2">
            <Boton tamano="sm" variante="fantasma" onClick={() => setCreando(false)}>Cancelar</Boton>
            <Boton tamano="sm" variante="primario" disabled={!nombre.trim()} cargando={ocupado} onClick={crear}>Agregar</Boton>
          </div>
        </div>
      )}
    </div>
  );
}

/** Quién la cerró (o quién consiguió el lead) y su %, con lo que le toca en plata. */
export function CampoPersona({ etiqueta, personas, valor, onElegir, pct, onPct, importe, nadie = 'Nadie', id, moneda }: {
  etiqueta: string; personas: Persona[]; valor: string; onElegir: (id: string) => void;
  pct: string; onPct: (v: string) => void; importe: number; nadie?: string; id: string; moneda?: string;
}) {
  const p = personas.find((x) => x.id === valor);
  const n = parseMonto(pct);
  return (
    <Campo etiqueta={etiqueta} htmlFor={id}
      ayuda={p && importe > 0 && Number.isFinite(n) ? `A ${p.nombre} le tocan ${fmtDineroExacto((importe * n) / 100, moneda)} (${pctTexto(n)})` : undefined}>
      <div className="flex gap-2">
        <Seleccion id={id} value={valor} onChange={(e) => onElegir(e.target.value)} className="min-w-0 flex-1">
          <option value="">{nadie}</option>
          {personas.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
        </Seleccion>
        {p && <EntradaPorcentaje valor={pct} onCambiar={onPct} ancho={88} etiqueta={`Comisión de ${p.nombre}`} />}
      </div>
    </Campo>
  );
}
