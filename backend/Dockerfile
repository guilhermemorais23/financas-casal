FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# O Cloud Run define a $PORT sozinho (padrão 8080); o app já lê ela do
# ambiente (ver src/config/env.ts), então não precisa fixar um valor aqui.
CMD ["node", "dist/index.js"]
