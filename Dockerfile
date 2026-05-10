# Multi-stage Dockerfile for the unified instanode.dev site (marketing + dashboard).
# Stage 1 builds the React+Vite SPA, stage 2 serves the static output via nginx.

# ─── Stage 1 — build ─────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install deps (cached layer).
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Build the SPA. Vite emits SPA index.html + asset bundles + everything in /public.
COPY . .
RUN npm run build

# ─── Stage 2 — serve ─────────────────────────────────────────────────────
FROM nginx:1.27-alpine
WORKDIR /usr/share/nginx/html

# Strip default nginx config.
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/instanode.conf

# Copy build output.
COPY --from=builder /app/dist/ /usr/share/nginx/html/

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
