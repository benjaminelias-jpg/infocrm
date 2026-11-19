import { pool, query, queryOne } from '../db/pool.js';
import { registrarEvento } from './eventos.js';
import { etapaEmbudoDe } from './infoproduccion.js';

// Generador de datos de demostración para una cuenta EXISTENTE. Llena todas las
// pantallas (contenidos con métricas, leads por el pipeline, llamadas, ventas
// con cuotas, gastos, equipo) para poder ver el CRM "con vida" y detectar fallos.

const DIA = 86_400_000;
const r = () => Math.random();
const entre = (a: number, b: number) => a + Math.floor(r() * (b - a + 1));
const elegir = <T>(a: T[]): T => a[Math.floor(r() * a.length)];
const pasa = (p: number) => r() < p;
const sinAc = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const CONTENIDOS = [
  { titulo: 'Reel: por qué tu lead magnet no convierte', tipo: 'reel', palabra: 'GUIA', angulo: 'problema', repro: 48000, calidad: 0.7, peso: 5 },
  { titulo: 'Story: detrás de cámara de una venta de 3k', tipo: 'historia', palabra: 'VENTA', angulo: 'producto', repro: 9000, calidad: 1.3, peso: 3 },
  { titulo: 'Mi guion de DM que agenda 4 reuniones por día', tipo: 'reel', palabra: 'GUION', angulo: 'solucion', repro: 15000, calidad: 1.1, peso: 4 },
  { titulo: 'Carrusel: 5 métricas que miro cada lunes', tipo: 'carrusel', palabra: 'METRICAS', angulo: 'solucion', repro: 7000, calidad: 0.9, peso: 2 },
  { titulo: 'Los 3 filtros para calificar un lead', tipo: 'reel', palabra: 'FILTROS', angulo: 'solucion', repro: 22000, calidad: 1.0, peso: 4 },
  { titulo: 'Masterclass de captación orgánica', tipo: 'reel', palabra: 'CLASE', angulo: 'producto', repro: 31000, calidad: 1.2, peso: 4 },
  { titulo: 'El error que te cuesta 10 ventas al mes', tipo: 'reel', palabra: 'ERROR', angulo: 'problema', repro: 12000, calidad: 0.8, peso: 3 },
  { titulo: 'Cómo armé mi oferta de 2.000€', tipo: 'carrusel', palabra: 'OFERTA', angulo: 'mentalidad', repro: 5000, calidad: 1.1, peso: 2 },
];
const NOMBRES = ['Lucía', 'Mateo', 'Sofía', 'Diego', 'Valentina', 'Tomás', 'Camila', 'Joaquín', 'Martina', 'Benjamín', 'Julieta', 'Lucas', 'Emma', 'Nicolás', 'Olivia'];
const APELL = ['García', 'Rodríguez', 'Pérez', 'Gómez', 'Fernández', 'López', 'Díaz', 'Torres', 'Ruiz', 'Flores'];

async function cuenta(tabla: string, cuentaId: string): Promise<number> {
  const r = await queryOne(`SELECT COUNT(*)::int n FROM ${tabla} WHERE cuenta_id=$1`, [cuentaId]);
  return r?.n ?? 0;
}

