---
title: Architecture & DevOps Pipeline
description: Comprehensive and visual guide to Eurario software architecture, CI/CD pipeline with GitHub and Docker Hub, version management, and automated production updates.
---

# 🏗️ Software Architecture & DevOps Pipeline

Eurario is engineered according to a strict design philosophy: **zero external Python dependencies**, minimal memory footprint, a high-performance native C++ timetabling solver, and an automated Continuous Integration and Continuous Deployment (CI/CD) pipeline ensuring enterprise-grade stability for both turnkey cloud environments and on-premise school servers.

This document details the end-to-end operational architecture: from local source code editing, to Git release tracking on GitHub, multi-architecture image building on Docker Hub, edge deployment via Cloudflare Pages, and zero-downtime updates on production servers.

---

## 1. End-to-End Ecosystem Architecture

The following diagram illustrates the interactions between local components, remote repositories, container registries, edge CDN networks, and production environments:

```mermaid
flowchart TD
    subgraph LocalDev["💻 Local Development Environment"]
        DevFiles["Eurario Sources\n(Python, HTML5, Vanilla JS, CSS)"]
        LocalFET["Compiler & Solver\nNative FET 7.12 (C++)"]
        LocalTest["Integration Tests\n& Constraints Validation"]
        DevFiles --> LocalFET
        LocalFET --> LocalTest
    end

    subgraph GitHubRepo["🐙 GitHub Repository (carlorigoni/eurario)"]
        MainBranch["main Branch\n(Stable & Verified Code)"]
        GitTag["Git Release Tag\n(e.g. v1.9.5)"]
        GHActions["GitHub Actions\n(Docs Validation & Test Build)"]
        MainBranch --> GitTag
        MainBranch --> GHActions
    end

    subgraph CDNPipeline["☁️ Cloudflare Pages (Edge CDN)"]
        CF_Landing["eurario.it\n(Landing Page & Interactive Demo)"]
        CF_Docs["docs.eurario.it\n(Zensical Docs & User Guide)"]
    end

    subgraph ContainerRegistry["🐳 Docker Hub Registry (carlorigoni/eurario)"]
        MultiArchBuild["Multi-Arch Automated Build\n(linux/amd64 & linux/arm64)"]
        TagLatest["Tag: latest\n(Rolling Production Tag)"]
        TagVersion["Immutable Tag: vX.Y.Z\n(e.g. :v1.9.5)"]
        MultiArchBuild --> TagLatest
        MultiArchBuild --> TagVersion
    end

    subgraph ProductionEnv["🏢 Production Servers & School Networks"]
        subgraph ServerHost["Host Server / VM / NAS"]
            ReverseProxy["Reverse Proxy & TLS\n(Caddy / Nginx / Cloudflare Tunnel)"]
            DockerEngine["Docker Engine Runtime"]
            Watchtower["Watchtower / Cron Daemon\n(Nightly Auto-Update Checks)"]
            PersistentVol["Persistent Volume Storage\n(/instance <-> ./data host)"]
        end
        subgraph ContainerApp["Eurario Container"]
            PyServer["Python HTTP Server\n(Pure Standard Library)"]
            AuthEngine["Auth & Brute-Force Defense\n(PBKDF2 600k + Rate Limiter)"]
            FETExec["Native fet-cl\n(C++ Compiled Binary)"]
            LocalData["JSON Storage / .fet Snapshots\n(Schools, Rules, Timetables)"]
        end
    end

    %% Environment Relationships
    DevFiles -->|"git commit & git push"| MainBranch
    GitTag -->|"Automated Build Trigger"| MultiArchBuild
    MainBranch -->|"Webhook Git Deploy"| CF_Landing
    MainBranch -->|"Webhook Git Deploy"| CF_Docs

    TagLatest -.->|"docker pull / auto-update"| DockerEngine
    DockerEngine --> ContainerApp
    ReverseProxy -->|"Proxy pass :8000"| PyServer
    PyServer --> AuthEngine
    PyServer --> FETExec
    PyServer <--> LocalData
    LocalData <--> PersistentVol
    Watchtower -.->|"Polls Tags"| TagLatest

    ContainerApp -.->|"Version Check\nvia Docker Hub API"| ContainerRegistry
```

---

## 2. Internal Runtime Architecture & Component Stack

The internal runtime architecture is designed to eliminate fragile dependencies and deliver rock-solid performance over decades without breaking due to upstream library updates:

```mermaid
graph LR
    Browser["🌐 Browser Client\n(Material 3 / Vanilla ES6)"] 
    -->|"HTTP REST API & EventStream"| ServerPy["⚙️ webapp/server.py\n(Native Python HTTP Server)"]
    
    subgraph CoreBackend["Eurario Backend (Standard Library Only)"]
        ServerPy --> AuthPy["🛡️ webapp/auth.py\n(PBKDF2, IP Lockout, Rate Limiter)"]
        ServerPy --> Exporter["📄 Print Procedures 9 & 12\n(A3/A4 Vector PDF & Word .docx)"]
        ServerPy --> SolverManager["⚡ Timetable Solver Manager\n(Subprocess fet-cl C++)"]
    end

    subgraph NativeBinary["High-Performance Solver Engine"]
        SolverManager --> FET["bin/fet-cl\n(Native C++ Qt-Free FET 7.12.0)"]
    end

    subgraph DataStorage["Atomic File System Storage (instance/)"]
        ServerPy <--> JsonData["data.json / settings.json\n(Atomic Writes with Locking)"]
        ServerPy <--> Snapshots["snapshots/\n(Restore Points in .fet and .json)"]
        FET --> SolutionXML["orario_soluzione.xml\n(Computed Timetable Output)"]
    end
```

### Layer Details:

1. **Frontend (Zero-Framework Vanilla Stack)**:
   - Built with **semantic HTML5**, **Vanilla ES6+ JavaScript**, and **modern CSS** with custom properties for responsive Light/Dark theme switching.
   - Design System inspired by Google Classroom / Material 3 (accent colors `#1B2A4A`, `#059669`, `#E4572E`, modular cards, collapsible rail flyout navigation).
   - No runtime bundlers (Webpack/Vite/Rollup) required: instantaneous loading with asset cache-busting via version query parameters (`?v=1.9.5`).

2. **Python Backend (`webapp/server.py` & `webapp/auth.py`)**:
   - Runs on Python 3.10+ using **exclusively Standard Library modules**: `http.server`, `urllib`, `json`, `hashlib`, `hmac`, `secrets`, `subprocess`, `threading`.
   - No heavy web frameworks (Django/FastAPI) and zero runtime network dependencies.
   - Enterprise security: password hashing via **PBKDF2-HMAC-SHA256 with 600,000 iterations**, cryptographic salt (16 bytes), progressive exponential tarpit delays, and automated IP lockout against brute-force attacks.

3. **Heuristic Solver Engine (`bin/fet-cl`)**:
   - Native C++ compiled binary from FET 7.12.0 sources (created by Liviu Lalescu and Volker Dirr).
   - Invoked by the Python server as an isolated subprocess with optimized argument passing. It operates headlessly without the Qt GUI, providing maximum calculation speed and stability on server hardware.

4. **Atomic Disk Storage (`instance/` & `data/`)**:
   - No external SQL database servers to configure, maintain, or troubleshoot.
   - School metadata, faculty rosters, period blocks, and constraints reside in structured JSON files.
   - All disk writes are atomic (write to temporary file followed by atomic `os.replace`), preventing data corruption even during abrupt power cuts.

---

## 3. Version Control & Release Management

Eurario strictly follows **Semantic Versioning (SemVer 2.0.0)** formatted as `vMAJOR.MINOR.PATCH`:

* **`MAJOR`**: Substantial architectural overhauls or schema breaking shifts.
* **`MINOR`**: Significant features, new official print export procedures, or FET constraint extensions.
* **`PATCH`**: Bug fixes, performance optimizations, UI refinements, and security hardening.

### Synchronized Release Identifiers:

Whenever a new version is released, the following files are synchronized to ensure identical version reporting across all touchpoints:

| File | Variable / Marker | Role |
| :--- | :--- | :--- |
| `webapp/server.py` | `APP_VERSION = "1.9.5"` | Reported in server APIs and system startup logs |
| `webapp/static/app.js` | `const APP_VERSION = '1.9.5'` | Used by the client for remote Docker Hub verification |
| `webapp/static/index.html` | UI badges and cache buster (`?v=1.9.5`) | Sidebar, About modal, and browser cache busting |
| `landing/content/site_data.json` | `"current_version": "v1.9.5"` | Hero tag and release announcement on eurario.it |
| `landing/index.html` | `#liveVerTag` | Recommended Docker image tag in the hero banner |
| `zensical.toml` | CSS/JS asset query parameter | Documentation asset cache busting on docs.eurario.it |

