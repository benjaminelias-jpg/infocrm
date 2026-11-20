# Kit de UI de InfoCRM — cómo usarlo

Importar siempre desde el barril: `import { Boton, Dialogo, ... } from '../ui';`

## Reglas de la casa
- **Español rioplatense con voseo** ("tocá", "elegí", "guardá"). Cero jerga técnica en lo que ve el usuario.
- **REGLA DEL DUEÑO, SIN EXCEPCIONES: cero ventanas emergentes del navegador.** Nada de `window.prompt`, `window.confirm`, `alert` ni `beforeunload`. Para pedir datos usar `Dialogo` (en el celular es una hoja que sube desde abajo) o un formulario inline. Para confirmar algo destructivo usar `BotonConfirmar` (doble toque en el mismo botón). Para no perder cambios, guardar un borrador (localStorage) y ofrecer recuperarlo.
- **Estilo Kommo: compacto, simple, básico.** El dueño prefiere tarjetas chicas con la info justa (ver `paginas/Pipeline.tsx`: quién lo atiende + cuándo / @usuario en azul / etiquetas) antes que tarjetas grandes llenas de controles. Las acciones secundarias van en un menú "⋯", no a la vista en cada tarjeta.
- **Feedback con `useAviso()`** (avisos flotantes) en vez de banners que empujan el contenido: `const aviso = useAviso(); aviso.exito('Guardado'); aviso.error(e.message)`. Se puede ofrecer deshacer: `aviso.exito('Borrado', { texto: 'Deshacer', onClick })`.
- **Crear donde está la lista**: el "+" va al lado del título de lo que se crea (`TituloSeccion onMas`) o al lado del selector (`SelectorConMas`). En el celular la acción principal puede ir en `BotonFlotante`.
- **Deslizar en el celular**: tarjetas en fila → `Carrusel` (con `soloMovil` si en escritorio deben ser grilla); filtros → `FilaChips` + `Chip`; pestañas → `Pestanas` + `ContenidoDeslizable` (se cambia de pestaña deslizando el dedo); listas con acciones → `FilaDeslizable`.
- **Mucho contenido → plegar**: `Desplegable` (con `clave` recuerda si quedó abierto) y `ListaDesplegable` (muestra N y "Ver todos").
- **Tablas → `TablaResponsiva`** (tabla en escritorio, tarjetas en el celular). Marcar qué columna es `titulo`, `subtitulo`, `esquina` (monto) y cuáles `ocultar` en el celular.
- **Cargando → `EsqueletoPantalla`** (o `Esqueleto`) con la forma del contenido; **vacío → `Vacio`** que explica qué hacer y trae un botón de acción.
- **Estilo visual (el que eligió el dueño, del HTML de Kunfupay):** tipografía Plus Jakarta Sans (ya cargada), fondo gris frío (`--page-plane`), tarjetas blancas sin borde marcado (`.tarjeta`, `--surface-1`), grises sólidos para lo secundario (`--surface-2`, hover `--surface-3`), **violeta para la acción** (`--accion` en fondos de botones; `--series-1` en textos, líneas y gráficos), **«tinta» para lo activo** (`--ink` / `--on-ink`: ítem activo del menú, chip de filtro activo, avisos), lavanda para lo destacado (`--tint` con texto `--tint-texto`). Verde de texto: `--bien-texto` (el `--status-good` es para puntos y fondos). Sombras solo en lo flotante (`--sombra-flotante`); vidrio en lo que flota sobre el contenido (`.ui-vidrio`). Todo tiene su versión en **modo oscuro**: no uses colores fijos.
- **NADA de «pastillas» 100 % redondeadas** (pedido explícito del dueño: «que sea más leve»): chips y botones 10–12 px de radio, insignias y contadores 6 px, tarjetas 18 px, diálogos 20 px (la escala de Tailwind ya está suavizada: `rounded-lg` 10, `rounded-xl` 14, `rounded-2xl` 20). `rounded-full` solo para círculos de verdad (avatares, puntos de color, interruptores, íconos redondos). El recorrido `scratchpad/e2e/recorrido.mjs` avisa si aparece una pastilla.
- Colores solo con variables CSS (`--accion`, `--series-1`, `--status-good/warning/critical`, `--text-primary/secondary/muted`, `--surface-1/2/3`, `--page-plane`, `--ink`, `--tint`, `--border-hairline`).
- Tamaños táctiles: los controles del kit ya miden 40 px en el celular y 32–36 px en escritorio. No achicarlos.

