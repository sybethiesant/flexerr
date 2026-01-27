# Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Production image
FROM node:20-alpine
WORKDIR /app

# Install ffmpeg, VAAPI libraries for GPU encoding, and dependencies for dovi_tool
RUN apk add --no-cache ffmpeg curl libva libva-intel-driver mesa-va-gallium

# Install dovi_tool from GitHub releases
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then \
      curl -L -o /tmp/dovi_tool.tar.gz https://github.com/quietvoid/dovi_tool/releases/download/2.1.2/dovi_tool-2.1.2-x86_64-unknown-linux-musl.tar.gz && \
      tar -xzf /tmp/dovi_tool.tar.gz -C /usr/local/bin && \
      rm /tmp/dovi_tool.tar.gz; \
    elif [ "$ARCH" = "aarch64" ]; then \
      curl -L -o /tmp/dovi_tool.tar.gz https://github.com/quietvoid/dovi_tool/releases/download/2.1.2/dovi_tool-2.1.2-aarch64-unknown-linux-musl.tar.gz && \
      tar -xzf /tmp/dovi_tool.tar.gz -C /usr/local/bin && \
      rm /tmp/dovi_tool.tar.gz; \
    fi && \
    chmod +x /usr/local/bin/dovi_tool 2>/dev/null || true

# Install production dependencies
COPY backend/package*.json ./backend/
WORKDIR /app/backend
RUN npm install --omit=dev

# Copy backend source
COPY backend/ ./

# Copy built frontend
COPY --from=frontend-builder /app/frontend/build ../frontend/build

# Create data directory
RUN mkdir -p /app/data

# Environment
ENV NODE_ENV=production
ENV PORT=3100
ENV DATA_PATH=/app/data

# Expose port
EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/api/health || exit 1

# Start
CMD ["node", "server.js"]
