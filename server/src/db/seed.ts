/**
 * Datos de demostración: una operación de infoproducto de ~90 días.
 *
 * No son números bonitos al azar: cada reel tiene un rendimiento distinto
 * (hay dos que se comen la mitad de las ventas y varios que no traen nada),
 * y una parte de los leads entra sin ig_media_id para que se vea cómo el
 * CRM marca la atribución dudosa en vez de inventársela.
 */
import { pool, query, queryOne, closePool } from './pool.js';
import { runMigrations } from './migrate.js';
import { crearCuenta } from '../modules/cuentas.js';
import { registrarEvento } from '../modules/eventos.js';
import { hashPassword } from '../lib/auth.js';

const SLUG_DEMO = 'academia-demo';

// --- Generador pseudoaleatorio reproducible --------------------------
let semilla = 20260418;
function rnd(): number {
  semilla = (semilla * 1664525 + 1013904223) % 4294967296;
  return semilla / 4294967296;
}
const entre = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const elegir = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!;
const pasa = (p: number) => rnd() < p;

const DIA = 86_400_000;

// --- Catálogo de contenido -------------------------------------------
// `peso` = cuántos leads trae en proporción. `calidad` = cómo de bien
// convierten esos leads. Un reel puede traer mucho y vender poco.
const CONTENIDOS = [
  { titulo: '3 errores que te impiden vender tu infoproducto', tipo: 'reel', dias: 86, peso: 14, calidad: 0.9, repro: 184_000, palabra: 'ERRORES' },
  { titulo: 'Cómo conseguí 47 clientes en 30 días sin pauta', tipo: 'reel', dias: 78, peso: 26, calidad: 1.6, repro: 412_000, palabra: 'SISTEMA' },
  { titulo: 'El guion de DM que me cambió el negocio', tipo: 'reel', dias: 71, peso: 18, calidad: 1.2, repro: 236_000, palabra: 'GUION' },
  { titulo: 'Por qué tu lead magnet no convierte', tipo: 'reel', dias: 64, peso: 9, calidad: 0.6, repro: 97_000, palabra: 'GUIA' },
  { titulo: 'Mi embudo completo de Instagram explicado', tipo: 'carrusel', dias: 57, peso: 11, calidad: 1.1, repro: 64_000, palabra: 'EMBUDO' },
  { titulo: 'Lo que nadie te cuenta sobre vender cursos online', tipo: 'reel', dias: 50, peso: 7, calidad: 0.5, repro: 128_000, palabra: 'GUIA' },
  { titulo: 'De 0 a 10K al mes: el sistema exacto', tipo: 'reel', dias: 43, peso: 31, calidad: 1.8, repro: 673_000, palabra: '10K' },
  { titulo: 'Cómo cualificar leads antes de la llamada', tipo: 'reel', dias: 36, peso: 8, calidad: 1.4, repro: 71_000, palabra: 'FILTRO' },
  { titulo: 'El error de precio que te cuesta miles', tipo: 'reel', dias: 29, peso: 12, calidad: 1.3, repro: 159_000, palabra: 'PRECIOS' },
  { titulo: 'Reel viral vs reel que vende: la diferencia', tipo: 'reel', dias: 22, peso: 10, calidad: 0.8, repro: 221_000, palabra: 'GUIA' },
  { titulo: 'Plantilla de contenido para 30 días', tipo: 'carrusel', dias: 15, peso: 16, calidad: 0.7, repro: 88_000, palabra: 'PLANTILLA' },
  { titulo: 'Cómo cerrar sin parecer vendedor', tipo: 'reel', dias: 8, peso: 13, calidad: 1.5, repro: 142_000, palabra: 'CIERRE' },
  { titulo: 'Story: detrás de una llamada de venta', tipo: 'historia', dias: 4, peso: 3, calidad: 1.0, repro: 12_000, palabra: 'LLAMADA' },
];