/** Crea los elementos base (cada sección se completa sola si falta). */
async function asegurarBase(cuentaId: string) {
  const ahora = Date.now();
  if (await cuenta('contenidos', cuentaId) === 0) {
    for (const [i, c] of CONTENIDOS.entries()) {
      const mediaId = `179${String(100000000000 + i * 7919).slice(0, 12)}`;
      await pool.query(
        `INSERT INTO contenidos (cuenta_id, ig_media_id, tipo, titulo, caption, permalink, publicado_en,
           ig_reproducciones, ig_alcance, ig_likes, ig_comentarios, ig_guardados, ig_compartidos,
           ig_metricas_en, angulo, etapa_embudo, inversion_ads)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now(),$14,$15,$16)`,
        [cuentaId, mediaId, c.tipo, c.titulo,
         `${c.titulo}\n\nComenta ${c.palabra} y te mando el recurso 👇`,
         `https://instagram.com/reel/C${sinAc(c.palabra)}${i}x/`, new Date(ahora - entre(5, 45) * DIA),
         c.repro, Math.round(c.repro * 0.78), Math.round(c.repro * 0.041), Math.round(c.repro * 0.017),
         Math.round(c.repro * 0.006), Math.round(c.repro * 0.002), c.angulo, etapaEmbudoDe(c.angulo),
         c.angulo === 'producto' ? entre(50, 300) : null]);
    }
  }
  if (await cuenta('personas_equipo', cuentaId) === 0) {
    for (const [nombre, rol, cv] of [['Betty', 'closer', 20], ['Celes', 'closer_setter', 15], ['Benja', 'setter', 5], ['Marco', 'closer', 18]] as any[]) {
      await pool.query(
        `INSERT INTO personas_equipo (cuenta_id, nombre, rol, comision_venta_pct, comision_cita_pct, activo)
         VALUES ($1,$2,$3,$4,$5,true)`, [cuentaId, nombre, rol, cv, rol.includes('setter') ? 3 : 0]);
    }
  }
  if (await cuenta('productos', cuentaId) === 0) {
    for (const [nombre, precio, dur] of [['7 Chakras — programa 3 meses', 2000, '3 meses'], ['Mentoría 1:1', 3500, '6 meses'], ['Curso express', 497, '1 mes']] as any[]) {
      await pool.query(`INSERT INTO productos (cuenta_id, nombre, precio_lista, moneda, duracion, activo) VALUES ($1,$2,$3,'EUR',$4,true)`,
        [cuentaId, nombre, precio, dur]);
    }
  }
  if (await cuenta('gastos', cuentaId) === 0) {
    for (const g of [['Meta Ads', 'ads', 450], ['Suscripción herramientas', 'herramientas', 89], ['Editor de video', 'freelancers', 300], ['Calendly + Zoom', 'herramientas', 32], ['Diseñador', 'freelancers', 180], ['Gestoría', 'administracion', 120]] as any[]) {
      await pool.query(`INSERT INTO gastos (cuenta_id, fecha, descripcion, categoria, importe, moneda) VALUES ($1,$2,$3,$4,$5,'EUR')`,
        [cuentaId, new Date(ahora - entre(1, 40) * DIA), g[0], g[1], g[2]]);
    }
  }
  if (await cuenta('flujos', cuentaId) === 0) {
    for (const f of [
      { nombre: 'Recurso del reel de guías', palabra: 'GUIA', pasos: [{ tipo: 'entregar_recurso', recurso: 'Aquí tienes la guía 👇' }, { tipo: 'etiquetar', etiqueta: 'pidio-guia' }] },
      { nombre: 'Masterclass', palabra: 'CLASE', pasos: [{ tipo: 'enviar_dm', texto: '¡Gracias! Te dejo el acceso a la clase.' }, { tipo: 'mover_etapa', etapa_slug: 'conversacion' }] },
    ]) {
      await pool.query(`INSERT INTO flujos (cuenta_id, nombre, disparo, palabra_clave, pasos, activo) VALUES ($1,$2,'comentario',$3,$4::jsonb,true)`,
        [cuentaId, f.nombre, f.palabra, JSON.stringify(f.pasos)]);
    }
  }
  if (await cuenta('recursos', cuentaId) === 0) {
    for (const rc of [['Bienvenida del founder', 'Hola, soy yo en persona dándote la bienvenida 🙌'], ['Explicación de la oferta', 'Te cuento en 2 min cómo funciona el programa.']]) {
      await pool.query(`INSERT INTO recursos (cuenta_id, nombre, tipo, texto) VALUES ($1,$2,'texto',$3)`, [cuentaId, rc[0], rc[1]]);
    }
  }
}

