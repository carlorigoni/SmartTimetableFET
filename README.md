# 🎓 SmartTimetable - Suite Completa per l'Orario Scolastico con FET 7.12.0

Applicazione web moderna, performante e intuitiva per la progettazione, ottimizzazione e pubblicazione dell'orario scolastico negli Istituti Superiori italiani, integrata con il solutore open source ad alte prestazioni **FET (Free Timetabling Software) 7.12.0**.

---

## 🌟 Caratteristiche Principali

- **Solutore FET 7.12.0 Integrato**:
  - Compilazione orario automatica in tempo reale con visualizzazione live dello stream del solutore e rilevamento colli di bottiglia (*bottleneck activities*).
  - Supporto al salvataggio e ripristino istantaneo dello stadio più avanzato (*highest stage*) in caso di arresto manuale o timeout.
- **Sistema di Blocco Orario (Locking)**:
  - Possibilità di bloccare intere classi o singole ore nella griglia oraria con vincoli FET permanenti al 100% (`ConstraintActivityPreferredStartingTime` e `ConstraintActivityPreferredRoom`), preservando fedelmente le collocazioni desiderate nei ricalcoli successivi.
- **Gestione Completa dell'Istituto**:
  - **Docenti**: orari di cattedra, tipologia contratto (intere, COE, spezzone, part-time), ore buche, massimo ore giornaliere e giorni liberi.
  - **Classi e Gruppi**: articolazioni per lingua straniera (es. Francese, Spagnolo, Tedesco), suddivisioni biennio/triennio per indirizzo di studio.
  - **Aule e Spazi Specialistici**: aule base, palestre condivise con capienza simultanea, laboratori di informatica, scienze e lingue.
  - **Attività e Cattedre**: raggruppamento automatico delle sotto-attività didattiche, gestione avanzata blocchi orari (formule standard di default ed eccezioni personalizzate).
  - **Macro-Materie e Accorpamenti**: unione intelligente di cattedre affini (es. *Italiano Latino Storia e Geografia*) per un bilanciamento didattico ottimale.
  - **Disposizioni Intelligenti**: collocazione automatica delle ore a disposizione senza buchi e senza sovrapposizioni a lezioni pluri-orarie.
- **Sincronizzazione Organico e Import/Export**:
  - Download diretto del **Modello Word (.docx)** pre-formattato per l'organico o esportazione istantanea dell'organico attuale in Word.
  - Sincronizzazione automatica dei dati da file `.docx` dell'Organico o direttamente da Google Docs tramite link di condivisione.
  - Import ed export bidirezionale nativo del file `ParametriOrario.fet` e dell'orario risolto `..._data_and_timetable.fet`.
  - Sistema di snapshot e versioning temporale dell'intero progetto.
- **Dataset Demo "Paperopoli" & Reset a Foglio Bianco**:
  - Include un istituto didattico completo e funzionante (*Liceo & Tecnico "Pico De Paperis"*, 8 docenti Disney, 5 classi, laboratori, palestra e orario già risolto al 100% in FET) per esplorare subito tutte le funzionalità senza panico da "foglio vuoto".
  - Pulsanti rapidi in archivio per ripristinare la demo o azzerare completamente il database preparando una nuova scuola.
- **Architettura Leggera e Resiliente**:
  - **Zero dipendenze Python esterne** (utilizza esclusivamente la libreria standard di Python).
  - Interfaccia grafica reattiva, moderna e compatibile con tutti i browser (Safari, Chrome, Firefox, Edge).

---

## 🚀 Avvio Rapido

### Opzione 1: Locale (macOS / Linux)

1. Assicurati di avere **Python 3.10+** installato.
2. Compila il solutore `fet-cl` se non presente:
   ```bash
   ./setup_fet_cl.sh
   ```
3. Avvia l'applicazione:
   ```bash
   python3 webapp/server.py
   ```
4. Apri il browser all'indirizzo [http://localhost:8000](http://localhost:8000).

