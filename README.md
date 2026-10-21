# 🎓 SmartTimetable - Suite Completa per l'Orario Scolastico con FET 7.12.0

[![Version](https://img.shields.io/badge/version-1.4.0-blue.svg)](https://github.com/carlorigoni/SmartTimetableFET)
[![Docker Hub](https://img.shields.io/badge/docker%20hub-carlorigoni%2Fsmarttimetablefet%3Alatest-blue?logo=docker)](https://hub.docker.com/r/carlorigoni/smarttimetablefet)
[![FET Solver](https://img.shields.io/badge/FET%20engine-7.12.0-orange.svg)](https://lalescu.ro/liviu/fet/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-green.svg)](https://www.gnu.org/licenses/gpl-3.0)

Applicazione web moderna, performante e intuitiva per la progettazione, ottimizzazione e pubblicazione dell'orario scolastico negli Istituti Superiori italiani, integrata con il solutore open source ad alte prestazioni **FET (Free Timetabling Software) 7.12.0**.

Zero dipendenze esterne Python, interfaccia reattiva in stile Google Classroom / Material 3 e immagine container multi-architettura pronta all'uso su Docker Hub.

---

## 🌟 Caratteristiche Principali

- **Solutore FET 7.12.0 Integrato**:
  - Compilazione orario automatica in tempo reale con visualizzazione live dello stream del solutore e rilevamento colli di bottiglia (*bottleneck activities*).
  - Supporto al salvataggio e ripristino istantaneo dello stadio più avanzato (*highest stage*) in caso di arresto manuale o timeout.
- **Sistema di Blocco Orario (Locking)**:
  - Possibilità di bloccare intere classi o singole ore nella griglia oraria con vincoli FET permanenti al 100% (`ConstraintActivityPreferredStartingTime` e `ConstraintActivityPreferredRoom`), preservando fedelmente le collocazioni desiderate nei ricalcoli successivi.
- **Gestione Completa dell'Istituto**:
  - **Docenti**: orari di cattedra, tipologia contratto (intere, COE, spezzone, part-time), ore buche, massimo ore giornaliere, preferenze orarie e giorni liberi.
  - **Classi e Gruppi**: articolazioni per lingua straniera (es. Francese, Spagnolo, Tedesco), suddivisioni biennio/triennio per indirizzo di studio.
  - **Aule e Spazi Specialistici**: aule base, palestre condivise con gestione capienza contemporanea automatica, laboratori specialistici.
  - **Macro-Materie e Accorpamenti**: unione intelligente di cattedre affini (es. *Italiano Latino Storia e Geografia*) per un bilanciamento didattico ottimale.
  - **Disposizioni Intelligenti**: collocazione automatica delle ore a disposizione senza buchi e senza sovrapposizioni a lezioni pluri-orarie.
- **Sincronizzazione Organico e Modello Word (.docx)**:
  - Download diretto del **Modello Word (.docx)** pre-formattato per l'organico docenti o esportazione istantanea dell'organico attuale della scuola in Word.
  - Sincronizzazione automatica da file Word (.docx) o Google Docs con anteprima differenziale e conferma selettiva.
- **Dataset Demo "Paperopoli" & Reset a Foglio Bianco**:
  - Include un istituto didattico completo e funzionante (*Liceo & Tecnico "Pico De Paperis"*, 8 docenti Disney, 5 classi, laboratori, palestra e orario già risolto al 100% in FET) per esplorare subito tutte le funzionalità senza panico da "foglio vuoto".
  - Pulsante per azzerare completamente il database creando un istituto pulito a foglio bianco per iniziare la propria scuola.
- **Architettura Leggera**:
  - **Zero librerie Python esterne** (utilizza esclusivamente i moduli standard di Python 3).

---

## 🐳 Immagine Ufficiale Docker Hub

L'applicazione è pubblicata come container pre-compilato con Linux Ubuntu, Python 3 e il solutore nativo C++ FET 7.12.0 su **Docker Hub**:

👉 **Docker Hub Repository:** [`carlorigoni/smarttimetablefet`](https://hub.docker.com/r/carlorigoni/smarttimetablefet)

Non è necessario installare compiler C++, Qt o librerie grafiche: l'immagine include tutto il necessario pronto per il deploy immediato.

---

## 🚀 Avvio Rapido

### Opzione 1: Con Docker Compose (Consigliata)

1. Crea o usa il file `docker-compose.yml` presente nel repository:
   ```yaml
   version: '3.8'

   services:
     smarttimetable:
       container_name: smarttimetable
       image: carlorigoni/smarttimetablefet:latest
       restart: unless-stopped
       ports:
         - "8000:8000"
       environment:
         - HOST=0.0.0.0
         - PORT=8000
         - PYTHONUNBUFFERED=1
         - ADMIN_EMAIL=admin@tuascuola.edu
       volumes:
         - ./data:/app/webapp/data
   ```

2. Avvia il container:
   ```bash
   docker compose up -d
   ```

3. Apri il browser su [http://localhost:8000](http://localhost:8000).

---

### Opzione 2: Con Docker Run

```bash
docker run -d \
  --name smarttimetable \
  -p 8000:8000 \
  -v $(pwd)/data:/app/webapp/data \
  -e ADMIN_EMAIL=admin@tuascuola.edu \
  --restart unless-stopped \
  carlorigoni/smarttimetablefet:latest
```

---

### Opzione 3: Esecuzione Locale da Sorgenti (macOS / Linux)

1. Assicurati di avere **Python 3.10+** installato.
2. Compila il solutore locale `fet-cl` (solo prima volta):
   ```bash
   ./setup_fet_cl.sh
   ```
3. Avvia il server:
   ```bash
   python3 webapp/server.py
   ```
4. Apri il browser su [http://localhost:8000](http://localhost:8000).

---

## 🔐 Autenticazione e Primo Accesso

SmartTimetable include un sistema di autenticazione integrato con supporto **Google Identity Services (OAuth 2.0)** e **Passcode Master di Emergenza**.

### 🔑 1. Primo Accesso di Emergenza (Setup Iniziale)

Alla prima installazione, o se Google OAuth non è ancora configurato:
1. Apri la schermata di login su [http://localhost:8000](http://localhost:8000).
2. Clicca sulla voce in basso: **"🔑 Accesso Amministratore (Passcode)"**.
3. Inserisci il passcode master predefinito:
   ```text
   admin2026
   ```
4. Clicca su **"Accedi come Admin"**: verrai autenticato immediatamente come Super-Amministratore con pieni poteri per impostare la scuola, gestire gli accessi o cambiare il passcode.

---

### 🌐 2. Come Configurare l'Autenticazione Google OAuth (Gmail / Workspace)

L'integrazione Google OAuth permette a presidi, docenti e commissione orario di accedere con un solo clic con il loro account Google (`@gmail.com` o dominio d'istituto `@scuola.edu.it`).

#### Passo A: Ottenere il Google Client ID su Google Cloud Console
1. Accedi a [Google Cloud Console](https://console.cloud.google.com).
2. Crea un nuovo progetto (es. *SmartTimetable Scuola*).
3. Vai nel menu **API e servizi** ➔ **Schermata consenso OAuth**:
   - Scegli **Esterno** (oppure **Interno** se la tua scuola usa Google Workspace for Education).
   - Inserisci il nome dell'app (es. *SmartTimetable*) e la tua email di supporto. Salva e continua.
4. Vai nel menu **API e servizi** ➔ **Credenziali**:
   - Clicca su **Crea credenziali** ➔ **ID client OAuth**.
   - Tipo di applicazione: seleziona **Applicazione Web**.
   - Sotto **Origini JavaScript autorizzate**, aggiungi l'URL da cui accederai:
     - `http://localhost:8000` (per test locali o Docker sul tuo PC)
     - `https://orario.tuascuola.it` (se installato su server o NAS Synology con dominio e certificato SSL HTTPS).
   - Clicca **Crea**: verrà mostrato il tuo **ID client** (es. `123456789-abcdefg.apps.googleusercontent.com`).

#### Passo B: Inserire il Client ID in SmartTimetable
1. Accedi a SmartTimetable con il passcode `admin2026`.
2. Nella barra laterale sinistra, clicca su **"👥 Gestione Accessi"** (in fondo alla sezione Sistema).
3. Nel campo **"Google Client ID"**, incolla l'ID client ottenuto da Google e clicca **"Salva Configurazione"**.
   *(In alternativa, puoi passarlo come variabile d'ambiente `GOOGLE_CLIENT_ID` in `docker-compose.yml`)*.
4. Ricarica la pagina di login: apparirà subito il pulsante ufficiale **"Continua con Google"**!

---

### 🛡️ 3. Come Funziona il Flusso di Approvazione Utenti

Il sistema protegge i dati della scuola impedendo l'accesso indiscriminato a chiunque possieda un account Google:

1. **Richiesta di Accesso**: Quando un nuovo docente o collaboratore accede per la prima volta con Google, riceve una schermata di avviso:  
   *⏳ "Richiesta di Accesso Inviata! La tua richiesta è in attesa di sblocco da parte dell'amministratore"*.
2. **Notifica Amministratore**:
   - Nella barra laterale dell'Admin compare un **badge numerico rosso** sul menu `Gestione Accessi` che indica le richieste pendenti.
   - *(Opzionale)* Se nelle impostazioni è configurato un server SMTP, l'amministratore riceve un'email immediata di notifica.
3. **Approvazione con un Clic**:
   - L'amministratore apre la schermata **Gestione Accessi**.
   - Clicca su **"✅ Approva"** e sceglie il ruolo:
     - **Admin**: gestione completa di orario, vincoli, parametri e altri utenti.
     - **Viewer / Docente**: sola visualizzazione e consultazione dell'orario risolto e delle stampe.
4. L'utente approvato viene sbloccato automaticamente in tempo reale senza bisogno di reinserire credenziali.

---

## 📦 Installazione su NAS Synology (Container Manager)

Per installare SmartTimetable su un NAS Synology con certificato HTTPS per tutta la scuola:

👉 **Consulta la guida dedicata completa:** [`SYNOLOGY_GUIDE.md`](./SYNOLOGY_GUIDE.md)

Include:
- Installazione tramite l'interfaccia grafica di **Synology Container Manager**.
- Mappatura dei volumi per la persistenza di database, snapshot e orari.
- Configurazione del **Reverse Proxy Synology** con certificato SSL Let's Encrypt gratuito.

---

## 🔄 Aggiornamento Automatico del Server di Produzione (Ubuntu Linux)

Quando viene pubblicata una nuova versione dell'immagine su Docker Hub (`carlorigoni/smarttimetablefet:latest`), è possibile aggiornare il server di produzione in modo completamente automatico senza interventi manuali e senza rischiare la perdita dei dati.

### Metodo 1: Aggiornamento Continuo con Watchtower (Scelta Consigliata)

[Watchtower](https://containrrr.dev/watchtower/) è il container standard de facto dell'ecosistema Docker per monitorare il registro Docker Hub, scaricare la nuova immagine e riavviare il container applicando fedelmente le stesse configurazioni e gli stessi volumi persistenti.

#### Aggiunta diretta a `docker-compose.yml`:
È sufficiente aggiungere il servizio `watchtower` al tuo `docker-compose.yml`:

```yaml
version: '3.8'

services:
  smarttimetable:
    container_name: smarttimetable
    image: carlorigoni/smarttimetablefet:latest
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - HOST=0.0.0.0
      - PORT=8000
      - PYTHONUNBUFFERED=1
      - ADMIN_EMAIL=admin@tuascuola.edu
    volumes:
      - ./data:/app/webapp/data

  # Servizio di aggiornamento automatico intelligente
  watchtower:
    image: containrrr/watchtower
    container_name: watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 3600 --cleanup smarttimetable
```

- `--interval 3600`: controlla ogni ora se è presente un aggiornamento (in alternativa, puoi usare `--schedule "0 0 3 * * *"` per aggiornare solo ogni notte alle 03:00).
- `--cleanup`: rimuove automaticamente le vecchie immagini dismesse dal disco dopo l'aggiornamento, evitando di saturare lo spazio del server.
- `smarttimetable`: indica a Watchtower di monitorare esclusivamente il container dell'orario scolastico.

#### Oppure avvio rapido one-line con `docker run`:
```bash
docker run -d \
  --name watchtower \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --cleanup \
  --schedule "0 0 3 * * *" \
  smarttimetable
```

---

### Metodo 2: Aggiornamento tramite Cron Job o Systemd Timer

Se preferisci non utilizzare container ausiliari, puoi configurare un'attività pianificata (`cron`) direttamente su Ubuntu:

1. Modifica il crontab di root:
   ```bash
   sudo crontab -e
   ```
2. Inserisci la seguente riga per eseguire l'aggiornamento ogni notte alle 03:30:
   ```cron
   30 3 * * * cd /opt/smarttimetable && docker compose pull && docker compose up -d && docker image prune -f >> /var/log/smarttimetable_update.log 2>&1
   ```

> [!IMPORTANT]
> **Sicurezza dei Dati durante gli Aggiornamenti:**
> Grazie al volume montato `./data:/app/webapp/data`, il database dell'istituto (`current_project.json`), gli orari risolti, gli snapshot storici e la configurazione degli utenti **non risiedono all'interno dell'immagine effimera**, ma sono memorizzati stabilmente sul disco dell'host. L'aggiornamento dell'immagine container non cancella né sovrascrive mai i dati della scuola.

---

## 🛡️ Trattamento dei Dati Personali e Conformità GDPR (Reg. UE 2016/679)

SmartTimetable FET Suite è progettato e distribuito come **software on-premise autonomo e open source**, destinato all'installazione diretta presso l'infrastruttura tecnologica dell'Istituto Scolastico (server locale, NAS d'istituto o macchina virtuale controllata).

### 1. Ruolo del Titolare del Trattamento (Data Controller)
- Ai sensi dell'**Articolo 4, punto 7 del Regolamento Generale sulla Protezione dei Dati (GDPR - UE 2016/679)**, l'**Istituto Scolastico o l'Ente** che installa, configura e utilizza il software agisce in via esclusiva come **Titolare del Trattamento dei Dati Personali**.
- L'autore (Carlo Rigoni), gli sviluppatori e i contributori del progetto open source **non sono Responsabili del Trattamento (Data Processor)**, non hanno accesso, non raccolgono, non visualizzano, non archiviano e non trasmettono ad alcun server cloud o terza parte i dati trattati dalla scuola (anagrafiche dei docenti, cattedre, indisponibilità, classi, gruppi di studenti o orari).

### 2. Privacy by Design & Privacy by Default (Art. 25 GDPR)
L'architettura del software implementa nativamente i principi cardine di protezione dei dati:
- **Esecuzione 100% Locale / On-Premise**: L'intero database e gli algoritmi di calcolo risiedono all'interno del perimetro di sicurezza della scuola. Nessuna chiamata di telemetria, tracciamento, profilazione o analytics verso server esterni.
- **Zero Trust & Default Inactive Account**: Quando un utente accede per la prima volta con Google OAuth, il suo account viene posto in stato `pending`. Non ha alcun accesso ai dati dell'istituto fino a esplicita revisione e sblocco da parte dell'amministratore d'istituto, con attribuzione puntuale del ruolo (`viewer`, `editor`, `admin`).
- **Minimizzazione dei Dati (Art. 5, par. 1, lett. c)**: L'autenticazione richiede unicamente l'ID univoco e l'email istituzionale verificata via token crittografico Google. Nessuna password personale viene memorizzata nel sistema.
- **Accesso di Emergenza Cifrato**: Il passcode master per il primo avvio o disaster recovery è protetto con funzione di hash PBKDF2/SHA-256 e salt crittografico, mai salvato in chiaro.

### 3. Responsabilità e Oneri a Carico dell'Amministratore d'Istituto
Per una piena conformità normativa, l'Istituto Scolastico è tenuto a:
1. **Adottare HTTPS in produzione**: Pubblicare il servizio esclusivamente tramite Reverse Proxy protetto da certificato TLS/SSL (es. Let's Encrypt o certificato d'istituto) per garantire la cifratura del traffico in transito.
2. **Informativa Privacy (Artt. 13-14 GDPR)**: Integrare la gestione dell'orario scolastico nel proprio *Registro dei Trattamenti* (Art. 30 GDPR) sotto la base giuridica dell'adempimento di un obbligo legale e compito di interesse pubblico (Art. 6, par. 1, lett. c ed e GDPR).
3. **Politica di Backup**: Conservare regolarmente copie di sicurezza della cartella `/data` su supporti cifrati e protetti da accessi non autorizzati.

---

## 📜 Riconoscimenti & Credits

Il progetto SmartTimetable nasce dalla sinergia tra competenze didattiche e organizzative scolastiche, software libero ad altissime prestazioni e ingegneria AI:

- 👨‍🏫 **Autore, Ideazione & Architettura**:
  **Carlo Rigoni** &mdash; Ideazione, progettazione del modello dati scolastico italiano (organico cattedre, cdc, articolazioni di lingue, compresenze, ore a disposizione, accorpamenti macro-materie, regole blocchi orari e stampe ufficiali per collegio e classi).
- ⚡ **Motore Euristico di Calcolo FET**:
  **Liviu Lalescu** e la comunità internazionale del progetto [FET (Free Educational Timetabling Software)](https://lalescu.ro/liviu/fet/) &mdash; Straordinario algoritmo euristico C++ nativo ad alte prestazioni, distribuito come Software Libero sotto licenza GNU GPL.
- 🤖 **AI Engineering & Pair Programming**:
  **Google DeepMind Antigravity** &mdash; Ingegnerizzazione dell'architettura full-stack, design interfaccia reattiva Material 3 (stile Google Classroom), Relaxation Engine dell'Advisor vincoli, parser e generatore Microsoft Word (.docx), pipeline Docker multi-architettura e test.

---

## 📁 Struttura del Repository

```text
├── Dockerfile                   # Build multi-stage Linux (FET 7.12.0 + Python 3.12)
├── docker-compose.yml           # Configurazione Docker Compose per server/Synology/Watchtower
├── .dockerignore                # Esclusioni per build Docker
├── .gitignore                   # Esclusioni repository Git
├── SYNOLOGY_GUIDE.md            # Guida installazione su Synology NAS
├── README.md                    # Questa documentazione completa
├── setup_fet_cl.sh              # Script compilazione locale macOS di fet-cl
├── webapp/
│   ├── server.py                # Backend REST API e server HTTP (Zero dipendenze)
│   ├── database.py              # Gestore dati, persistenza, cattedre, vincoli e blocchi
│   ├── fet_engine.py            # Generatore e parser XML FET, views orario e logica vincoli
│   ├── auth.py                  # Gestore autenticazione Google OAuth, sessioni e ruoli
│   ├── print_engine.py          # Generatore stampe A3/A4 e modello Word (.docx)
│   ├── advisor.py               # Advisor intelligente preventivo e diagnostica solver
│   ├── static/
│   │   ├── index.html           # Interfaccia utente Single Page Application
│   │   ├── app.js               # Logica client-side, visualizzazioni e controlli
│   │   └── styles.css           # Foglio di stile CSS personalizzato
│   ├── seed_data/               # Dati dimostrativi di bootstrap per prima installazione
│   │   ├── current_project.json # Dataset demo Paperopoli
│   │   └── solved_timetable.fet # Orario risolto demo
│   └── data/                    # Cartella di lavoro e volume persistente montato su disco
│       ├── current_project.json # Database dell'istituto attivo
│       ├── solved_timetable.fet # Orario risolto corrente
│       └── snapshots/           # Snapshot storici e punti di ripristino
```

---

## 📄 Licenza

Distribuito sotto licenza **GNU General Public License v3 (GNU GPL v3)** in piena conformità con la licenza del motore solutore FET.  
Autore: **Carlo Rigoni** &bull; Motore: **FET 7.12.0** &bull; AI Pair Programming: **Google DeepMind Antigravity**.
