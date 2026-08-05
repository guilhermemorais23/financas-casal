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

# Cloud Run sets $PORT itself (defaults to 8080); the app already reads it
# from env (see src/config/env.ts), so no hardcoded value needed here.
CMD ["node", "dist/index.js"]