## Componentes
| Componente | Para qué |
|---|---|
| `Boton` (`variante`: primario (violeta), secundario (gris sólido), tinta (negro), peligro, fantasma, exito; `tamano`: xs, sm, md; `icono`, `cargando`) | Todo botón. Un solo primario por zona. |
| `BotonIcono` (`etiqueta` obligatoria) | Botones solo-ícono (✕, ⋯, flechas). |
| `BotonConfirmar` | Borrar/quitar sin ventana emergente. |
| `Campo` + `Entrada` / `AreaTexto` / `Seleccion` | Formularios (etiqueta, ayuda, error). |
| `Interruptor` | Activo / en pausa. |
| `Buscador` | Búsqueda con lupa y ✕ para limpiar. |
| `Dialogo` (`titulo`, `descripcion`, `pie`, `ancho`, `autoFoco`) | Formularios cortos, guías y confirmaciones importantes. En guías largas `autoFoco={false}` (si no, en el celular abre el teclado). El encabezado y el `pie` quedan fijos (el botón principal siempre a la vista); en el celular la hoja se cierra arrastrándola hacia abajo; Escape cierra solo la capa de arriba. |
| `Menu` + `ItemMenu` + `SeparadorMenu` | Menú "⋯ Más" y desplegables de acciones. En el celular sale desde abajo. |
| `SelectorConMas` (`onCrear(nombre)` o `onNuevo()` para abrir tu propio diálogo) | Elegir "cuál" (pipeline, curso…) con lista desplegable + "+" para crear ahí mismo. |
| `Desplegable`, `ListaDesplegable`, `Chevron` | Plegar/desplegar. |
| `Pestanas`, `ContenidoDeslizable` | Pestañas deslizables + cambiar con el dedo. |
| `Carrusel` (`soloMovil`, `columnas`, `anchoItem`) | Filas de tarjetas que se deslizan. |
| `FilaDeslizable` (`acciones`, `accionesInicio`, `completo`, `compacto`, `fondo`) | Deslizar una fila para ver acciones (celular): a la izquierda `acciones`, a la derecha `accionesInicio` (p. ej. «Leído»); con `completo`, deslizar casi toda la fila ejecuta la primera acción. Abrir una cierra la anterior. En escritorio, al pasar el mouse (`compacto` = solo íconos). |
| `useDeslizar` | Detectar el gesto de deslizar en cualquier elemento. |
| `TablaResponsiva` (`accionesFila`) | Tablas que en el celular son tarjetas. `accionesFila(f)`: botones de la fila (última columna / pie de la tarjeta) que no abren la fila. |
| `TituloSeccion` (`onMas`) | Encabezado de sección con "+" al lado. |
| `Vacio`, `Esqueleto`, `EsqueletoPantalla` | Estados vacíos y de carga. |
| `Insignia` (`tono`), `Estado` (`tipo`, `valor`), `Chip`, `FilaChips` | Estados, etiquetas, filtros. `<Estado tipo="venta" valor={v.estado} />` dice el estado de la base en palabras y con su color (textos.ts). |
| `BotonFlotante` | Acción principal en el celular. |
| `Copiar` | Copiar al portapapeles con "✓ Copiado". |
| `PasosGuiados`, `Verificacion`, `TarjetaIntegracion` | Integraciones guiadas paso a paso con verificación en vivo. `TarjetaIntegracion` es fila compacta en el celular y tarjeta de grilla desde sm. Ver `componentes/integraciones/` (`PruebaEnVivo`: escucha 2 min y explica causas si no llega nada). |
| `useAviso`, `ProveedorAvisos` | Avisos flotantes (ya está montado en App). |
| `useEsMovil` | Saber si la pantalla es de celular (< 640 px). |
| `useCarga(fn, deps)` → `{ datos, setDatos, cargando, error, recargar }` + `ErrorCarga` | Cargar datos de una pantalla sin "Cargando…" eterno ni pantalla en blanco: si falla, `<ErrorCarga error={error} onReintentar={recargar} />`. Descarta respuestas viejas. |
| `IdentidadLead` (`id`, `nombre`, `usuario`, `foto`, `pais`, `tam` sm/md, `onClick`, `derecha`) y `Avatar` | Un lead se ve IGUAL en toda la app: avatar (foto o iniciales con color fijo), nombre y @usuario. Respaldo: nombre → @usuario → "Lead sin nombre" (`nombreVisible`). |
| `Ayuda` (`titulo`) | ⓘ que explica un KPI, columna o campo. Reemplaza a `title=` (que en el celular no se ve): globito en escritorio, hoja en el celular. |
| `BarraProgreso` (`valor`, `meta`, `ritmo` 0..1) | Avance hacia una meta con la marca de "dónde deberías estar hoy" y color según el ritmo. |
| `Banner` (`tono` info/aviso/error/exito, `accion`, `onCerrar`) | Aviso FIJO de una pantalla (no se va solo): "Instagram no está conectado · Conectar". Para lo pasajero, `useAviso`. |
| `useParamUrl(clave, porDefecto, { apilar })` | Pestaña, filtro o subvista guardados en la URL (`?tab=cobros`): sobreviven a recargar y Atrás funciona. Por defecto reemplaza (no llena el historial). |
| `useTema` | Tema claro / oscuro / automático (ya está en el menú de cuenta). |

