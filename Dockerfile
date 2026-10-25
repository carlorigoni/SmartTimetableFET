# ==============================================================================
# SmartTimetable - Multi-stage Dockerfile per Linux x86_64 / arm64
# Include FET Solutore CLI 7.12.0 e WebApp Python
# Ottimizzato per Synology DSM Container Manager (Docker)
# ==============================================================================

# ------------------------------------------------------------------------------
# STAGE 1: Compilazione nativa del motore solutore fet-cl (FET 7.12.0)
# Usa Ubuntu 24.04 LTS per CMake >= 3.28 e Qt6
# ------------------------------------------------------------------------------
FROM ubuntu:24.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive
ARG FET_VER=7.12.0

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    qt6-base-dev \
    qt6-base-dev-tools \
    curl \
    xz-utils \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN curl -fsSL -o "fet-${FET_VER}.tar.xz" "https://lalescu.ro/liviu/fet/download/fet-${FET_VER}.tar.xz" \
 && tar -xf "fet-${FET_VER}.tar.xz" \
 && cd "fet-${FET_VER}" \
 && find . -name "CMakeLists.txt" -exec sed -i 's/Qt6 6.10/Qt6/g' {} + \
 && sed -i '/qt_generate_deploy_app_script/,$d' src/cl/CMakeLists.txt \
 && cmake -B build -DCOMMAND_LINE_ONLY=ON -DCMAKE_BUILD_TYPE=Release \
 && cmake --build build --config Release -j$(nproc) \
 && cp $(find build -name "fet-cl" -type f) /src/fet-cl \
 && chmod +x /src/fet-cl

# ------------------------------------------------------------------------------
# STAGE 2: Runtime finale Ubuntu 24.04 LTS + Python 3 + librerie Qt per fet-cl
# ------------------------------------------------------------------------------
FROM ubuntu:24.04 AS runner

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOST=0.0.0.0 \
    PORT=8000 \
    TZ=Europe/Rome

# Dipendenze a runtime per fet-cl (Qt6 Core e Network), Python 3, tzdata (fuso orario/ora legale) e curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    libqt6core6t64 \
    libqt6network6t64 \
    ca-certificates \
    curl \
    tzdata \
 && ln -fs /usr/share/zoneinfo/Europe/Rome /etc/localtime \
 && echo "Europe/Rome" > /etc/timezone \
 && rm -rf /var/lib/apt/lists/*

# Copia l'eseguibile compilato fet-cl nel PATH di sistema
COPY --from=builder /src/fet-cl /usr/local/bin/fet-cl

WORKDIR /app

# Copia i sorgenti dell'applicazione
COPY webapp/ /app/webapp/
COPY README.md /app/

# Cartelle dati e run
RUN mkdir -p /app/webapp/data/solver_run /app/webapp/data/snapshots

EXPOSE 8000

# Healthcheck per Docker e Synology Container Manager
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/summary || exit 1

# Volume per persistenza database e orari generati
VOLUME ["/app/webapp/data"]

CMD ["python3", "webapp/server.py"]
