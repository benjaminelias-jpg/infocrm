import { useEffect, useState } from 'react';
import { api } from '../api';
import { Boton, Dialogo, Entrada, useAviso } from '../ui';

// «Menú del chat» de Instagram: preguntas frecuentes que ve quien te escribe
// por primera vez (hasta 4) y accesos fijos del chat (hasta 5). Cada botón
// dispara el automensaje «Toca un botón» con esa palabra, o abre un link.

type Pregunta = { pregunta: string; palabra: string };
type Item = { titulo: string; palabra?: string; url?: string };

export default function MenuChat({ abierto, onCerrar, palabras }: { abierto: boolean; onCerrar: () => void; palabras: string[] }) {
  const aviso = useAviso();
  const [preguntas, setPreguntas] = useState<Pregunta[]>([]);
  const [menu, setMenu] = useState<Item[]>([]);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (!abierto) return;
    api<{ preguntas: Pregunta[]; menu: Item[] }>('/ux/automensajes/menu-chat')
      .then((r) => { setPreguntas(r.preguntas); setMenu(r.menu); }).catch(() => {});
  }, [abierto]);

  async function guardar() {
    setOcupado(true);
    try {
      const r = await api<{ ok: boolean; mensaje: string }>('/ux/automensajes/menu-chat', { method: 'PUT', json: { preguntas, menu } });
      (r.ok ? aviso.exito : aviso.error)(r.mensaje);
      if (r.ok) onCerrar();
    } catch (e: any) { aviso.error(e.message); } finally { setOcupado(false); }
  }

  return (
    <Dialogo abierto={abierto} onCerrar={onCerrar} titulo="Menú del chat de Instagram" ancho={560}
      descripcion="Botones que ve la gente en tu chat. Cada uno dispara el automensaje «Toca un botón» con esa palabra."
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" onClick={guardar} cargando={ocupado}>Guardar y subir a Instagram</Boton></>}>
      <datalist id="palabras-boton">{palabras.map((p) => <option key={p} value={p} />)}</datalist>
      <section className="space-y-2">
        <div className="text-[13px] font-semibold">Preguntas frecuentes al abrir el chat <span className="font-normal text-[var(--text-muted)]">(hasta 4)</span></div>
        <p className="text-[12px] text-[var(--text-muted)]">Las ve quien te escribe por primera vez. Ej. «Quiero la guía gratis» → palabra GUIA.</p>
        {preguntas.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Entrada value={p.pregunta} maxLength={80} placeholder="Quiero la guía gratis" aria-label={`Pregunta ${i + 1}`} className="min-w-0 flex-[2]"
              onChange={(e) => setPreguntas(preguntas.map((x, j) => (j === i ? { ...x, pregunta: e.target.value } : x)))} />
            <Entrada value={p.palabra} maxLength={40} placeholder="GUIA" list="palabras-boton" aria-label={`Palabra ${i + 1}`} className="min-w-0 flex-1"
              onChange={(e) => setPreguntas(preguntas.map((x, j) => (j === i ? { ...x, palabra: e.target.value } : x)))} />
            <button type="button" className="ui-foco rounded-md px-1.5 text-[var(--text-muted)]" aria-label="Quitar" onClick={() => setPreguntas(preguntas.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        {preguntas.length < 4 && <Boton tamano="sm" variante="secundario" onClick={() => setPreguntas([...preguntas, { pregunta: '', palabra: '' }])}>+ Pregunta</Boton>}
      </section>
      <section className="mt-5 space-y-2">
        <div className="text-[13px] font-semibold">Menú fijo del chat <span className="font-normal text-[var(--text-muted)]">(hasta 5)</span></div>
        <p className="text-[12px] text-[var(--text-muted)]">Siempre a mano en la conversación. Con palabra dispara un automensaje; con link abre esa página (ej. tu agenda).</p>
        {menu.map((m, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Entrada value={m.titulo} maxLength={30} placeholder="Agendar llamada" aria-label={`Botón ${i + 1}`} className="min-w-0 flex-[2]"
              onChange={(e) => setMenu(menu.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))} />
            <Entrada value={m.url ?? m.palabra ?? ''} placeholder="AGENDA o https://…" list="palabras-boton" aria-label={`Palabra o link ${i + 1}`} className="min-w-0 flex-[2]"
              onChange={(e) => { const v = e.target.value; setMenu(menu.map((x, j) => (j === i ? (/^https?:\/\//i.test(v) ? { titulo: x.titulo, url: v } : { titulo: x.titulo, palabra: v }) : x))); }} />
            <button type="button" className="ui-foco rounded-md px-1.5 text-[var(--text-muted)]" aria-label="Quitar" onClick={() => setMenu(menu.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        {menu.length < 5 && <Boton tamano="sm" variante="secundario" onClick={() => setMenu([...menu, { titulo: '', palabra: '' }])}>+ Botón</Boton>}
      </section>
    </Dialogo>
  );
}
