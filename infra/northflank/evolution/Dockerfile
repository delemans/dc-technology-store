# Evolution API 2.3.7 + parche @bot de DC Tecnology (ver parche-bot.mjs).
# La construye GitHub Actions (.github/workflows/imagen-evolution.yml) y la publica en ghcr.io/delemans/dc-evolution.
# Mismos pasos que el Dockerfile oficial de Evolution 2.3.7, partiendo del código de la etiqueta 2.3.7.
FROM node:24-alpine AS builder

RUN apk update && apk add --no-cache git ffmpeg wget curl bash openssl dos2unix

WORKDIR /evolution
RUN git clone --depth 1 --branch 2.3.7 https://github.com/EvolutionAPI/evolution-api.git . && rm -rf .git

COPY parche-bot.mjs /tmp/parche-bot.mjs
RUN node /tmp/parche-bot.mjs

RUN npm ci --silent
RUN cp ./.env.example ./.env
RUN chmod +x ./Docker/scripts/* && dos2unix ./Docker/scripts/*
RUN ./Docker/scripts/generate_database.sh
RUN npm run build

FROM node:24-alpine AS final

RUN apk update && apk add --no-cache tzdata ffmpeg bash openssl

ENV TZ=America/Bogota
ENV DOCKER_ENV=true

WORKDIR /evolution

COPY --from=builder /evolution/package.json ./package.json
COPY --from=builder /evolution/package-lock.json ./package-lock.json
COPY --from=builder /evolution/node_modules ./node_modules
COPY --from=builder /evolution/dist ./dist
COPY --from=builder /evolution/prisma ./prisma
COPY --from=builder /evolution/manager ./manager
COPY --from=builder /evolution/public ./public
COPY --from=builder /evolution/.env ./.env
COPY --from=builder /evolution/Docker ./Docker
COPY --from=builder /evolution/runWithProvider.js ./runWithProvider.js
COPY --from=builder /evolution/tsup.config.ts ./tsup.config.ts

LABEL org.opencontainers.image.source="https://github.com/delemans/dc-technology-store"
LABEL org.opencontainers.image.description="Evolution API 2.3.7 con el parche @bot de DC Tecnology"

EXPOSE 8080

ENTRYPOINT ["/bin/bash", "-c", ". ./Docker/scripts/deploy_database.sh && npm run start:prod" ]
