---
title: Official GitHub README
description: Official README document from the open source carlorigoni/eurario GitHub repository.
---

# 🎓 Eurario — Official GitHub Repository

[![Docker Hub](https://img.shields.io/badge/docker%20hub-carlorigoni%2Feurario%3Alatest-blue?logo=docker)](https://hub.docker.com/r/carlorigoni/eurario)
[![FET Solver](https://img.shields.io/badge/FET%20engine-C%2B%2B%20native-orange.svg)](https://lalescu.ro/liviu/fet/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-green.svg)](https://www.gnu.org/licenses/agpl-3.0)

> 🔗 **GitHub Repository:** [github.com/carlorigoni/eurario](https://github.com/carlorigoni/eurario)

Modern, high-performance web application designed for modeling, solving, optimizing, and publishing high school timetables, powered by the native **FET (Free Timetabling Software)** heuristic engine.

Zero external Python dependencies, responsive Material 3 / Google Classroom inspired interface, and ready-to-run multi-arch container image on Docker Hub.

---

## 🌟 Key Capabilities

- **Integrated Native FET Solver Engine**:
  - Real-time timetable generation with live SSE stdout streaming and bottleneck activity diagnostics.
  - One-click rollback and highest-stage snapshot recovery.
- **Activity Pinning & Locking**:
  - Lock entire classes or individual lessons onto the timetable grid with permanent 100% hard constraints (`ConstraintActivityPreferredStartingTime` and `ConstraintActivityPreferredRoom`).
- **Comprehensive Institutional Management**:
  - **Teachers**: workload hours, contracts (full, shared COE, part-time), gap minimization, days off, and availability.
  - **Classes & Groups**: articulated language divisions (e.g. French, Spanish, German) and specialized study tracks.
  - **Rooms & Specialized Spaces**: home rooms, shared gymnasiums with concurrent capacity caps, computer/science labs.
  - **Macro-Subjects & Merging**: pedagogical combination of composite courses.
  - **Intelligent On-Duty Placement**: automatic gap plugging and substitution balancing.
- **Staffing Synchronization & Word Template (.docx)**:
  - Official Word template download and diff-based spreadsheet/document ingestion.
- **Demo Dataset & Blank Slate**:
  - Pre-populated fully functional school (*Liceo & Tecnico "Pico De Paperis"*) with a 100% solved timetable to explore all features immediately.
  - One-click reset to start fresh with a blank institution.
- **Lightweight Architecture**:
  - **Zero external Python libraries** (exclusively uses Python 3 standard library).

---

## 🐳 Official Docker Hub Image

Published as a pre-compiled container image with Ubuntu Linux, Python 3, and the native C++ FET binary on **Docker Hub**:

👉 **Docker Hub Repository:** [`carlorigoni/eurario`](https://hub.docker.com/r/carlorigoni/eurario)

No need to install C++ compilers, Qt, or graphical libraries: everything is packaged and ready to deploy.

---

## 🚀 Quickstart with Docker Compose

```yaml
version: '3.8'

services:
  eurario:
    container_name: eurario
    image: carlorigoni/eurario:latest
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=8000
      - PYTHONUNBUFFERED=1
```

Start the container:
```bash
docker compose up -d
```

Access the application at:
👉 **`http://localhost:8000`**

---

## 🛠️ Local Development (Without Docker)

```bash
git clone https://github.com/carlorigoni/eurario.git
cd eurario

# Run directly with native Python
python3 -m webapp.server
```

Open `http://localhost:8000` in your web browser.

---

## 👥 Credits & Acknowledgments

- **Architecture, Full-Stack Design & Development:** [Carlo Rigoni](https://github.com/carlorigoni)
- **Timetabling Methodology & Mentorship:** Federico Rettore
- **FET Timetabling Engine:** Liviu Lalescu and Volker Dirr ([Official FET Website](https://lalescu.ro/liviu/fet/))

---

## 📜 License

Eurario is free and open-source software licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**.
