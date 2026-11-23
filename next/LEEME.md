# InfoCRM en Next.js

Versión Next.js (App Router) del CRM, lista para meter en el repo de Kunfupay.

- **Pantallas:** las mismas de `../web/src` (React). Next las sirve en `app/[[...slug]]/page.tsx` como SPA (solo en el navegador).
- **Servidor:** el mismo de `../server/src`, empaquetado en `lib/crm-server.mjs` y montado en las rutas de API de Next
  (`app/api/[...ruta]/route.ts`). Toda la lógica, la base y los 267 tests son los mismos.
- **Rutas públicas** que llaman Meta y otras apps (`/webhooks/*`, `/instagram/*`, `/recursos/pub/*`, `/mcp`, `/salud`) se redirigen al servidor en `next.config.mjs`.
- **Sin login:** con `SIN_LOGIN=1` entra directo como el dueño de la cuenta.

## Correr

```bash
cp .env.example .env.local   # completar
npm install
npm run migrar               # crea/actualiza las tablas (usa ../server)
npm run dev                  # http://localhost:3000
```

`npm run build && npm start` para producción (Vercel la detecta como app Next).

## Meterlo en el repo de Kunfupay

Copiar las tres carpetas `web/src`, `server/src` (con `server/src/db/migrations`) y `next/` respetando la misma
estructura (o ajustar las rutas `../web` y `../server` en `next.config.mjs`, `tailwind.config.mjs`,
`app/layout.tsx`, `app/[[...slug]]/page.tsx` y `scripts/preparar-servidor.mjs`).
Si se monta bajo un subcamino (ej. `/crm`), agregar `basePath: '/crm'` en `next.config.mjs`.
