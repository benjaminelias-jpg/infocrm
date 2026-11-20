import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Boton, BotonIcono } from '../../ui';
import { fmtNum } from '../../api';
import { BarraAtajos, esRapida, filtrarAtajos, type ItemAtajo } from './Atajos';
import { IconoChat } from './iconos';
import { AVISAR_DESDE, dividirTexto, esTactil, guardarBorrador, leerBorrador, MAX_TEXTO } from './util';

// La caja del mensaje: guarda lo escrito por conversación (si cambiás de chat
// no se arrastra a otro lead), crece sola, en el celular Enter baja de línea
// y se manda con ➤, y "/" busca los atajos. Avisa cerca del límite de
// Instagram (1000) y ofrece dividir un texto largo en varios mensajes.

export interface ManijaCaja {
  insertar: (texto: string) => void;
  enfocar: () => void;
}

export const CajaMensaje = forwardRef<ManijaCaja, {
  leadId: string;
  nombreLead: string;
  /** 'guardar': Instagram desconectado o ventana cerrada (queda como nota). */
  modo: 'enviar' | 'guardar';
  placeholder?: string;
  deshabilitado?: boolean;
  /** Aviso arriba del texto (ventana cerrada, etc.). */
  aviso?: React.ReactNode;
  atajos: ItemAtajo[];
  onEnviar: (texto: string) => void;
  onUsarAtajo: (i: ItemAtajo) => void;
  onAbrirAtajos: () => void;
}>(function CajaMensaje({ leadId, nombreLead, modo, placeholder, deshabilitado, aviso, atajos, onEnviar, onUsarAtajo, onAbrirAtajos }, ref) {
  const [texto, setTexto] = useState(() => leerBorrador(leadId));
  const [foco, setFoco] = useState(false);
  const [indice, setIndice] = useState(0);
  const [armado, setArmado] = useState<string | null>(null);
  const [barraCerrada, setBarraCerrada] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const tactil = useMemo(() => esTactil(), []);
  const pendiente = useRef<number | null>(null);
  const textoRef = useRef(texto);
  textoRef.current = texto;

  // Borrador por conversación (se guarda solo, con un respiro de 300 ms).
  useEffect(() => {
    if (pendiente.current) window.clearTimeout(pendiente.current);
    pendiente.current = window.setTimeout(() => guardarBorrador(leadId, texto), 300);
  }, [texto, leadId]);
  useEffect(() => () => {
    if (pendiente.current) window.clearTimeout(pendiente.current);
    guardarBorrador(leadId, textoRef.current);
  }, [leadId]);

  // Alto automático: hasta 6 líneas en escritorio y hasta el 40 % de la pantalla en el celular.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = tactil ? Math.round(window.innerHeight * 0.4) : 150;
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? 'auto' : 'hidden';
  }, [texto, tactil]);

  const enfocar = useCallback(() => {
    const el = area.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const n = el.value.length;
    el.setSelectionRange(n, n);
  }, []);

  useImperativeHandle(ref, () => ({
    insertar: (t: string) => {
      setTexto((prev) => {
        const base = prev.replace(/^\/\S*$/, '');
        return base ? `${base}${/\s$/.test(base) ? '' : ' '}${t}` : t;
      });
      window.setTimeout(enfocar, 0);
    },
    enfocar,
  }), [enfocar]);

  // "/" al principio: buscar atajos.
  const consulta = /^\/(\S*)$/.exec(texto)?.[1];
  const barraAbierta = consulta !== undefined && !barraCerrada && !deshabilitado;
  const encontrados = useMemo(() => (barraAbierta ? filtrarAtajos(atajos, consulta ?? '').slice(0, 8) : []), [barraAbierta, atajos, consulta]);
  useEffect(() => { setIndice(0); setArmado(null); }, [consulta]);
  useEffect(() => { if (consulta === undefined) setBarraCerrada(false); }, [consulta]);

  function elegir(i: ItemAtajo) {
    if (i.clase === 'pago' && armado !== i.id) { setArmado(i.id); return; }
    setArmado(null);
    if (esRapida(i)) {
      setTexto('');
      onUsarAtajo(i); // la rápida se pega con insertar()
    } else {
      setTexto('');
      onUsarAtajo(i);
    }
    window.setTimeout(enfocar, 0);
  }

  const largo = texto.length;
  const pasado = largo - MAX_TEXTO;
  const vacio = !texto.trim() || barraAbierta;

  function mandar() {
    if (deshabilitado || vacio || pasado > 0) return;
    onEnviar(texto.trim());
    setTexto('');
    guardarBorrador(leadId, '');
    if (!tactil) window.setTimeout(enfocar, 0);
  }

  function dividir() {
    const partes = dividirTexto(texto, MAX_TEXTO);
    partes.forEach((p) => onEnviar(p));
    setTexto('');
    guardarBorrador(leadId, '');
  }

  function tecla(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (barraAbierta) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndice((i) => Math.min(encontrados.length - 1, i + 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndice((i) => Math.max(0, i - 1)); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setBarraCerrada(true); return; }
      if ((e.key === 'Enter' || e.key === 'Tab') && encontrados[indice]) { e.preventDefault(); elegir(encontrados[indice]); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !tactil && !e.nativeEvent.isComposing) {
      e.preventDefault();
      mandar();
    }
  }

  const textoBoton = modo === 'guardar' ? 'Guardar' : 'Enviar';

  return (
    <div className="px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 md:px-3 md:pb-2">
      {aviso}
      <form onSubmit={(e) => { e.preventDefault(); mandar(); }} className="relative flex items-end gap-1.5">
        {barraAbierta && (
          <BarraAtajos items={encontrados} indice={indice} armado={armado} onElegir={elegir} onIndice={setIndice} />
        )}
        <BotonIcono etiqueta="Atajos (audios, respuestas, enlaces)" tamano="md" onClick={onAbrirAtajos} disabled={deshabilitado}
          className="shrink-0 !h-11 !w-11 md:!h-10 md:!w-10">
          <IconoChat nombre="mas" tam={20} />
        </BotonIcono>
        <div className="min-w-0 flex-1">
          <textarea ref={area} value={texto} rows={1} disabled={deshabilitado}
            onChange={(e) => setTexto(e.target.value)} onKeyDown={tecla}
            onFocus={() => setFoco(true)} onBlur={() => setFoco(false)}
            aria-label={`Mensaje para ${nombreLead}`} aria-expanded={barraAbierta} aria-controls={barraAbierta ? 'chat-barra-atajos' : undefined}
            aria-autocomplete="list"
            placeholder={deshabilitado ? 'Cargando conversación…' : placeholder ?? 'Escribí un mensaje…'}
            className="ui-control block min-h-[44px] w-full resize-none rounded-2xl px-3.5 py-[10px] text-[16px] leading-snug disabled:opacity-60 md:min-h-[40px] md:py-2 md:text-[13px]" />
        </div>
        {tactil ? (
          <button type="submit" disabled={deshabilitado || vacio || pasado > 0} aria-label={textoBoton}
            className={`ui-foco flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-40 ${modo === 'guardar' ? 'border border-[var(--border-hairline)] text-[var(--text-primary)]' : 'text-white'}`}
            style={{ background: modo === 'guardar' ? 'var(--surface-1)' : 'var(--series-1)' }}>
            <IconoChat nombre="enviar" tam={19} />
          </button>
        ) : (
          <Boton type="submit" variante={modo === 'guardar' ? 'secundario' : 'primario'} disabled={deshabilitado || vacio || pasado > 0}
            className="!h-10 shrink-0" icono={<IconoChat nombre="enviar" tam={15} />}>
            {textoBoton}
          </Boton>
        )}
      </form>
      {/* Ayuda chica (escritorio, con foco) y el contador cerca del límite de Instagram. */}
      <div className={`flex min-h-[18px] items-center gap-2 pl-[52px] pr-1 pt-1 text-[11px] md:pl-[50px] ${tactil && largo < AVISAR_DESDE ? 'hidden' : ''}`}>
        {!tactil && pasado <= 0 && (
          <span className={`truncate text-[var(--text-muted)] transition-opacity ${foco ? 'opacity-100' : 'opacity-0'}`} aria-hidden={!foco}>
            Enter envía · Shift+Enter nueva línea · «/» atajos
          </span>
        )}
        {pasado > 0 ? (
          <span className="flex flex-wrap items-center gap-2" role="alert">
            <span style={{ color: 'var(--status-critical)' }}>Te pasaste por {fmtNum(pasado)} caracteres (Instagram corta en {fmtNum(MAX_TEXTO)}).</span>
            <Boton tamano="xs" onClick={dividir}>Dividir en {dividirTexto(texto, MAX_TEXTO).length} mensajes</Boton>
          </span>
        ) : largo >= AVISAR_DESDE ? (
          <span className="ml-auto shrink-0 cifras text-[var(--text-muted)]">{fmtNum(largo)}/{fmtNum(MAX_TEXTO)}</span>
        ) : null}
      </div>
    </div>
  );
});