## Piezas de la app (fuera del kit)
- `api.ts`: `api()` ya traduce los errores ("No hay conexión…", errores del servidor) y maneja la sesión vencida (vuelve al login y después a la misma pantalla). Formato: `fmtNum` (5.988), `fmtDinero` (moneda de la cuenta), `fmtPct` (2,9 %), `fmtDecimal` (8,4), `plural(n, 'lead')`, `fmtFecha` ("18 nov", con hora "18 nov, 14:05"), `hace` ("hace 3 días"). Nunca imprimir números crudos ni `toFixed` (usa punto).
- `textos.ts`: `textoDe('venta', 'en_cuotas')` → "En cuotas" y `tonoDe(...)` para la `Insignia`. NUNCA mostrar valores de la base tal cual ("closer_setter", "lead_creado").
- `componentes/useFicha.ts`: la ficha del lead la dibuja el marco de la app con `?ficha=<id>`. Abrila con `useFicha().abrir(id)`; Atrás la cierra. No renderizar `FichaLead` a mano en las páginas.
- Subpantallas con URL propia: `/chat/:leadId` (conversación abierta) y `/flujos/:flujoId` (pizarra). En el celular esas rutas ocultan la barra inferior: la pantalla tiene que traer su propio botón "volver".
- `componentes/Iconos.tsx`: íconos de línea (`mas`, `cerrar`, `volver`, `siguiente`, `puntos`, `buscar`, `sincronizar`, `sol`, `luna`, `monitor`, `salir`, `reglas` = engranaje, etc.). En controles, ícono SVG en vez de emoji o glifo de texto.
- Pantallas de alto completo: clase `alto-app` (descuenta la barra inferior del celular). El marco agrega solo el espacio abajo en las demás.
- `Cabecera`: en el celular el subtítulo pasa a un ⓘ al lado del título. Subtítulos cortos.
- `componentes/TextoConVariables.tsx`: texto de un mensaje con «+ Nombre / + @usuario», contador y «Así le llega». Usalo para cualquier mensaje que se le manda a un lead.
- `componentes/BuscadorGlobal.tsx`: «Buscar lead… ⌘K» desde cualquier pantalla (ya montado en el marco).
- Pantallas por rol: el setter ve Chat, Pipeline, Leads y Contenidos; el closer, Pipeline, Chat y Leads; dueño y admins, todo (App.tsx `permitidos`).
- Cada pantalla se descarga cuando se usa (React.lazy en App.tsx) y después se precargan las demás: no importes páginas entre sí.
