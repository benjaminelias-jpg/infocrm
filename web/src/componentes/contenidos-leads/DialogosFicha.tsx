import { useState } from 'react';
import { api } from '../../api';
import { AreaTexto, Boton, Campo, Chip, Dialogo, Entrada, FilaChips, useAviso } from '../../ui';
import { MOTIVOS_DESCARTE } from './textos';

// Diálogos de la ficha del lead (nada de ventanas del navegador).

const CAMPOS: Array<{ clave: string; etiqueta: string; tipo?: string; modo?: 'email' | 'tel' | 'text'; ayuda?: string; largo?: boolean }> = [
  { clave: 'nombre', etiqueta: 'Nombre' },
  { clave: 'apellido', etiqueta: 'Apellido' },
  { clave: 'email', etiqueta: 'Email', tipo: 'email', modo: 'email' },
  { clave: 'telefono', etiqueta: 'Teléfono', tipo: 'tel', modo: 'tel' },
  { clave: 'pais', etiqueta: 'País', ayuda: 'Ej. AR, MX, ES' },
  { clave: 'modelo_negocio', etiqueta: 'A qué se dedica', ayuda: 'Ej. coach de nutrición con cursos grabados', largo: true },
  { clave: 'ingresos_aprox', etiqueta: 'Cuánto factura hoy', ayuda: 'Lo que te contó, en sus palabras' },
  { clave: 'cuello_botella', etiqueta: 'Qué lo frena', ayuda: 'El problema principal que quiere resolver', largo: true },
];

/** Editar los datos de contacto y lo que contó en la conversación. */
export function DialogoEditarDatos({ lead, onCerrar, onGuardado }: {
  lead: any; onCerrar: () => void; onGuardado: (lead: any) => void;
}) {
  const aviso = useAviso();
  const [valores, setValores] = useState<Record<string, string>>(
    () => Object.fromEntries(CAMPOS.map((c) => [c.clave, lead[c.clave] ?? ''])),
  );
  const [guardando, setGuardando] = useState(false);
  const emailMal = valores.email.trim() !== '' && !/^\S+@\S+\.\S+$/.test(valores.email.trim());

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    if (emailMal) return;
    const cambios: Record<string, string | null> = {};
    for (const c of CAMPOS) {
      const v = valores[c.clave].trim();
      if (v !== (lead[c.clave] ?? '')) cambios[c.clave] = v || null;
    }
    if (!Object.keys(cambios).length) { onCerrar(); return; }
    setGuardando(true);
    try {
      const r = await api(`/leads/${lead.id}`, { method: 'PATCH', json: cambios });
      onGuardado(r);
      aviso.exito('Datos guardados');
    } catch (err: any) {
      aviso.error(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo="Editar datos" ancho={520}
      descripcion="Lo que completes acá también suma a su temperatura (si contó de su negocio, está más cerca de comprar)."
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={() => guardar()} cargando={guardando} disabled={emailMal}>Guardar</Boton>
      </>}>
      <form onSubmit={guardar} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CAMPOS.map((c) => (
          <Campo key={c.clave} etiqueta={c.etiqueta} ayuda={c.ayuda} className={c.largo ? 'sm:col-span-2' : ''}
            error={c.clave === 'email' && emailMal ? 'Revisá el email: le falta algo (ej. nombre@gmail.com).' : undefined}>
            {c.largo
              ? <AreaTexto rows={2} value={valores[c.clave]} onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))} maxLength={300} />
              : <Entrada type={c.tipo ?? 'text'} inputMode={c.modo} value={valores[c.clave]} maxLength={120}
                  onChange={(e) => setValores((v) => ({ ...v, [c.clave]: e.target.value }))} />}
          </Campo>
        ))}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialogo>
  );
}

/** Descartar un lead (no califica, spam…): queda marcado y se puede volver atrás. */
export function DialogoDescartar({ lead, quien, onCerrar, onListo }: {
  lead: any; quien: string; onCerrar: () => void; onListo: (lead: any) => void;
}) {
  const aviso = useAviso();
  const [motivo, setMotivo] = useState('');
  const [otro, setOtro] = useState('');
  const [guardando, setGuardando] = useState(false);
  const final = motivo === 'Otro' ? otro.trim() : motivo;

  async function descartar() {
    setGuardando(true);
    try {
      const r = await api(`/leads/${lead.id}`, { method: 'PATCH', json: { calificacion: 'no_calificado', motivo_descarte: final || null } });
      onListo(r);
    } catch (err: any) {
      aviso.error(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={`¿Descartar a ${quien}?`} autoFoco={false}
      descripcion="Queda marcado como «No califica» y sale de tus calientes. Lo podés volver a considerar cuando quieras."
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="peligro" onClick={descartar} cargando={guardando}>Descartar</Boton>
      </>}>
      <div className="space-y-3">
        <p className="text-[12px] font-medium text-[var(--text-secondary)]">¿Por qué? (opcional)</p>
        <FilaChips>
          {[...MOTIVOS_DESCARTE, 'Otro'].map((m) => (
            <Chip key={m} activo={motivo === m} onClick={() => setMotivo(motivo === m ? '' : m)}>{m}</Chip>
          ))}
        </FilaChips>
        {motivo === 'Otro' && (
          <Entrada value={otro} onChange={(e) => setOtro(e.target.value)} placeholder="Contalo en pocas palabras" autoFocus maxLength={200} />
        )}
      </div>
    </Dialogo>
  );
}
