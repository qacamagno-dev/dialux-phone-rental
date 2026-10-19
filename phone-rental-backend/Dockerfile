# ============================================================
# DiaLux — production image
#
# Build context is the REPOSITORY ROOT, not this folder: the Express server
# also serves the static frontend from ../../phone-rental-frontend, so both
# halves have to be in the image.
#
#   docker build -f phone-rental-backend/Dockerfile -t dialux .
#   docker run --rm -p 5000:5000 --env-file phone-rental-backend/.env dialux
#
# docker-compose.yml at the repo root does this for you, along with MongoDB.
# ============================================================

# ---------- stage 1: production dependencies ----------
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only the manifests first so this layer is cached until they change.
COPY phone-rental-backend/package.json phone-rental-backend/package-lock.json ./

# npm ci installs exactly what the lockfile pins — no drift between builds.
RUN npm ci --omit=dev

# ---------- stage 2: runtime ----------
FROM node:20-alpine

ENV NODE_ENV=production \
    PORT=5000

# dumb-init reaps zombies and forwards SIGTERM, so `docker stop` actually
# stops Node instead of waiting out the 10-second timeout.
RUN apk add --no-cache dumb-init

WORKDIR /app

# Never run the server as root.
RUN addgroup -S dialux && adduser -S dialux -G dialux

COPY --from=deps --chown=dialux:dialux /app/node_modules ./phone-rental-backend/node_modules
COPY --chown=dialux:dialux phone-rental-backend/package.json ./phone-rental-backend/package.json
COPY --chown=dialux:dialux phone-rental-backend/src ./phone-rental-backend/src
COPY --chown=dialux:dialux phone-rental-frontend ./phone-rental-frontend

USER dialux

EXPOSE 5000

# The health endpoint reports the Mongo connection state as well as liveness,
# so an orchestrator restarts a container that has lost its database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.ok&&j.db==='connected'?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "phone-rental-backend/src/index.js"]
