# La lógica de infoproducción del CRM

Este documento explica la "capa de infoproducción" (migración `002`): qué método
real hay detrás de cada decisión del CRM y cómo se traduce en datos y pantallas.

El objetivo que persigue todo esto: que el CRM no solo diga **de qué reel** viene
una venta, sino **de qué tipo de contenido** y **con qué calidad de lead** — que
es como de verdad se decide qué grabar y a quién atender en infoproducción.

> **Fuentes.** La lógica está destilada de dos playbooks del sector: el método de
> captación orgánica por Instagram de **Ramiro Cubria** (ángulos, filtro
> antipodridos, flujo de DM, trazabilidad 70-20-10) y el sistema de **roles de
> cartera** de creativos de Meta Ads (prospector/closer/caballo/lastre), adaptado
> de pauta a contenido orgánico. Pendiente de reconciliar con el vídeo de Lautaro
> Barruffaldi que no se pudo transcribir desde el contenedor (ver el final).

---

## 1. Ángulos y embudo

En infoproducción no todo el contenido hace el mismo trabajo. Cada pieza tiene un
**ángulo**, y el ángulo marca su posición en el embudo:

| Ángulo | Embudo | Qué hace |
|---|---|---|
| Vídeo abierto | TOFU | Alcance masivo, público frío |
| Problema | MOFU | Filtra: da el QUÉ, retiene el CÓMO |
| Solución | MOFU | Autoridad técnica: enseña el CÓMO |
| Producto / caso | BOFU | Prueba social, empuja a la acción |
| Mentalidad | transversal | Desbloquea objeciones |
| Narrativa de autoridad | transversal | Posicionamiento |

**En el CRM:** `contenidos.angulo` y `contenidos.etapa_embudo` (derivada sola del
ángulo). En el panel, la sección **"De qué ángulo viene el dinero"** suma leads,
reuniones, ventas e ingresos por ángulo. Así se ve que el contenido BOFU cierra
y el TOFU capta: dos trabajos distintos que no se juzgan con la misma vara.

El ángulo se asigna en la pantalla de **Contenidos** (selector por fila) o puede
venir en el webhook. La etapa del embudo se recalcula sola al cambiar el ángulo.

---

## 2. Roles de contenido (cartera, no ranking)

Un reel con 184.000 reproducciones y 44 leads pero **cero ventas** no es "malo":
puede ser un **prospector** que compra la atención que otro contenido convierte.
Juzgar todo el contenido por las ventas vacía la estrategia. Cada rol se mide con
**su** métrica.

El CRM clasifica cada contenido solo, según su share de leads y su tasa
lead→venta frente a la mediana de la cuenta:

| Rol | Cómo se detecta | Cómo se juzga |
|---|---|---|
| **Caballo de batalla** | Mucho volumen + conversión sana | Sostiene la cuenta; protégelo |
| **Closer** | Pocos leads, conversión altísima | Dale más alcance |
| **Prospector** | Mucho volumen, poca conversión | Por alcance y leads, **no** por ventas |
| **Lastre** | Ni volumen ni conversión | Candidato a dejar de priorizar |
| **Explorador** | Aún sin datos suficientes (<10 leads) | Déjalo correr |

**En el CRM:** calculado al vuelo en `clasificarRoles` (no se almacena, siempre
está fresco). Se muestra como etiqueta en Contenidos y en el panel. Los umbrales
son **heurísticas accionables**, no una prueba estadística — con ciclos largos y
pocas conversiones por pieza, la significancia por contenido es inalcanzable; el
sistema sirve para decidir qué producir, no para demostrar nada.

Hay un override manual (`contenidos.rol_manual`) por si quieres fijar el rol.

---

## 3. Score del lead (filtro antipodridos)

El recurso gratis atrae a muchos, pero solo unos pocos "levantan la mano". El
**filtro antipodridos** del método separa al lead calificado del cazador de
freebies. El CRM lo hace con un **score 0-100 transparente**: cada punto viene con
su motivo, auditable en la ficha del lead.

Suman: dejó email/teléfono, respondió por DM, dio datos de calificación (modelo de
negocio, ingresos, cuello de botella), agendó/asistió a reunión, compró, y el
ángulo del contenido de origen (más intención cuanto más abajo en el embudo).

