# 🎓 Eurario — Complete School Timetabling Suite with FET 7.12.0

[![Version](https://img.shields.io/badge/version-1.9.2-blue.svg)](https://github.com/carlorigoni/eurario)
[![Docker Hub](https://img.shields.io/badge/docker%20hub-carlorigoni%2Feurario%3Alatest-blue?logo=docker)](https://hub.docker.com/r/carlorigoni/eurario)
[![FET Solver](https://img.shields.io/badge/FET%20engine-7.12.0-orange.svg)](https://lalescu.ro/liviu/fet/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-green.svg)](https://www.gnu.org/licenses/agpl-3.0)

> 🌐 **Language / Lingua:** **English** | [Italiano](README.it.md)

Eurario is a modern, responsive, and high-performance web application designed for creating, optimizing, and publishing master school timetables in secondary schools. It seamlessly integrates the renowned open-source **FET (Free Timetabling Software) 7.12.0** heuristic engine.

Zero external Python dependencies, clean Google Classroom / Material 3 reactive interface, and ready-to-run multi-arch container image on Docker Hub.

---

## 🌟 Key Features

- **Embedded FET 7.12.0 Solver**:
  - Real-time generation streaming with live progress metrics and bottleneck activity diagnostics.
  - Highest-stage snapshot recovery: instantly inspect and restore the best timetable state if interrupted or stopped early.
- **Timetable Locking System**:
  - Pin entire classes or specific period slots directly on the interactive timetable grid using 100% permanent FET constraints (`ConstraintActivityPreferredStartingTime` and `ConstraintActivityPreferredRoom`), preserving manual placements across re-generation runs.
- **Comprehensive School Management**:
  - **Teachers**: full-time, shared-campus allocations (COE), fractional contracts, part-time, gap hours limits, daily period caps, time-off requests, and designated free days.
  - **Classes & Student Groups**: language articulations (e.g., French, Spanish, German), tracks and multi-year divisions.
  - **Rooms & Specialized Facilities**: standard classrooms, shared sports gyms with automatic capacity thresholds, and specialized science/computer laboratories.
  - **Macro-Subjects & Combinations**: intelligent merging of related subjects (e.g., *Italian, Latin, History & Geography*) for balanced pedagogical pacing.
  - **Duty & On-Call Allocation**: smart placement of on-call availability hours without dead gaps or conflicts with multi-hour blocks.
- **Word Document (.docx) & Google Docs Staff Synchronization**:
  - Direct download of the pre-formatted **Word (.docx) Teaching Staff Template** or one-click export of current school staff to Word.
  - Automatic synchronization from Word (.docx) or Google Docs with side-by-side diff preview and selective confirmation.
- **"Paperopoli" Demo Dataset & Blank Slate Reset**:
  - Preloaded with a complete, realistic sample high school (*"Pico De Paperis High School & Technical Institute"*, 8 Disney characters as faculty, 5 classes, labs, gym, and 100% solved FET timetable) to test all features immediately without "blank canvas" friction.
  - One-click factory reset button to erase the database and start fresh with your own school data.
- **Lightweight Architecture**:
  - **Zero external Python libraries** (runs strictly on Python 3 standard library modules).

---

## 🐳 Official Docker Hub Image

The application is published as a pre-compiled multi-architecture container (Linux Ubuntu, Python 3, and native C++ FET 7.12.0 solver) on **Docker Hub**:

👉 **Docker Hub Repository:** [`carlorigoni/eurario`](https://hub.docker.com/r/carlorigoni/eurario)

No C++ compiler, Qt toolchain, or GUI libraries required on your host: the container contains everything needed for instant deployment.

---

## 🚀 Quick Start

### Option 1: Docker Compose (Recommended)

1. Use or customize the `docker-compose.yml` file included in this repository:
   ```yaml
   services:
     eurario:
       container_name: eurario
       image: carlorigoni/eurario:latest
       restart: unless-stopped
       ports:
         - "8000:8000"
       environment:
         - HOST=0.0.0.0
         - PORT=8000
         - PYTHONUNBUFFERED=1
         - ADMIN_EMAIL=admin@yourschool.edu
       volumes:
         - ./data:/app/webapp/data
       healthcheck:
         test: ["CMD", "curl", "-f", "http://localhost:8000/api/summary"]
         interval: 30s
         timeout: 5s
         retries: 3
         start_period: 15s

     # Automatic background updater when new images are pushed to Docker Hub
     watchtower:
       container_name: eurario_watchtower
       image: containrrr/watchtower
       restart: unless-stopped
       environment:
         - DOCKER_API_VERSION=1.41
       volumes:
         - /var/run/docker.sock:/var/run/docker.sock
       command: --interval 3600 --cleanup eurario
   ```

2. **Launch the services**:
   ```bash
   docker compose up -d
   ```

3. Open your browser at [http://localhost:8000](http://localhost:8000).

---

### Option 2: Docker Run

```bash
docker run -d \
  --name eurario \
  -p 8000:8000 \
  -v $(pwd)/data:/app/webapp/data \
  -e ADMIN_EMAIL=admin@yourschool.edu \
  --restart unless-stopped \
  carlorigoni/eurario:latest
```

---

### Option 3: Local Execution from Source (macOS / Linux)

1. Ensure **Python 3.10+** is installed.
2. Build the local `fet-cl` solver binary (first time only):
   ```bash
   ./setup_fet_cl.sh
   ```
3. Start the server:
   ```bash
   python3 webapp/server.py
   ```
4. Open your browser at [http://localhost:8000](http://localhost:8000).

---

## 🔐 Authentication & First Access

Eurario features built-in authentication supporting **Google Identity Services (OAuth 2.0)** and an **Emergency Master Passcode**.

### 🔑 1. Initial Emergency Admin Access

On a clean installation or before Google OAuth is configured:
1. Navigate to the login screen at [http://localhost:8000](http://localhost:8000).
2. Click the link at the bottom: **"🔑 Administrator Access (Passcode)"**.
3. Enter the default master passcode:
   ```text
   admin2026
   ```
4. Click **"Log in as Admin"**: you will be authenticated immediately with SuperAdmin privileges to configure your school, manage user permissions, or change the master passcode.

---

### 🌐 2. Configuring Google OAuth 2.0 (Google Workspace / Gmail)

Google OAuth allows principals, teachers, and timetabling committee members to log in with a single click using their institutional Google accounts (`@school.edu` or personal `@gmail.com`).

#### Step A: Obtain Google Client ID via Google Cloud Console
1. Open [Google Cloud Console](https://console.cloud.google.com).
2. Create a new project (e.g., *Eurario School*).
3. Go to **APIs & Services** ➔ **OAuth consent screen**:
   - Choose **External** (or **Internal** if using Google Workspace for Education).
   - Fill in the application name (*Eurario*) and your support email. Save and continue.
4. Go to **APIs & Services** ➔ **Credentials**:
   - Click **Create Credentials** ➔ **OAuth client ID**.
   - Application type: select **Web application**.
   - Under **Authorized JavaScript origins**, add your access URLs:
     - `http://localhost:8000` (for local tests or Docker on your PC)
     - `https://timetable.yourschool.edu` (for production server / Synology NAS with HTTPS domain).
   - Click **Create**: copy your **Client ID** (e.g., `123456789-abcdefg.apps.googleusercontent.com`).

#### Step B: Save Client ID in Eurario
1. Log in to Eurario using the `admin2026` passcode.
2. In the left sidebar, click **"👥 Access Management"** (under System).
3. Paste the Client ID into the **"Google Client ID"** field and click **"Save Configuration"**.  
   *(Alternatively, pass it via the `GOOGLE_CLIENT_ID` environment variable in `docker-compose.yml`)*.
4. Refresh the login screen: the official **"Continue with Google"** button appears instantly!

---

### 🛡️ 3. User Approval & Zero Trust Workflow

The platform protects institutional data by preventing unvetted Google accounts from accessing school schedules:

1. **Access Request**: When a faculty member signs in with Google for the first time, their account enters a `pending` state with an explanatory message:  
   *⏳ "Access Request Submitted! Your request is awaiting administrator approval."*
2. **Admin Notification**:
   - The admin sidebar displays a **red numeric badge** on `Access Management` indicating pending requests.
   - *(Optional)* If SMTP is configured in settings, the admin receives an email alert.
3. **One-Click Approval**:
   - The administrator navigates to **Access Management**.
   - Clicks **"✅ Approve"** and assigns the appropriate role:
     - **Admin**: full control over timetable calculation, constraints, school data, and user roles.
     - **Editor**: manage classes and allocations without user admin privileges.
     - **Viewer / Teacher**: view-only access to final solved timetables, teacher views, and printable documents.
4. The approved user is instantly unlocked without re-entering credentials.

---

## 📦 Deployment on Synology NAS (Container Manager)

To deploy Eurario on a Synology NAS with an automated Let's Encrypt SSL certificate:

👉 **Refer to the dedicated guide:** [`SYNOLOGY_GUIDE.md`](./SYNOLOGY_GUIDE.md)

Covers:
- Step-by-step setup using **Synology Container Manager** GUI.
- Volume mapping for persistent database, snapshots, and timetable files.
- Configuring **Synology Reverse Proxy** with HTTPS certificate.

---

## 🔄 Automatic Server Updates (Ubuntu Linux & Docker)

When a new image is pushed to Docker Hub (`carlorigoni/eurario:latest`), production servers can update automatically with zero manual downtime and zero risk of data loss.

### ❓ Does Watchtower require installing software on Ubuntu?
**No.** Watchtower is **itself a lightweight Docker container** (`image: containrrr/watchtower`) communicating safely with the local Docker daemon socket (`/var/run/docker.sock`). It does not modify host packages, apt dependencies, or OS configuration.

---

### Integrated Docker Compose Management

The `watchtower` service is included directly in `docker-compose.yml`:

```bash
docker compose up -d
```
* **How it works:**
  1. Periodically checks Docker Hub (every 60 minutes or on a custom schedule) for newer digests of `carlorigoni/eurario:latest`.
  2. If an update exists, it gracefully pulls the image (`docker pull`).
  3. Stops the running container gracefully and restarts it with **the exact same volume mounts** (`./data`) and ports.
  4. Automatically purges old dangling images (`--cleanup`) to save host disk space.
  5. Your school database (`current_project.json`), solved schedules, and historical snapshots remain untouched on the host volume.

#### Helpful commands:
* **Check running containers:**
  ```bash
  docker compose ps
  ```
* **View real-time Watchtower logs:**
  ```bash
  docker compose logs -f watchtower
  ```
* **Stop Watchtower while keeping Eurario running:**
  ```bash
  docker compose stop watchtower
  ```

---

## 🛡️ Privacy & GDPR Compliance (EU Reg. 2016/679)

Eurario is designed and distributed as **independent open-source software** operating **strictly on-premise** within the school's local infrastructure or on a self-managed VPS.

### 1. Data Controller Role
- Under **Article 4(7) of the General Data Protection Regulation (GDPR - EU 2016/679)**, the **Educational Institution** that deploys and operates the software acts exclusively as the **Data Controller**.
- The author (Carlo Rigoni) and open-source contributors **are not Data Processors**. They have no access to, do not collect, do not store, and do not transmit any school data (staff names, contracts, constraints, student rosters, or timetables) to external servers.

### 2. Privacy by Design & Privacy by Default (Art. 25 GDPR)
- **100% On-Premise Execution**: All database files and algorithmic routines remain inside the school's sovereign environment. Zero external telemetry, tracking, or profiling.
- **Zero Trust Account Provisioning**: First-time Google OAuth logins default to `pending` with zero access until authorized by the local administrator.
- **Data Minimization (Art. 5(1)(c))**: Authentication verifies only the institutional email and unique subject ID via cryptographic token. No passwords stored in cleartext.
- **Encrypted Emergency Access**: The disaster-recovery master passcode is hashed with PBKDF2/SHA-256 and cryptographic salt.
- **Audit Logs (Art. 32 GDPR)**: Chronological access log stored in the persistent volume `/data` (login attempts, IP addresses, timestamp, role changes) accessible by school administrators.

---

## 📜 Credits & Acknowledgements

The Eurario project is the result of collaboration between pedagogical timetabling methodology, high-performance open-source computing, and AI engineering:

- 👨‍🏫 **Author, Concept & Software Architecture**:
  **Carlo Rigoni** &mdash; Concept, data architecture for secondary school timetabling (staff allocations, shared posts, language splits, co-teaching, on-call periods, macro-subject balancing, period locking rules, and official prints).
- 🎓 **Timetabling Mentor & Methodological Guide**:
  **Federico Rettore** &mdash; Mentor and methodological reference for Italian and European school timetabling organizational principles, workload balancing, constraint satisfaction, and high school operational practices.
- ⚡ **FET Heuristic Solver Engine**:
  **Liviu Lalescu**, **Volker Dirr**, and the international [FET (Free Educational Timetabling Software)](https://lalescu.ro/liviu/fet/) community &mdash; Extraordinary native C++ heuristic engine licensed under GNU AGPLv3.
- 🤖 **AI Engineering & Pair Programming**:
  **Google DeepMind Antigravity** &mdash; Full-stack architecture, Material 3 responsive UI (Google Classroom style), Advisor relaxation heuristic engine, Word (.docx) parser/generator, multi-arch Docker pipeline, and automated testing.
- 🔒 **Data Sovereignty**:
  Eurario operates **strictly on-premise** or on a **school-controlled VPS**. No data resides on or transits through third-party cloud servers.

---

## 📁 Repository Structure

```text
├── Dockerfile                   # Multi-stage Linux build (FET 7.12.0 + Python 3.12)
├── docker-compose.yml           # Docker Compose configuration (Eurario + Watchtower)
├── .dockerignore                # Docker build exclusions
├── .gitignore                   # Git repository exclusions
├── LICENSE                      # GNU Affero General Public License v3 (AGPLv3)
├── SYNOLOGY_GUIDE.md            # Synology NAS deployment guide
├── README.md                    # This primary English documentation
├── README.it.md                 # Italian language documentation
├── setup_fet_cl.sh              # macOS local compilation script for fet-cl
├── webapp/
│   ├── server.py                # REST API backend & static file server (Zero dependencies)
│   ├── database.py              # Data store, persistence, allocations, constraints, locks
│   ├── fet_engine.py            # FET XML generator, parser, views & constraint engine
│   ├── auth.py                  # Google OAuth, session management & RBAC security
│   ├── print_engine.py          # A3/A4 printable engine & Word (.docx) generator
│   ├── advisor.py               # Pre-solve heuristic advisor & diagnostic engine
│   ├── static/
│   │   ├── index.html           # Single Page Application HTML5
│   │   ├── app.js               # Reactive client-side logic & UI controllers
│   │   └── styles.css           # Custom CSS3 stylesheet & design tokens
│   ├── seed_data/               # Bootstrap demo dataset for fresh installs
│   │   ├── current_project.json # Duckburg demo school dataset
│   │   └── solved_timetable.fet # Pre-solved demo timetable
│   └── data/                    # Persistent host volume mounted directory
│       ├── current_project.json # Active school database
│       ├── solved_timetable.fet # Current solved timetable
│       └── snapshots/           # Historical snapshots & recovery points
```

---

## 📄 License

Released under the **GNU Affero General Public License v3 (GNU AGPLv3)** in full alignment with the FET solver engine license.  
Author: **Carlo Rigoni** &bull; Solver Engine: **FET 7.12.0** &bull; AI Pair Programming: **Google DeepMind Antigravity**.