/** Genera un lote de leads (con su recorrido) para la cuenta. */
export async function cargarDemo(cuentaId: string, leads = 14): Promise<{ creados: number; ventas: number }> {
  await asegurarBase(cuentaId);
  const ahora = Date.now();

  const contenidos = await query(`SELECT id, ig_media_id, titulo FROM contenidos WHERE cuenta_id=$1`, [cuentaId]);
  const equipo = await query(`SELECT id, rol FROM personas_equipo WHERE cuenta_id=$1`, [cuentaId]);
  const productos = await query(`SELECT id, precio_lista FROM productos WHERE cuenta_id=$1`, [cuentaId]);
  const closers = equipo.filter((e: any) => e.rol.includes('closer'));
  if (contenidos.length === 0) return { creados: 0, ventas: 0 };

  const porTitulo = new Map(CONTENIDOS.map((c) => [c.titulo, c]));
  let creados = 0, ventas = 0;

  for (let i = 0; i < leads; i++) {
    const cont: any = elegir(contenidos);
    const meta = porTitulo.get(cont.titulo);
    const palabra = meta?.palabra ?? 'GUIA';
    const q = meta?.calidad ?? 1;
    const sufijo = `${Date.now()}_${i}_${entre(1000, 9999)}`;
    const nombre = elegir(NOMBRES), apellido = elegir(APELL);
    const entrada = new Date(ahora - entre(0, 40) * DIA - entre(0, 23) * 3_600_000);

    const identidad = {
      igUsername: `${sinAc(nombre)}.${sinAc(apellido)}${entre(1, 999)}`,
      igUserId: `1784${sufijo}`.slice(0, 17), nombre, apellido,
      email: pasa(0.5) ? `${sinAc(nombre)}.${sinAc(apellido)}@gmail.com` : undefined,
    };
    const senales = { igMediaId: pasa(0.62) ? cont.ig_media_id : undefined, palabraClave: palabra };

    const r1 = await registrarEvento({
      cuentaId, tipo: 'lead_creado', identidad, senales, fuente: 'manychat',
      ocurridoEn: entrada, origenToque: 'comentario', idempotencyKey: `demo_${sufijo}`, sinReglas: true,
    });
    creados++;
    const leadId = r1.leadId;
    let t = entrada.getTime();

    if (!pasa(0.07)) await registrarEvento({ cuentaId, tipo: 'recurso_entregado', leadId, senales, fuente: 'manychat', ocurridoEn: new Date(t + 60000), idempotencyKey: `demo_rec_${sufijo}`, sinReglas: true });

    if (pasa(Math.min(0.4 * q, 0.75))) {
      t += entre(1, 48) * 3_600_000;
      await registrarEvento({ cuentaId, tipo: 'respondio_dm', leadId, senales, fuente: 'manychat', ocurridoEn: new Date(t), idempotencyKey: `demo_dm_${sufijo}`, sinReglas: true });

      if (pasa(Math.min(0.55 * q, 0.85))) {
        // Agenda la reunión (en el pasado, para que el recorrido quepa).
        t = Math.min(t + entre(4, 72) * 3_600_000, ahora - 2 * DIA);
        await registrarEvento({ cuentaId, tipo: 'reunion_agendada', leadId, senales, fuente: 'calendly', ocurridoEn: new Date(t), titulo: 'Llamada de diagnóstico', idempotencyKey: `demo_reu_${sufijo}` });
        const closer = closers.length ? elegir(closers) : null;
        const prod: any = productos.length ? elegir(productos) : null;
        const esNoShow = pasa(0.2);
        const llamada = await queryOne(
          `INSERT INTO llamadas (cuenta_id, lead_id, closer_id, producto_id, programado_en, tipo, estado, resultado, valor_propuesto)
           VALUES ($1,$2,$3,$4,$5,'primera',$6,$7,$8) RETURNING id`,
          [cuentaId, leadId, closer?.id ?? null, prod?.id ?? null, new Date(t),
           esNoShow ? 'no_show' : 'completada', esNoShow ? 'no_show' : null, prod?.precio_lista ?? 2000]);

        if (!esNoShow) {
          const tReal = Math.min(t + entre(1, 24) * 3_600_000, ahora - 3_600_000);
          await registrarEvento({ cuentaId, tipo: 'reunion_realizada', leadId, senales, fuente: 'calendly', ocurridoEn: new Date(tReal), idempotencyKey: `demo_real_${sufijo}` });
          if (pasa(Math.min(0.5 * q, 0.65))) {
            t = tReal;
            const precio = prod?.precio_lista ?? 2000;
            const cuotas = pasa(0.4);
            await registrarEvento({ cuentaId, tipo: 'venta', leadId, senales, fuente: 'stripe', ocurridoEn: new Date(t + 3_600_000), valor: precio, idempotencyKey: `demo_venta_${sufijo}` });
            const venta = await queryOne(
              `INSERT INTO ventas (cuenta_id, lead_id, llamada_id, producto_id, closer_id, fecha, tipo_cobro,
                 precio_lista, precio_acordado, moneda, num_cuotas, estado, comision_closer_pct, comision_setter_pct)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'EUR',$10,$11,20,5) RETURNING id`,
              [cuentaId, leadId, llamada?.id ?? null, prod?.id ?? null, closer?.id ?? null,
               new Date(t), cuotas ? 'cuotas' : 'unico', precio, precio,
               cuotas ? 3 : 1, cuotas ? 'en_cuotas' : 'completada']);
            const nc = cuotas ? 3 : 1;
            for (let k = 1; k <= nc; k++) {
              const vence = new Date(t + (k - 1) * 30 * DIA);
              await pool.query(
                `INSERT INTO pagos (cuenta_id, venta_id, num_cuota, monto, vence_en, cobrado_en, estado, comision_pasarela)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [cuentaId, venta!.id, k, precio / nc, vence,
                 vence.getTime() <= ahora ? vence : null,
                 vence.getTime() <= ahora ? 'pagado' : 'pendiente', (precio / nc) * 0.029]);
            }
            ventas++;
          }
        }
      }
    }
  }
  return { creados, ventas };
}