- `leads.score` + `leads.score_detalle` (el desglose).
- `leads.calificacion`: `sin_calificar` → se auto-promueve a `calificado` con
  score ≥ 45. **Nunca pisa una decisión humana:** si marcas a mano `no_calificado`,
  ahí se queda.
- Datos de descubrimiento: `leads.modelo_negocio`, `ingresos_aprox`,
  `cuello_botella` (los captura el webhook desde los `custom_fields` de ManyChat,
  o se editan a mano).

El score se recalcula tras cada evento del lead y al editar sus datos.

---

## 4. Flujo de DM y seguimientos

El método estructura la conversación de DM en pasos: **apertura → calificación →
dolor → solución → cierre**, más 7-12 seguimientos de valor, con una maduración
típica de **90-127 días**. Esto es más fino que la etapa "En conversación" del
pipeline de llamada y convive con ella.

**En el CRM:** `oportunidades.dm_paso`, `seguimientos` y `proximo_seguimiento_en`
(API `PATCH /api/oportunidades/:id`). La etapa dice *dónde está en el embudo*; el
`dm_paso` dice *por dónde va la conversación*.

> Como la maduración es larga, cuidado con marcar un lead como frío demasiado
> pronto: 90-127 días es lo normal, no un lead perdido.

---

## 5. Mezcla 70-20-10 y madurez de la muestra

La regla del método: **70%** explotar ángulos validados, **20%** variaciones,
**10%** apuestas nuevas, y **nunca decidir con menos de 3 meses de datos**.

**En el CRM:** `mezclaContenido` calcula los días de muestra y avisa en el panel
cuando son menos de 90 días: *"no tomes decisiones de contenido definitivas
todavía"*. Evita que optimices sobre ruido de una semana.

---

## Qué se añadió, en una frase por fichero

- `migrations/002_infoproduccion.sql` — columnas nuevas (todas aditivas).
- `modules/infoproduccion.ts` — ángulo→embudo, score, roles, analítica por ángulo.
- `eventos.ts` / `ingesta.ts` / `leads.ts` — recálculo de score y captura de
  datos de calificación.
- `routes/analitica.ts` — endpoints `/analitica/angulos` y roles en `/contenidos`.
- `routes/contenidos.ts` / `crm.ts` — editar ángulo, filtros, paso de DM.
- Panel: sección de ángulos; Contenidos: ángulo + rol; Leads: score + filtro;
  ficha: desglose del score y datos de calificación.

---

## Reconciliado con el vídeo de Lautaro Barruffaldi (migración 004)

El vídeo *"Si no Tenes Este Sistema en 2026, Estás Quedando Fuera"* se transcribió
(está en `video-transcripcion.md`). **Confirma la tesis del CRM**: es el mismo
sistema ManyChat → webhook → CRM → atribución "de qué vídeo viene cada venta"
(ellos lo hacen a mano con Airtable; aquí está automatizado). Lo distintivo que
aportaba se incorporó en la migración `004`:

- **Calificación por grados ("DSBA")**: tres criterios que marca el setter →
  grado D/S/B/A (0,1,2,3 criterios cumplidos). Convive con el score conductual:
  el grado es el juicio explícito, el score es el comportamiento medido.
  (`leads.calif_c1/c2/c3`, `leads.grado`; criterios editables en `cuentas.criterios_calif`.)
- **Tipo de pago**: de qué contenido viene quien paga completo (PIF) vs en cuotas,
  y quién dejó de pagar. (`oportunidades.tipo_pago`, `pago_completado`.)
- **Objetivo y estado del contenido**: venta/audiencia/alcance (intención del autor,
  complementa el rol medido) y probando/posible/comprobado (ciclo de prueba).
  (`contenidos.objetivo`, `estado_validacion`.)
- **Objetivo del mes** con progreso real. (`metas`; widget en el panel y tool MCP
  `objetivo_del_mes`.)

Pendiente menor que el vídeo menciona y no se construyó (bajo valor / nicho): la
tasa de caída (drop-off) por diapositiva de historias. Es aditivo cuando se quiera.

Toda esta capa es editable sin tocar el esquema: ángulos, roles, pesos del score,
criterios de grado y pasos de DM son datos o constantes, no estructura.
