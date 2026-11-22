import type { Recurso } from './tipos';

// Lo compartido entre los atajos del Chat y el gestor de recursos: íconos,
// grupos (siempre en el mismo orden) y la conversión de audio a WAV.

export const ICONO_RECURSO: Record<string, string> = {
  audio: '🎙️', imagen: '🖼️', video: '🎬', pdf: '📄', texto: '⚡', link: '🔗', secuencia: '🔁',
};

export type GrupoId = 'audio' | 'secuencias' | 'texto' | 'enlaces';

/** Los atajos van agrupados y en este orden; dentro de cada grupo, en el orden que eligió el founder. */
export const GRUPOS: Array<{ id: GrupoId; tipos: string[]; titulo: string; icono: string; vacio: string }> = [
  { id: 'audio', tipos: ['audio'], titulo: 'Audios del founder', icono: '🎙️', vacio: 'Grabá tu audio de bienvenida: tus setters lo mandan con un toque y le llega al lead como nota de voz.' },
  { id: 'secuencias', tipos: ['secuencia'], titulo: 'Secuencias', icono: '🔁', vacio: 'Varios atajos seguidos con una espera entre cada uno. Ej. «Secuencia A»: 3 audios, uno cada 2 minutos.' },
  { id: 'texto', tipos: ['texto'], titulo: 'Respuestas rápidas', icono: '⚡', vacio: 'Textos que se pegan en la caja para editarlos antes de mandar.' },
  { id: 'enlaces', tipos: ['link', 'pdf', 'imagen', 'video'], titulo: 'Enlaces y archivos', icono: '🔗', vacio: 'Tu calendario, un PDF o una imagen, listos para mandar.' },
];

export const grupoDe = (r: Pick<Recurso, 'tipo'>): GrupoId => GRUPOS.find((g) => g.tipos.includes(r.tipo))?.id ?? 'enlaces';

export function ordenarPorGrupo(recursos: Recurso[]) {
  return GRUPOS.flatMap((g) => recursos.filter((r) => g.tipos.includes(r.tipo)));
}

export const LIMITE_BYTES = 3_200_000;
export const MAX_SEGUNDOS_AUDIO = 100;

export function aBase64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

/**
 * Convierte cualquier audio a WAV mono de 16 kHz. Instagram acepta WAV como
 * nota de voz; lo que graba Chrome (webm/opus) o un mp3 no siempre.
 * 16 kHz mono = voz clara y ~100 s por cada 3 MB.
 */
export async function aWav(blob: Blob): Promise<Blob> {
  const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
  const ctx = new Ctx();
  try {
    const original = await ctx.decodeAudioData(await blob.arrayBuffer());
    const hz = 16000;
    const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(original.duration * hz)), hz);
    const src = offline.createBufferSource();
    src.buffer = original;
    src.connect(offline.destination);
    src.start();
    const pcm = (await offline.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const txt = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    txt(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); txt(8, 'WAVE');
    txt(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, hz, true); v.setUint32(28, hz * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    txt(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  } finally {
    ctx.close().catch(() => {});
  }
}

/** "mm:ss" */
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** URL corta para mostrar: "cal.com/benja/30min". */
export function urlCorta(u: string | null | undefined) {
  if (!u) return '';
  return u.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}
