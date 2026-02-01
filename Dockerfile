# Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Production image - using Debian for NVIDIA compatibility
# Alpine uses musl libc which doesn't work with NVIDIA drivers
FROM node:20-slim
WORKDIR /app

# Install jellyfin-ffmpeg which has NVENC, VAAPI, QSV, and all hardware encoders
# This is the same ffmpeg used by Jellyfin with full hardware acceleration support
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    wget \
    gnupg \
    && curl -fsSL https://repo.jellyfin.org/jellyfin_team.gpg.key | gpg --dearmor -o /usr/share/keyrings/jellyfin.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/jellyfin.gpg] https://repo.jellyfin.org/debian bookworm main" > /etc/apt/sources.list.d/jellyfin.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends jellyfin-ffmpeg7 \
    && ln -sf /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg \
    && ln -sf /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe \
    && rm -rf /var/lib/apt/lists/*

# Verify ffmpeg installation and show available encoders
RUN ffmpeg -version && echo "--- Encoders ---" && ffmpeg -encoders 2>/dev/null | grep -E "(hevc|h264)" || true

# Install dovi_tool from GitHub releases
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "amd64" ]; then \
      curl -L -o /tmp/dovi_tool.tar.gz https://github.com/quietvoid/dovi_tool/releases/download/2.1.2/dovi_tool-2.1.2-x86_64-unknown-linux-musl.tar.gz && \
      tar -xzf /tmp/dovi_tool.tar.gz -C /usr/local/bin && \
      rm /tmp/dovi_tool.tar.gz; \
    elif [ "$ARCH" = "arm64" ]; then \
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
# NVIDIA Container Toolkit environment (used when --runtime=nvidia is enabled)
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility

# Expose port
EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/api/health || exit 1

# Start
CMD ["node", "server.js"]
