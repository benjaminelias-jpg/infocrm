# =====================================================================
# InfoCRM — un solo contenedor: API Fastify + panel React + migraciones
# =====================================================================

# --- Etapa 1: compilar el panel ---
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Etapa 2: imagen final (API que sirve también el panel) ---
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

# Dependencias del servidor (incluye tsx para ejecutar TS directamente)
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci

# Código del servidor y panel compilado
COPY server/ ./server/
COPY --from=web /web/dist ./web/dist

# El servidor arranca, migra y sirve. WEB_DIST apunta al panel compilado.
ENV WEB_DIST=/app/web/dist
ENV HOST=0.0.0.0
ENV PORT=4000
EXPOSE 4000
WORKDIR /app/server
CMD ["npm", "start"]
