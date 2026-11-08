# syntax=docker/dockerfile:1

# ---- build: todas as dependencias, prisma generate e tsc ------------------------------------
FROM node:22-slim AS build
WORKDIR /app
# openssl: o engine do Prisma precisa dele na imagem slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# HUSKY=0: o script "prepare" instala hooks de git, inutil na imagem.
RUN HUSKY=0 npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# Gera dist/main.js (rootDir=src). Tambem serve de alvo para `prisma migrate deploy`
# (docker build --target build), pois o CLI do prisma e dependencia de desenvolvimento.
RUN npx tsc -p tsconfig.build.json

# ---- runtime: so dependencias de producao ----------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
# procps: a vigia de memoria do processo filho de PDF usa `ps` onde nao ha /proc legivel.
# openssl: engine do Prisma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends procps openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# Sem husky em producao: remove o script "prepare" antes do npm ci --omit=dev.
RUN npm pkg delete scripts.prepare \
 && npm ci --omit=dev \
 && npm cache clean --force
# Client gerado no estagio build (o CLI nao existe aqui).
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
# Diretorio privado dos comprovantes; monte um volume aqui. O app tambem exige 0700.
RUN mkdir -p /data/uploads && chown node:node /data/uploads && chmod 700 /data/uploads
ENV UPLOAD_DIR=/data/uploads PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