const NOMBRES = ['Lucía', 'Mateo', 'Sofía', 'Diego', 'Valentina', 'Santiago', 'Camila', 'Nicolás',
  'Martina', 'Joaquín', 'Isabella', 'Tomás', 'Emilia', 'Benjamín', 'Antonella', 'Facundo',
  'Renata', 'Agustín', 'Julieta', 'Bruno', 'Carla', 'Iván', 'Paula', 'Hugo', 'Noa', 'Álvaro',
  'Daniela', 'Sergio', 'Elena', 'Marcos'];
const APELLIDOS = ['García', 'Rodríguez', 'Martínez', 'López', 'Fernández', 'González', 'Pérez',
  'Sánchez', 'Romero', 'Torres', 'Díaz', 'Álvarez', 'Ruiz', 'Castro', 'Morales', 'Ortega',
  'Silva', 'Vargas', 'Medina', 'Rojas'];
const PAISES = ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'US', 'EC', 'UY'];
const PRODUCTOS = [
  { nombre: 'Mentoría 1:1 — 3 meses', precio: 2497 },
  { nombre: 'Programa Acelerador', precio: 1497 },
  { nombre: 'Curso Sistema Instagram', precio: 997 },
  { nombre: 'Mentoría 1:1 — 6 meses', precio: 4200 },
];
const MOTIVOS_PERDIDA = ['Sin presupuesto', 'No era el momento', 'Se fue con otro', 'No contesta'];

