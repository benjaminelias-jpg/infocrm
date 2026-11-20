import { useState } from 'react';
import { api } from '../../api';
import { Boton, Campo, Chip, Dialogo, Entrada, FilaChips, useAviso } from '../../ui';
import { ANGULOS, TIPO_CONTENIDO } from './textos';

// Agregar un reel (o carrusel, historia…) a mano, sin Instagram conectado:
// pegás el link, le ponés un título y, si querés, el ángulo.

const TIPOS = ['reel', 'carrusel', 'post', 'historia'] as const;

function tipoDelLink(link: string): (typeof TIPOS)[number] | null {
  if (/instagram\.com\/(reel|reels)\//i.test(link)) return 'reel';
  if (/instagram\.com\/stories\//i.test(link)) return 'historia';
  if (/instagram\.com\/p\//i.test(link)) return 'post';
  return null;
}

export default function NuevoContenido({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: (c: any) => void }) {
  const aviso = useAviso();
  const [link, setLink] = useState('');
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>('reel');
  const [angulo, setAngulo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const linkMal = link.trim() !== '' && !/^https?:\/\/\S+\.\S+/i.test(link.trim());

  function cambiarLink(v: string) {
    setLink(v);
    const t = tipoDelLink(v);
    if (t) setTipo(t);
  }

  async function guardar(e?: React.FormEvent) {
    e?.preventDefault();
    if (!titulo.trim() || linkMal) return;
    setGuardando(true);
    try {
      const c = await api('/contenidos', {
        method: 'POST',
        json: { titulo: titulo.trim(), tipo, ...(link.trim() ? { permalink: link.trim() } : {}), ...(angulo ? { angulo } : {}) },
      });
      onCreado(c);
    } catch (err: any) {
      aviso.error(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo="Agregar un contenido" ancho={480}
      descripcion="Para medir un reel aunque Instagram no esté conectado. Después le enlazás una palabra clave y sus leads aparecen solos."
      pie={<>
        <Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton>
        <Boton variante="primario" onClick={() => guardar()} cargando={guardando} disabled={!titulo.trim() || linkMal}>Agregar</Boton>
      </>}>
      <form onSubmit={guardar} className="space-y-3">
        <Campo etiqueta="Link del contenido (opcional)" error={linkMal ? 'Pegá el link completo (empieza con https://).' : undefined}
          ayuda="Lo copiás desde Instagram: ⋯ → Copiar enlace">
          <Entrada value={link} onChange={(e) => cambiarLink(e.target.value)} placeholder="https://www.instagram.com/reel/…" inputMode="url"
            autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Campo>
        <Campo etiqueta="Título">
          <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej. 3 errores al vender tu curso" maxLength={120} />
        </Campo>
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Tipo</p>
          <FilaChips>
            {TIPOS.map((t) => <Chip key={t} activo={tipo === t} onClick={() => setTipo(t)}>{TIPO_CONTENIDO[t]}</Chip>)}
          </FilaChips>
        </div>
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-[var(--text-secondary)]">Ángulo (opcional)</p>
          <FilaChips>
            {ANGULOS.map((a) => <Chip key={a.valor} activo={angulo === a.valor} onClick={() => setAngulo(angulo === a.valor ? '' : a.valor)}>{a.etiqueta}</Chip>)}
          </FilaChips>
        </div>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Dialogo>
  );
}