---

## 4. Container Registry Pipeline on Docker Hub

When a new Git Release Tag is pushed (e.g. `git tag v1.9.5 && git push origin v1.9.5`), an official multi-architecture container build is triggered:

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer / Maintainer
    participant Git as GitHub (carlorigoni/eurario)
    participant Hub as Docker Hub Registry
    participant Prod as Production Server

    Dev->>Git: git push origin v1.9.5
    Note over Git,Hub: Automated Multi-Arch Build Trigger
    Git->>Hub: Build container for linux/amd64 and linux/arm64
    Hub->>Hub: Publish carlorigoni/eurario:v1.9.5
    Hub->>Hub: Update carlorigoni/eurario:latest rolling tag

    loop Periodic Check (Client or Server Daemon)
        Prod->>Hub: GET /v2/repositories/carlorigoni/eurario/tags
        Hub-->>Prod: List of published tags (latest: v1.9.5)
    end

    alt Local Version < Latest Remote Tag
        Prod->>Prod: Show "New Update Available" notification
        Prod->>Hub: docker compose pull && docker compose up -d
        Prod->>Prod: Hot restart with persistent data intact
    else Local Version == Latest Remote Tag
        Prod->>Prod: Green "Stable Release Aligned" badge
    end
```

### Multi-Architecture Support:
The automated build produces a unified multi-arch manifest:
- **`linux/amd64`**: For traditional cloud servers, VMs, and Intel/AMD hardware.
- **`linux/arm64`**: For Apple Silicon (M1/M2/M3/M4), Hetzner Ampere Altra CAX VPS, and Raspberry Pi 5.

When an administrator executes `docker pull carlorigoni/eurario:latest`, the Docker engine automatically pulls the matching architecture.

---

## 5. Production Version Checking & Update Strategies

Eurario includes built-in diagnostic and update tracking accessible directly from the WebApp footer and automated daemon tools:

### 1. Docker Hub API Inspection
In the WebApp, the client queries the official public registry endpoint:
```http
GET https://hub.docker.com/v2/repositories/carlorigoni/eurario/tags?page_size=10
```
The JSON response lists all published image tags with their creation timestamps and digest signatures. The comparison algorithm identifies the latest tag matching `vX.Y.Z` and compares it against `APP_VERSION`:

* If `Remote Version > Local Version`: The status indicator dot in the sidebar turns amber/orange, notifying the administrator that a newer release is ready.
* Clicking the badge opens the **Update Verification Modal** with release details and one-click instructions.

### 2. Manual Update (Zero Risk)
To update an existing Docker Compose deployment, run:

```bash
docker compose pull
docker compose up -d
```

Because host volumes are mounted (`./data:/app/data` or `./instance:/app/instance`), the old container is swapped in less than 5 seconds with zero data loss:
- School profile and teacher rosters remain untouched;
- Historical snapshot points and `.fet` files remain intact;
- Passcodes, tokens, and Google OAuth configurations are preserved;
- Audit logs and access journals are strictly retained.

### 3. Automated Nightly Updates with Watchtower
For institutions preferring fully unattended maintenance, the **Watchtower** companion container can be enabled:

```yaml
version: '3.8'

services:
  eurario:
    image: carlorigoni/eurario:latest
    container_name: eurario-app
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=8000

  watchtower:
    image: containrrr/watchtower
    container_name: eurario-watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 86400 --cleanup eurario-app
```

---

## 6. Cloudflare Pages & Global Edge Distribution

The marketing showcase ([eurario.it](https://eurario.it)) and documentation site ([docs.eurario.it](https://docs.eurario.it)) are powered by Cloudflare's global edge network:

1. **Continuous Deployment via Webhooks**: Every push to the `main` branch on GitHub triggers automatic deployment webhooks.
2. **Static Generation**:
   - For `docs.eurario.it`, Zensical builds the documentation:
     ```bash
     zensical build
     ```
   - For `eurario.it`, static assets (`landing/`) are deployed directly.
3. **Sub-Millisecond Global Latency**: Documentation and landing pages benefit from edge caching across 300+ cities worldwide, automated SSL/TLS termination, and DDoS mitigation with zero load on the timetable server.
