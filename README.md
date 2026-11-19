# InfoCRM

## Desplegar en un clic

Con el código en un repo de GitHub, este botón crea en Render el servicio web
**y** la base de datos Postgres, ya conectados (lee `render.yaml`):

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/benjaminelias-jpg/infocrm)

Al terminar, abre la URL que te da Render y crea tu cuenta (ver `DEPLOY.md`,
paso 3). Pasos completos y alternativas (Railway, VPS) en **`DEPLOY.md`**.

---


CRM de infoproducción construido alrededor de Instagram. No es un CRM genérico con
un campo "origen": el contenido es una entidad de primer nivel y cada lead, cada
reunión y cada euro cuelgan del reel que los trajo.

La pregunta que responde: **«de este reel vinieron tantos leads, tantas reuniones
y tantas ventas»**.

---

## Arrancar

Necesitas Node 20+ y PostgreSQL 14+.

```bash
cd server && npm install
```

```bash
cd web && npm install
```

Copia la configuración y ajusta `DATABASE_URL` si tu Postgres no está en local:

```bash
cp server/.env server/.env.local 2>/dev/null || true
```

Migra la base de datos y siembra los datos de demo:

```bash
cd server && npm run migrate && npm run seed
```

Arranca el backend (puerto 4000) y, en otra terminal, el panel (puerto 5173):

```bash
cd server && npm run dev
```

```bash
cd web && npm run dev
```

Entra en http://localhost:5173 con **demo@infocrm.app** / **infocrm2026**.

---

## Cómo funciona

### El recorrido de un lead

```
Comentario en un reel
   ↓  ManyChat detecta la palabra clave y manda el recurso por DM
   ↓  ManyChat dispara un webhook a InfoCRM
POST /webhooks/<token>
   ↓  1. se guarda el payload CRUDO (nada se pierde, aunque el procesado falle)
   ↓  2. se resuelve o se crea el lead
   ↓  3. se ATRIBUYE el contenido de origen
   ↓  4. se registra el evento y el "toque"
   ↓  5. se abre o se reutiliza la oportunidad
   ↓  6. la oportunidad se mueve de etapa según el tipo de evento
   ↓  7. se ejecutan las reglas (etiquetar, asignar, avisar fuera)
```

Después, Calendly manda `reunion_agendada` y la pasarela manda `venta`. Como el
lead ya existe, esos eventos se enganchan al mismo contacto y arrastran la
atribución original. Por eso el panel puede decir de qué reel vino cada venta.

### Atribución: lo que se puede saber y lo que no

Este es el punto donde la mayoría de los montajes mienten, así que aquí es
explícito. El motor resuelve el origen por este orden:

| Prioridad | Señal | Confianza |
|---|---|---|
| 1 | `contenido_id` explícito | alta |
| 2 | `ig_media_id` del post comentado | **alta** |
| 3 | id de automatización o `flow_id` de ManyChat | alta |
| 4 | palabra clave usada en **un solo** contenido | alta |
| 5 | palabra clave usada en **varios** contenidos | **baja** |
| 6 | campaña / `utm_campaign` | media |
| 7 | nada | ninguna |

**El caso 5 es el importante.** En ManyChat la automatización se dispara por
palabra, no por post. Si usas `GUIA` en cinco reels distintos, nadie puede saber
de cuál vino el lead: ni este CRM ni ninguno. En vez de inventarse un dato, el
sistema atribuye al contenido publicado más recientemente, marca el toque como
`confianza = baja` y lo saca en el panel ("Fiabilidad de la atribución") y en la
tabla de contenidos ("⚠ N dudosos").

Para atribución exacta, haz que ManyChat mande el `ig_media_id` del post
comentado. Alternativa barata: una palabra distinta por reel.

**Nada se tira.** Si llega un `ig_media_id` que no conocemos, se crea el
contenido solo (y la sincronización de Instagram lo rellena después). Si llega
una palabra clave desconocida, se crea la automatización sola. Cuando después la
enlazas a un reel, el botón **Reatribuir** recupera retroactivamente todos los
leads que ya habían entrado por ahí, y propaga el cambio a oportunidades y
eventos.

### Qué se mueve solo

Cada etapa tiene una columna `evento_asociado`. Cuando entra un evento de ese
tipo, la oportunidad se mueve ahí. Es un dato editable, no código:

| Evento | Etapa |
|---|---|
| `lead_creado` | Lead nuevo |
| `recurso_entregado` | Recurso entregado |
| `respondio_dm` | En conversación |
| `reunion_agendada` | Reunión agendada |
| `reunion_no_asistio` | No asistió |
| `reunion_realizada` | Reunión realizada |
| `venta` | Venta (cierra la oportunidad como ganada) |

Los eventos "blandos" (recurso, DM) solo avanzan: si ManyChat reenvía con retraso
el "recurso entregado" de alguien que ya agendó, no lo devuelve atrás. Los
eventos "fuertes" (no-show, venta) sí mueven en cualquier dirección, porque son
información real.

El **motor de reglas** es para todo lo demás: etiquetar, asignar al closer con
menos carga, dejar notas, disparar webhooks salientes. Cada ejecución queda
registrada, así que siempre se puede auditar por qué un lead acabó donde acabó.

---

## Los webhooks

Cada cuenta nace con tres endpoints listos. Sus URLs están en **Conexiones**:

| Endpoint | Para qué | Evento por defecto |
|---|---|---|
| `manychat-leads` | entrada de leads desde ManyChat | `lead_creado` |
| `reunion-agendada` | Calendly, Cal.com, TidyCal | `reunion_agendada` |
| `venta` | Stripe, Hotmart, tu pasarela | `venta` |

El token secreto va en la URL, así que no hace falta configurar cabeceras en
ManyChat.

