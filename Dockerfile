# ── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only package files first (layer cache)
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: run as non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY server ./server
COPY public ./public
COPY package.json ./

# Set ownership
RUN chown -R appuser:appgroup /app
USER appuser

# App runs on port 3000
EXPOSE 3000

# Health check — pings the server every 30s
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

# Start the server
CMD ["node", "server/index.js"]
