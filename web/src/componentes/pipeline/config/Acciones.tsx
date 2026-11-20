import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import { Boton, BotonIcono, Campo, Entrada, ItemMenu, Menu, Seleccion, SeparadorMenu } from '../../../ui';
import Icono from '../../Iconos';
import TextoConVariables from '../../TextoConVariables';
import { SelectorConexion } from './Conexiones';
import { GRUPOS_ACCION, faltaEnAccion, metaAccion, type Conexion, type Etapa } from './datos';

// Qué hace una etapa SOLA cuando entra un lead. Valida en el lugar, no deja
// guardar acciones vacías y avisa si hay cambios sin guardar.

interface Accion { _k: string; tipo: string; [k: string]: any }
const clave = () => Math.random().toString(36).slice(2, 9);
const conClave = (a: any[]): Accion[] => (Array.isArray(a) ? a : []).map((x) => ({ ...x, _k: clave() }));
const sinClave = (a: Accion[]) => a.map(({ _k, ...x }) => x);

export default function EditorAcciones({ etapa, recursos, flujos, conexiones, onGuardado, onSucio, onConexionCreada }: {
  etapa: Etapa; recursos: any[]; flujos: any[]; conexiones: Conexion[];
  onGuardado: (acciones: any[]) => void; onSucio: (sucio: boolean) => void; onConexionCreada: (c: Conexion) => void;
}) {
  const [acc, setAcc] = useState<Accion[]>(() => conClave(etapa.acciones ?? []));
  const [tocadas, setTocadas] = useState<Set<string>>(new Set());
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const original = useRef(JSON.stringify(etapa.acciones ?? []));

  const sucio = JSON.stringify(sinClave(acc)) !== original.current;
  const faltas = useMemo(() => acc.map((a) => faltaEnAccion(a)), [acc]);
  const valido = faltas.every((f) => !f);
  useEffect(() => { onSucio(sucio); }, [sucio]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onSucio(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sucio) setGuardado(false); }, [sucio]);

  const set = (k: string, campo: string, v: unknown) => setAcc((a) => a.map((x) => (x._k === k ? { ...x, [campo]: v } : x)));
  const tocar = (k: string) => setTocadas((t) => (t.has(k) ? t : new Set(t).add(k)));
  const quitar = (k: string) => setAcc((a) => a.filter((x) => x._k !== k));

  function agregar(tipo: string) {
    const nueva: Accion = { _k: clave(), tipo };
    setAcc((a) => [...a, nueva]);
  }

  async function guardar() {
    if (!valido) { setTocadas(new Set(acc.map((a) => a._k))); return; }
    setGuardando(true); setError(null);
    try {
      const limpias = sinClave(acc);
      await api(`/etapas/${etapa.id}`, { method: 'PATCH', json: { acciones: limpias } });
      original.current = JSON.stringify(limpias);
      setTocadas(new Set());
      setGuardado(true);
      onGuardado(limpias);
    } catch (e: any) { setError(e.message); } finally { setGuardando(false); }
  }

  function descartar() {
    setAcc(conClave(JSON.parse(original.current)));
    setTocadas(new Set());
  }

  function campos(a: Accion, mostrarError: boolean) {
    const falta = mostrarError ? faltaEnAccion(a) : null;
    switch (a.tipo) {
      case 'dm':
        return (
          <Campo error={falta ?? undefined} ayuda="Solo le llega si el lead te escribió en las últimas 24 h (regla de Instagram).">
            <TextoConVariables valor={a.texto ?? ''} onCambio={(v) => set(a._k, 'texto', v)} filas={3} etiqueta="Mensaje del DM"
              placeholder="¡Hola {{nombre}}! Te confirmo la llamada 🙌" invalido={!!falta} onBlur={() => tocar(a._k)} />
          </Campo>
        );
      case 'nota':
        return (
          <Campo error={falta ?? undefined}>
            <TextoConVariables valor={a.texto ?? ''} onCambio={(v) => set(a._k, 'texto', v)} linea etiqueta="Texto de la nota"
              placeholder="Llamar a {{nombre}} en 24 h" invalido={!!falta} onBlur={() => tocar(a._k)} />
          </Campo>
        );
      case 'etiquetar':
      case 'quitar_etiqueta':
        return (
          <Campo error={falta ?? undefined}>
            <Entrada value={a.etiqueta ?? ''} onChange={(e) => set(a._k, 'etiqueta', e.target.value)} onBlur={() => tocar(a._k)}
              placeholder="ej. llamada-agendada" invalido={!!falta} aria-label="Etiqueta" list="etiquetas-config" />
          </Campo>
        );
      case 'recurso': {
        const opciones = recursos.filter((r) => r.tipo !== 'texto');
        return (
          <Campo error={falta ?? undefined} ayuda={opciones.length ? undefined : 'Todavía no tenés audios ni archivos: subilos desde el Chat (📎 Recursos).'}>
            <Seleccion value={a.recurso_id ?? ''} onChange={(e) => { set(a._k, 'recurso_id', e.target.value); tocar(a._k); }} aria-label="Audio o archivo"
              aria-invalid={!!falta || undefined}>
              <option value="">Elegí el audio o archivo…</option>
              {opciones.map((r) => <option key={r.id} value={r.id}>{r.tipo === 'audio' ? '🎙️' : '📎'} {r.nombre}</option>)}
            </Seleccion>
          </Campo>
        );
      }
      case 'flujo':
        return (
          <Campo error={falta ?? undefined} ayuda={flujos.length ? undefined : 'Todavía no tenés automensajes: crealos en Automensajes.'}>
            <Seleccion value={a.flujo_id ?? ''} onChange={(e) => { set(a._k, 'flujo_id', e.target.value); tocar(a._k); }} aria-label="Automensaje"
              aria-invalid={!!falta || undefined}>
              <option value="">Elegí el automensaje…</option>
              {flujos.map((f) => <option key={f.id} value={f.id}>{f.nombre}{f.activo ? '' : ' (en pausa)'}</option>)}
            </Seleccion>
          </Campo>
        );
      case 'asignar':
        return (
          <Seleccion value={a.rol ?? ''} onChange={(e) => set(a._k, 'rol', e.target.value)} aria-label="A quién">
            <option value="">A quien tenga menos leads</option>
            <option value="setter">A un setter (el que tenga menos)</option>
            <option value="closer">A un closer (el que tenga menos)</option>
          </Seleccion>
        );
      case 'email':
        return (
          <div className="space-y-2">
            <Campo etiqueta="Nombre de la secuencia" ayuda="Así la reconocés en tu app de email (le llega junto con el email del lead)."
              error={mostrarError && !String(a.secuencia ?? '').trim() ? 'Escribí el nombre de la secuencia' : undefined}>
              <Entrada value={a.secuencia ?? ''} onChange={(e) => set(a._k, 'secuencia', e.target.value)} onBlur={() => tocar(a._k)}
                placeholder="ej. Bienvenida" invalido={mostrarError && !String(a.secuencia ?? '').trim()} />
            </Campo>
            <SelectorConexion tipo="email" valor={a.suscripcion_id} url={a.url} conexiones={conexiones}
              invalido={mostrarError && !a.suscripcion_id && !a.url}
              onElegir={(id) => setAcc((l) => l.map((x) => (x._k === a._k ? { ...x, suscripcion_id: id ?? undefined, ...(id ? { url: undefined } : {}) } : x)))}
              onUrl={(u) => set(a._k, 'url', u)} onConexionCreada={onConexionCreada} />
            <p className="text-[11px] text-[var(--text-muted)]">Si el lead todavía no tiene email, no entra a la secuencia y te queda una nota en su ficha.</p>
          </div>
        );
      case 'webhook':
        return (
          <SelectorConexion valor={a.suscripcion_id} url={a.url} conexiones={conexiones} invalido={!!falta}
            onElegir={(id) => setAcc((l) => l.map((x) => (x._k === a._k ? { ...x, suscripcion_id: id ?? undefined, ...(id ? { url: undefined } : {}) } : x)))}
            onUrl={(u) => set(a._k, 'url', u)} onConexionCreada={onConexionCreada} />
        );
      default:
        return <p className="text-[12px] text-[var(--text-muted)]">Acción «{a.tipo}» (se mantiene como está).</p>;
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="text-[12px] font-medium text-[var(--text-secondary)]">Cuando un lead entra a «{etapa.nombre}», hacé esto solo:</div>
      {acc.length === 0 && (
        <p className="rounded-lg px-3 py-2.5 text-[12px] text-[var(--text-muted)]" style={{ background: 'var(--page-plane)' }}>
          Nada todavía. Por ejemplo: al pasar a «Llamada agendada», mandarle el audio del founder y ponerle la etiqueta «caliente».
        </p>
      )}
      {acc.map((a, i) => {
        const meta = metaAccion(a.tipo);
        const mostrarError = tocadas.has(a._k);
        return (
          <div key={a._k} className="rounded-xl p-2.5" style={{ border: '1px solid var(--border-hairline)', background: 'var(--surface-1)' }}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold" style={{ background: 'var(--gridline)' }}>{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{meta ? `${meta.icono} ${meta.etiqueta}` : a.tipo}</span>
              <BotonIcono etiqueta="Quitar esta acción" variante="fantasma" tamano="xs" onClick={() => quitar(a._k)}>
                <Icono nombre="cerrar" tam={14} />
              </BotonIcono>
            </div>
            {campos(a, mostrarError)}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Menu ancho={300} titulo="Agregar acción" disparador={({ alternar, abierto, ref }) => (
          <Boton ref={ref} tamano="sm" variante="secundario" onClick={alternar} aria-expanded={abierto} icono={<Icono nombre="mas" tam={14} />}>
            Agregar acción
          </Boton>
        )}>
          {GRUPOS_ACCION.map((g, gi) => (
            <div key={g.grupo}>
              {gi > 0 && <SeparadorMenu />}
              <div className="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{g.grupo}</div>
              {g.acciones.map((t) => (
                <ItemMenu key={t.tipo} icono={t.icono} descripcion={t.ayuda} onClick={() => agregar(t.tipo)}>{t.etiqueta}</ItemMenu>
              ))}
            </div>
          ))}
        </Menu>
        {!sucio && guardado && <span className="text-[12px] text-[var(--text-muted)]" role="status">Guardado ✓</span>}
      </div>

      {sucio && (
        <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-[12px] shadow-lg"
          style={{ background: 'var(--surface-1)', border: '1px solid var(--series-1)' }} role="status">
          <span className="min-w-0 flex-1 font-medium">
            {valido ? 'Tenés cambios sin guardar' : `Falta completar: ${faltas.filter(Boolean)[0]?.toLowerCase()}`}
          </span>
          <Boton tamano="sm" variante="fantasma" onClick={descartar}>Descartar</Boton>
          <Boton tamano="sm" variante="primario" onClick={guardar} cargando={guardando} disabled={!valido}>Guardar</Boton>
        </div>
      )}
      {error && <p className="text-[12px]" style={{ color: 'var(--status-critical)' }}>{error}</p>}
    </div>
  );
}