### Qué mandar

El payload necesita **algo que identifique al lead** y, para atribuir, **algo que
identifique el contenido**:

```json
{
  "id": "{{user_id}}",
  "first_name": "{{first_name}}",
  "ig_username": "{{ig_username}}",
  "email": "{{email}}",
  "custom_fields": {
    "palabra_clave": "SISTEMA",
    "ig_media_id": "{{last_commented_media_id}}"
  }
}
```

El normalizador busca cada campo en todas las rutas habituales, así que entiende
payloads de ManyChat, Calendly, Stripe, Hotmart, Make y Zapier **sin configurar
nada**. Si tu payload es raro, cada endpoint acepta un mapeo propio:

```json
{
  "campos":   { "email": ["comprador.correo"], "valor": ["pedido.importe"] },
  "opciones": { "valor_divisor": 100, "evento_fijo": "venta" }
}
```

Hay un probador en `POST /api/webhooks/probar` (y en la interfaz) que enseña qué
entendería de un payload **sin guardar nada**.

### Qué pasa si algo falla

El payload crudo se guarda **antes** de procesarlo. Si el procesado falla, el
webhook responde 202 (no un error, para que ManyChat no reintente en bucle), el
payload queda en la bandeja de **Conexiones** con el motivo, y se puede
reprocesar en un clic después de arreglar la configuración.

La idempotencia va por `transaction_id` / `event_id` / `uri`: un reenvío del
mismo evento no duplica ventas.

---

## Instagram

En **Conexiones** se pega el `ig_user_id` de la cuenta Business y un
`access_token` con `instagram_basic` + `instagram_manage_insights`. Con eso, el
botón "Sincronizar Instagram" trae reels y posts con título, portada, fecha y
métricas, y enriquece los contenidos que ya se habían creado solos por webhook
sin perder la atribución acumulada.

**Sin token todo sigue funcionando**: los contenidos se crean con el
`ig_media_id`, solo que sin portada ni título bonito.

Un aviso honesto sobre el alcance: leer tus propios contenidos y métricas es lo
que hace esto. **Responder DMs desde el CRM** (un ManyChat propio) es otra cosa:
exige la Instagram Messaging API, revisión de app de Meta y verificación de
negocio. El esquema ya tiene la tabla `mensajes` preparada para ello, pero no
está construido.

---

## Multi-cuenta

Todas las tablas llevan `cuenta_id` desde la primera migración y las credenciales
viven en base de datos por cuenta, no en variables de entorno. Hoy hay una sola
cuenta y el producto se comporta como si fueras el único usuario. El día que
entre un segundo infoproductor es activar pantallas, no reescribir el backend.

Lo que **no** está hecho, porque hoy no hace falta: facturación, planes, límites
de uso, onboarding de clientes y permisos entre empresas.

---

## Integraciones y extensiones

- **Lógica de infoproducción** (ángulos, roles de contenido, score de lead,
  grados DSBA, objetivo del mes): ver `docs/infoproduccion.md`. Destilada de las
  playbooks del sector y del vídeo de Lautaro Barruffaldi (`docs/video-transcripcion.md`).
- **Webhooks de salida**: el CRM avisa a otras apps (Zapier, Make, n8n, Slack, tu
  backend) cuando pasa algo, con firma HMAC y reintentos. Se gestionan en
  **Conexiones → Webhooks de salida**.
- **Servidor MCP** (`mcp/`): conecta tu propio Claude (Desktop o Code) al CRM con
  una API key y trabaja sobre tus datos por lenguaje natural. Instrucciones en
  `mcp/README.md`.

## Estructura

```
server/
  src/
    db/
      migrations/001_init.sql   esquema completo (20 tablas)
      migrate.ts                runner de migraciones
      seed.ts                   datos de demo de ~90 días
      pool.ts
    modules/
      atribucion.ts   ← el motor de atribución
      ingesta.ts      ← normalización y recepción de webhooks
      eventos.ts      ← registro de eventos y hitos del embudo
      pipeline.ts     ← oportunidades y movimientos de etapa
      reglas.ts       ← motor de reglas
      analitica.ts    ← consultas del panel
      instagram.ts    ← Graph API
      leads.ts, cuentas.ts
    routes/           API HTTP
    lib/              auth, errores, utilidades
  tests/              51 tests de integración contra Postgres real
web/
  src/
    paginas/          Panel, Contenidos, Pipeline, Leads, Automatizaciones,
                      Reglas, Conexiones
    componentes/      Gráficas, FichaLead, Cabecera
```

## Comandos

```bash
cd server && npm test
```

```bash
cd server && npm run migrate:reset
```

```bash
cd web && npm run build
```

Los tests corren contra una base de datos aparte (`DATABASE_URL_TEST`), que se
recrea limpia en cada ejecución. Cada archivo de test trabaja sobre su propia
cuenta, así que verifican también el aislamiento multi-cuenta.

---

## Decisiones que conviene conocer

**La analítica filtra por cohorte, no por fecha del evento.** Cuando eliges "90
días" en el panel, filtra por *cuándo entró el lead* y cuenta todo lo que hizo
después, aunque la venta llegara más tarde. Es la única forma honesta de medir el
retorno de un reel.

**Primer toque vs último toque.** El primero mide qué contenido *capta*; el
segundo, qué contenido *empuja*. La tabla de contenidos los alterna.

**Una venta no cierra al lead.** Cierra la oportunidad. Si el mismo lead vuelve a
comprar, se abre una oportunidad nueva y el `valor_total` del lead suma las dos.

**Los importes se devuelven como número, no como texto.** Postgres devuelve
`numeric` como string para no perder precisión; aquí se convierte en el pool,
porque los importes de un infoproducto caben de sobra en un double.
