# Kit de UI de InfoCRM — cómo usarlo

Importar siempre desde el barril: `import { Boton, Dialogo, ... } from '../ui';`

## Reglas de la casa
- **Español rioplatense con voseo** ("tocá", "elegí", "guardá"). Cero jerga técnica en lo que ve el usuario.
- **Nada de `window.prompt` / `window.confirm` / `alert`.** Para pedir datos usar `Dialogo` (en el celular es una hoja que sube desde abajo) o un formulario inline. Para confirmar algo destructivo usar `BotonConfirmar` (doble toque en el mismo botón).
- **Feedback con `useAviso()`** (avisos flotantes) en vez de banners que empujan el contenido: `const aviso = useAviso(); aviso.exito('Guardado'); aviso.error(e.message)`. Se puede ofrecer deshacer: `aviso.exito('Borrado', { texto: 'Deshacer', onClick })`.
- **Crear donde está la lista**: el "+" va al lado del título de lo que se crea (`TituloSeccion onMas`) o al lado del selector (`SelectorConMas`). En el celular la acción principal puede ir en `BotonFlotante`.
- **Deslizar en el celular**: tarjetas en fila → `Carrusel` (con `soloMovil` si en escritorio deben ser grilla); filtros → `FilaChips` + `Chip`; pestañas → `Pestanas` + `ContenidoDeslizable` (se cambia de pestaña deslizando el dedo); listas con acciones → `FilaDeslizable`.
- **Mucho contenido → plegar**: `Desplegable` (con `clave` recuerda si quedó abierto) y `ListaDesplegable` (muestra N y "Ver todos").
- **Tablas → `TablaResponsiva`** (tabla en escritorio, tarjetas en el celular). Marcar qué columna es `titulo`, `subtitulo`, `esquina` (monto) y cuáles `ocultar` en el celular.
- **Cargando → `EsqueletoPantalla`** (o `Esqueleto`) con la forma del contenido; **vacío → `Vacio`** que explica qué hacer y trae un botón de acción.
- Colores solo con variables CSS (`var(--series-1)` acción, `--status-good/warning/critical`, `--text-primary/secondary/muted`, `--surface-1`, `--page-plane`, `--border-hairline`). Tienen que verse bien en **modo oscuro**.
- Tamaños táctiles: los controles del kit ya miden 40 px en el celular y 36 px en escritorio. No achicarlos.

## Componentes
| Componente | Para qué |
|---|---|
| `Boton` (`variante`: primario, secundario, peligro, fantasma, exito; `tamano`: xs, sm, md; `icono`, `cargando`) | Todo botón. Un solo primario por zona. |
| `BotonIcono` (`etiqueta` obligatoria) | Botones solo-ícono (✕, ⋯, flechas). |
| `BotonConfirmar` | Borrar/quitar sin ventana emergente. |
| `Campo` + `Entrada` / `AreaTexto` / `Seleccion` | Formularios (etiqueta, ayuda, error). |
| `Interruptor` | Activo / en pausa. |
| `Buscador` | Búsqueda con lupa y ✕ para limpiar. |
| `Dialogo` (`titulo`, `descripcion`, `pie`) | Formularios cortos y confirmaciones importantes. |
| `Menu` + `ItemMenu` + `SeparadorMenu` | Menú "⋯ Más" y desplegables de acciones. En el celular sale desde abajo. |
| `SelectorConMas` | Elegir "cuál" (pipeline, curso…) con lista desplegable + "+" para crear ahí mismo. |
| `Desplegable`, `ListaDesplegable`, `Chevron` | Plegar/desplegar. |
| `Pestanas`, `ContenidoDeslizable` | Pestañas deslizables + cambiar con el dedo. |
| `Carrusel` (`soloMovil`, `columnas`, `anchoItem`) | Filas de tarjetas que se deslizan. |
| `FilaDeslizable` (`acciones`) | Deslizar una fila para ver acciones (celular); hover en escritorio. |
| `useDeslizar` | Detectar el gesto de deslizar en cualquier elemento. |
| `TablaResponsiva` | Tablas que en el celular son tarjetas. |
| `TituloSeccion` (`onMas`) | Encabezado de sección con "+" al lado. |
| `Vacio`, `Esqueleto`, `EsqueletoPantalla` | Estados vacíos y de carga. |
| `Insignia` (`tono`), `Chip`, `FilaChips` | Estados, etiquetas, filtros. |
| `BotonFlotante` | Acción principal en el celular. |
| `Copiar` | Copiar al portapapeles con "✓ Copiado". |
| `PasosGuiados`, `Verificacion`, `TarjetaIntegracion` | Integraciones guiadas paso a paso con verificación en vivo. |
| `useAviso`, `ProveedorAvisos` | Avisos flotantes (ya está montado en App). |
| `useEsMovil` | Saber si la pantalla es de celular (< 640 px). |
