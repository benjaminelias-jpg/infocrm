# InfoCRM MCP — conecta tu Claude a tu CRM

Este servidor MCP expone tu CRM como **herramientas para Claude**. Una vez
conectado, puedes hablarle a tu Claude (Desktop o Code) sobre tu propio CRM:

- *"¿De qué ángulo vinieron más ventas este mes?"*
- *"Busca los leads calificados sin reunión agendada"*
- *"Marca a @ana.coach como venta de 1497€"*
- *"Clasifica el reel X como contenido de producto"*
- *"Dame la ficha de este lead con su score"*

Claude llama a estas herramientas contra **tu** cuenta, con tus permisos y tu
aislamiento de datos, porque se autentica con una API key tuya.

## Herramientas que expone

| Herramienta | Qué hace |
|---|---|
| `resumen` | KPIs (leads, reuniones, ventas, ingresos, tasas) |
| `rendimiento_por_contenido` | Qué reel factura, con su rol (prospector/closer/…) |
| `rendimiento_por_angulo` | De qué ángulo y etapa de embudo viene el dinero |
| `embudo` | Oportunidades por etapa y conversión |
| `buscar_leads` | Filtra leads por texto, etiqueta, calificación, score |
| `lead_detalle` | Ficha completa con score desglosado y timeline |
| `registrar_evento` | Marca recurso/DM/reunión/venta/reembolso |
| `mover_etapa` | Mueve una oportunidad de etapa |
| `clasificar_contenido` | Asigna el ángulo de un contenido |
| `crear_nota` | Deja una nota en un lead |

## 1. Consigue una API key

En el panel del CRM: **Conexiones → Claves de API → Nueva**. Cópiala (se muestra
una sola vez), tiene el formato `ic_xxxx_xxxxxxxx`.

## 2. Conéctalo a Claude Desktop

Edita el archivo de configuración de Claude Desktop:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

Añade el servidor (ajusta la ruta a donde tengas el repo y pon tu API key):

```json
{
  "mcpServers": {
    "infocrm": {
      "command": "npx",
      "args": ["tsx", "/ruta/a/infocrm/mcp/src/index.ts"],
      "env": {
        "INFOCRM_API_URL": "http://localhost:4000",
        "INFOCRM_API_KEY": "ic_tu_clave_aqui"
      }
    }
  }
}
```

Reinicia Claude Desktop. Verás las herramientas de `infocrm` disponibles.

## 3. O conéctalo a Claude Code

```bash
claude mcp add infocrm \
  --env INFOCRM_API_URL=http://localhost:4000 \
  --env INFOCRM_API_KEY=ic_tu_clave_aqui \
  -- npx tsx /ruta/a/infocrm/mcp/src/index.ts
```

## 4. Si tu CRM está en otra máquina

Cambia `INFOCRM_API_URL` por la URL pública de tu API (p. ej.
`https://api.tucrm.com`). La API key viaja en la cabecera `x-api-key` sobre HTTPS.

## Probarlo sin Claude

Con el CRM corriendo y una API key:

```bash
cd mcp
INFOCRM_API_URL=http://localhost:4000 INFOCRM_API_KEY=ic_tu_clave npm start
```

Debería imprimir `InfoCRM MCP conectado a …` y quedarse a la escucha por stdio.

## Seguridad

- La API key da acceso a los datos de **una** cuenta. Trátala como una
  contraseña; revócala desde el panel si se filtra.
- El servidor solo habla con la API del CRM: respeta exactamente lo que esa
  API permite, no toca la base de datos directamente.
- Las herramientas de escritura (`registrar_evento`, `mover_etapa`, …) actúan de
  verdad sobre tu CRM. Claude te pedirá confirmación antes de usarlas según tu
  configuración de permisos.