function sinAcentos(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

async function limpiarDemo() {
  const existente = await queryOne(`SELECT id FROM cuentas WHERE slug = $1`, [SLUG_DEMO]);
  if (existente) {
    await pool.query(`DELETE FROM cuentas WHERE id = $1`, [existente.id]);
    console.log('[seed] cuenta de demo anterior eliminada');
  }
}

export async function sembrar() {
  await runMigrations(undefined, true);
  await limpiarDemo();

  const ahora = Date.now();

  // ---------- Cuenta, usuarios ----------
  const { cuenta, usuario, endpoints } = await crearCuenta({
    nombre: 'Academia de Infoproductores',
    slug: SLUG_DEMO,
    igUsername: 'academia.demo',
    moneda: 'EUR',
    zonaHoraria: 'Europe/Madrid',
    owner: { nombre: 'Benjamín Elias', email: 'demo@infocrm.app', password: 'infocrm2026' },
  });

  const closers: any[] = [];
  for (const [nombre, email] of [['Marta Ruiz', 'marta@infocrm.app'], ['Leo Navarro', 'leo@infocrm.app']]) {
    closers.push(await queryOne(
      `INSERT INTO usuarios (cuenta_id, email, nombre, password_hash, rol)
       VALUES ($1,$2,$3,$4,'closer') RETURNING *`,
      [cuenta.id, email, nombre, await hashPassword('infocrm2026')],
    ));
  }

  // ---------- Contenidos y automatizaciones ----------
  const contenidos: any[] = [];
  for (const [i, c] of CONTENIDOS.entries()) {
    const mediaId = `179${String(100000000000 + i * 7919).slice(0, 12)}`;
    const fila = await queryOne(
      `INSERT INTO contenidos (cuenta_id, ig_media_id, tipo, titulo, caption, permalink,
                               publicado_en, ig_reproducciones, ig_alcance, ig_likes, ig_comentarios,
                               ig_guardados, ig_metricas_en)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now()) RETURNING *`,
      [
        cuenta.id, mediaId, c.tipo, c.titulo,
        `${c.titulo}\n\nComenta ${c.palabra} y te mando el recurso 👇`,
        `https://www.instagram.com/reel/C${sinAcentos(c.palabra)}${i}x/`,
        new Date(ahora - c.dias * DIA),
        c.repro, Math.round(c.repro * 0.78), Math.round(c.repro * 0.041),
        Math.round(c.repro * 0.006), Math.round(c.repro * 0.017),
      ],
    );
    contenidos.push({ ...fila, ...c });
  }

  const automatizaciones: any[] = [];
  for (const c of contenidos) {
    const fila = await queryOne(
      `INSERT INTO automatizaciones (cuenta_id, nombre, palabra_clave, recurso, contenido_id,
                                     manychat_flow_id, tipo_disparo)
       VALUES ($1,$2,$3,$4,$5,$6,'comentario') RETURNING *`,
      [
        cuenta.id, `Comentario "${c.palabra}" — ${c.titulo.slice(0, 40)}`,
        c.palabra, `Recurso: ${c.titulo.slice(0, 50)}`, c.id,
        `flow_${sinAcentos(c.palabra)}_${String(c.ig_media_id).slice(-4)}`,
      ],
    );
    automatizaciones.push(fila);
  }

  // ---------- Leads ----------
  const sorteo: any[] = [];
  for (const c of contenidos) for (let i = 0; i < c.peso; i++) sorteo.push(c);

  const TOTAL_LEADS = 420;
  let creados = 0, reuniones = 0, realizadas = 0, ventas = 0, ingresos = 0;

  for (let i = 0; i < TOTAL_LEADS; i++) {
    const contenido = elegir(sorteo);
    // El lead no puede entrar antes de que el reel existiera
    const diasDesdePublicacion = entre(0, Math.max(0, contenido.dias - 1));
    const entrada = new Date(ahora - (contenido.dias - diasDesdePublicacion) * DIA
                             - entre(0, 23) * 3_600_000);

    const nombre = elegir(NOMBRES);
    const apellido = elegir(APELLIDOS);
    const usuario_ig = `${sinAcentos(nombre)}.${sinAcentos(apellido)}${entre(1, 999)}`;

    // 62% de los webhooks traen el ig_media_id (atribución exacta).
    // El resto llega solo con la palabra clave: ahí es donde aparece la
    // ambigüedad de GUIA, que está en tres reels distintos.
    const traeMediaId = pasa(0.62);

    const identidad = {
      manychatSubscriberId: `mc_${1_000_000 + i}`,
      igUsername: usuario_ig,
      igUserId: `1784${String(1_000_000_000 + i * 37).slice(0, 10)}`,
      nombre, apellido,
      email: pasa(0.55) ? `${sinAcentos(nombre)}.${sinAcentos(apellido)}${i}@gmail.com` : undefined,
      pais: elegir(PAISES),
    };
    const senales = {
      igMediaId: traeMediaId ? contenido.ig_media_id : undefined,
      palabraClave: contenido.palabra,
    };

    const r1 = await registrarEvento({
      cuentaId: cuenta.id, tipo: 'lead_creado', identidad, senales,
      fuente: 'manychat', ocurridoEn: entrada, origenToque: 'comentario',
      idempotencyKey: `seed_lead_${i}`, sinReglas: true,
    });
    creados++;
    const leadId = r1.leadId;

    // Recurso entregado casi siempre (lo manda ManyChat al instante)
    if (!pasa(0.07)) {
      await registrarEvento({
        cuentaId: cuenta.id, tipo: 'recurso_entregado', leadId, senales,
        fuente: 'manychat', ocurridoEn: new Date(entrada.getTime() + entre(5, 120) * 1000),
        idempotencyKey: `seed_rec_${i}`, sinReglas: true,
      });
    }

    const q = contenido.calidad;

    // Responde al DM
    const responde = pasa(Math.min(0.34 * q, 0.75));
    let t = entrada.getTime();
    if (responde) {
      t += entre(1, 48) * 3_600_000;
      await registrarEvento({
        cuentaId: cuenta.id, tipo: 'respondio_dm', leadId, senales,
        fuente: 'manychat', ocurridoEn: new Date(t),
        idempotencyKey: `seed_dm_${i}`, sinReglas: true,
      });
    }

    // Agenda reunión
    if (responde && pasa(Math.min(0.38 * q, 0.8))) {
      t += entre(4, 96) * 3_600_000;
      if (t > ahora) continue;
      await registrarEvento({
        cuentaId: cuenta.id, tipo: 'reunion_agendada', leadId, senales,
        fuente: 'calendly', ocurridoEn: new Date(t), titulo: 'Llamada de diagnóstico',
        idempotencyKey: `seed_reu_${i}`,
      });
      reuniones++;

      const closer = elegir(closers);
      await pool.query(
        `UPDATE oportunidades SET propietario_id = $2 WHERE lead_id = $1 AND estado = 'abierta'`,
        [leadId, closer.id]);
      await pool.query(`UPDATE leads SET propietario_id = $2 WHERE id = $1`, [leadId, closer.id]);

      // Día de la llamada
      t += entre(24, 168) * 3_600_000;
      if (t > ahora) continue;

      if (pasa(0.27)) {
        // No se presenta
        await registrarEvento({
          cuentaId: cuenta.id, tipo: 'reunion_no_asistio', leadId, senales,
          fuente: 'calendly', ocurridoEn: new Date(t),
          idempotencyKey: `seed_noshow_${i}`,
        });
      } else {
        await registrarEvento({
          cuentaId: cuenta.id, tipo: 'reunion_realizada', leadId, senales,
          fuente: 'manual', ocurridoEn: new Date(t),
          idempotencyKey: `seed_hecha_${i}`,
        });
        realizadas++;

        if (pasa(Math.min(0.26 * q, 0.62))) {
          const producto = elegir(PRODUCTOS);
          const cuando = new Date(t + entre(1, 72) * 3_600_000);
          if (cuando.getTime() <= ahora) {
            await registrarEvento({
              cuentaId: cuenta.id, tipo: 'venta', leadId, senales,
              valor: producto.precio, moneda: 'EUR', titulo: producto.nombre,
              fuente: 'stripe', ocurridoEn: cuando,
              idempotencyKey: `seed_venta_${i}`,
            });
            ventas++;
            ingresos += producto.precio;
          }
        } else if (pasa(0.45)) {
          await pool.query(
            `UPDATE oportunidades SET estado='perdida', motivo_perdida=$2,
                    cerrada_en=$3,
                    etapa_id=(SELECT id FROM etapas WHERE pipeline_id=oportunidades.pipeline_id AND slug='perdido')
              WHERE lead_id=$1 AND estado='abierta'`,
            [leadId, elegir(MOTIVOS_PERDIDA), new Date(t + entre(24, 240) * 3_600_000)]);
        }
      }
    }
  }

  // Un par de automatizaciones huérfanas, como pasa en la vida real:
  // palabras clave que el equipo puso en ManyChat y nadie enlazó al reel.
  await pool.query(
    `INSERT INTO automatizaciones (cuenta_id, nombre, palabra_clave, tipo_disparo)
     VALUES ($1,'Detectada: WEBINAR','WEBINAR','comentario'),
            ($1,'Detectada: BONUS','BONUS','dm')`,
    [cuenta.id]);

  const [calidad] = await query(
    `SELECT COUNT(*) FILTER (WHERE confianza='alta')::int AS alta,
            COUNT(*) FILTER (WHERE confianza='baja')::int AS baja,
            COUNT(*)::int AS total FROM toques WHERE cuenta_id = $1`,
    [cuenta.id]);

  console.log('\n  Datos de demo listos');
  console.log('  ───────────────────────────────────────────');
  console.log(`  Cuenta ............. ${cuenta.nombre}`);
  console.log(`  Acceso ............. demo@infocrm.app / infocrm2026`);
  console.log(`  Contenidos ......... ${contenidos.length}`);
  console.log(`  Automatizaciones ... ${automatizaciones.length + 2}`);
  console.log(`  Leads .............. ${creados}`);
  console.log(`  Reuniones agendadas  ${reuniones}  (realizadas: ${realizadas})`);
  console.log(`  Ventas ............. ${ventas}  →  ${ingresos.toLocaleString('es-ES')} EUR`);
  console.log(`  Toques atribuidos .. ${calidad?.alta}/${calidad?.total} con confianza alta, ${calidad?.baja} dudosos`);
  console.log('  ───────────────────────────────────────────');
  console.log('  Webhooks listos para pegar en ManyChat:');
  for (const e of endpoints) {
    console.log(`    ${e.nombre}\n      /webhooks/${e.token}`);
  }
  console.log('');

  return { cuenta, usuario, endpoints };
}

const esEntrada = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (esEntrada) {
  sembrar()
    .then(async () => { await closePool(); process.exit(0); })
    .catch(async (err) => {
      console.error('[seed] ERROR:', err);
      await closePool();
      process.exit(1);
    });
}
