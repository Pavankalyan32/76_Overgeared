# Multi-stage Docker build for Tesseract
# Stage 1: Builder - install dependencies
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY jnnce-1/server/package*.json ./server/
COPY package*.json ./

# Install server dependencies (including dev for tests)
RUN cd server && npm ci

# Stage 2: Production - minimal runtime
FROM node:22-alpine AS production

# Add non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

WORKDIR /app

# Copy built dependencies from builder
COPY --from=builder --chown=nodejs:nodejs /app/server/node_modules ./server/node_modules
COPY --from=builder --chown=nodejs:nodejs /app/server/package*.json ./server/
COPY --chown=nodejs:nodejs jnnce-1 ./jnnce-1

# Create necessary directories
RUN mkdir -p /app/logs && chown nodejs:nodejs /app/logs

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start server
CMD ["node", "--env-file-if-exists=.env", "jnnce-1/server/index.js"]