---

### Opzione 2: Docker & Docker Compose

L'applicazione include un `Dockerfile` multi-stage che compila automaticamente il motore FET 7.12.0 in ambiente Linux Debian.

```bash
# Avvio con Docker Compose
docker compose up -d --build

# Visualizzazione log
docker compose logs -f
```
L'applicazione sarà accessibile all'indirizzo `http://localhost:8000`.

---

## 📦 Installazione su NAS Synology (Container Manager)

Per installare SmartTimetable su un NAS Synology e pubblicarlo con certificato HTTPS per tutta la scuola:

👉 **Consulta la guida dedicata completa:** [`SYNOLOGY_GUIDE.md`](./SYNOLOGY_GUIDE.md)

Include:
- Configurazione con l'interfaccia grafica di **Synology Container Manager**.
- Mappatura dei volumi per la persistenza di database, snapshot e orari.
- Configurazione del **Reverse Proxy Synology** con certificato SSL Let's Encrypt gratuito e supporto WebSocket.

---

## 🐙 Come Salvare il Progetto su GitHub

1. **Inizializza Git nel progetto (se non già fatto)**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: SmartTimetable suite completa FET 7.12.0"
   ```

2. **Crea un nuovo repository su GitHub**:
   - Vai su [github.com/new](https://github.com/new).
   - Assegna un nome al repository (es. `smarttimetable` o `orario-scuola`).
   - Scegli se renderlo **Privato** o **Pubblico**.
   - **Non** selezionare "Initialize with README" o ".gitignore" (sono già presenti nel progetto).

3. **Collega il repository locale e pubblica il codice**:
   ```bash
   git remote add origin https://github.com/<TUO-UTENTE-GITHUB>/<NOME-REPO>.git
   git branch -M main
   git push -u origin main
   ```

4. **Compilazione Automatica Immagine Docker (GitHub Actions)**:
   - Il progetto include il workflow `.github/workflows/docker-publish.yml`.
   - Ad ogni `push` sul ramo `main`, GitHub compilerà automaticamente l'immagine multi-architettura (`linux/amd64` e `linux/arm64`) e la pubblicherà su **GitHub Container Registry (`ghcr.io`)**.
   - Potrai quindi installare l'orario su qualsiasi server o NAS Synology con un solo comando senza attendere la compilazione C++ locale!

---

## 📁 Struttura della Cartella

```text
├── Dockerfile                   # Build multi-stage Linux (FET 7.12.0 + Python 3.12)
├── docker-compose.yml           # Configurazione Docker Compose per Synology/server
├── .dockerignore                # Esclusioni per build Docker
├── .gitignore                   # Esclusioni repository Git
├── SYNOLOGY_GUIDE.md            # Guida dettagliata installazione su Synology NAS
├── README.md                    # Questa documentazione
├── setup_fet_cl.sh              # Script compilazione locale macOS di fet-cl
├── webapp/
│   ├── server.py                # Backend REST API e server HTTP (Zero dipendenze)
│   ├── database.py              # Gestore dati, persistenza, cattedre, vincoli e blocchi
│   ├── fet_engine.py            # Generatore e parser XML FET, views orario e logica vincoli
│   ├── static/
│   │   ├── index.html           # Interfaccia utente Single Page Application
│   │   ├── app.js               # Logica client-side, visualizzazioni e controlli
│   │   └── styles.css           # Foglio di stile CSS personalizzato
│   ├── seed_data/               # Dati di bootstrap per prima installazione container
│   │   ├── current_project.json
│   │   └── solved_timetable.fet
│   └── data/                    # Cartella di lavoro e volume persistente
│       ├── current_project.json # Database dell'istituto
│       ├── solved_timetable.fet # Orario risolto
│       └── snapshots/           # Snapshot storici
```

---

## 📄 Licenza

Distribuito sotto licenza GNU GPL v3 in conformità con la licenza del motore solutore FET.
