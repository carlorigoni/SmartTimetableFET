---
title: Architettura & DevOps Pipeline
description: Guida dettagliata e visuale all'architettura software di Eurario, alla pipeline CI/CD con GitHub e Docker Hub, al controllo di versione e agli aggiornamenti automatici in produzione.
---

# 🏗️ Architettura del Software & Pipeline DevOps

Eurario è progettato secondo una filosofia ingegneristica rigorosa: **zero dipendenze esterne Python**, footprint di memoria minimale, motore solutore nativo in C++ ad alte prestazioni e una pipeline automatizzata di Continuous Integration e Continuous Deployment (CI/CD) che garantisce massima affidabilità sia per installazioni cloud gestite che per server on-premise scolastici.

In questa pagina viene descritto in dettaglio il funzionamento dell'intero ecosistema: dall'editing dei file sorgente in ambiente di sviluppo locale, ai workflow di controllo versione su GitHub, alla generazione delle immagini container su Docker Hub, fino alla distribuzione automatica su Cloudflare Pages e all'aggiornamento dei server di produzione.

---

## 1. Mappa E2E dell'Ecosistema Eurario

Il diagramma seguente illustra l'intero flusso di interazione tra i componenti locali, i repository remoti, i registri container, la rete CDN e i server di produzione:

```mermaid
flowchart TD
    subgraph LocalDev["💻 Ambiente di Sviluppo Locale"]
        DevFiles["Sorgenti Eurario\n(Python, HTML5, Vanilla JS, CSS)"]
        LocalFET["Compilatore & Solutore\nFET 7.12 Nativo (C++)"]
        LocalTest["Test di Integrazione\n& Validazione Vincoli"]
        DevFiles --> LocalFET
        LocalFET --> LocalTest
    end

    subgraph GitHubRepo["🐙 GitHub Repository (carlorigoni/eurario)"]
        MainBranch["Branch main\n(Codice Stabile & Verificato)"]
        GitTag["Git Tag di Rilascio\n(es. v1.9.6)"]
        GHActions["GitHub Actions\n(Validazione Docs & Test Build)"]
        MainBranch --> GitTag
        MainBranch --> GHActions
    end

    subgraph CDNPipeline["☁️ Cloudflare Pages (Edge CDN)"]
        CF_Landing["eurario.it\n(Landing Page & Showcase)"]
        CF_Docs["docs.eurario.it\n(Manuale & Documentazione Zensical)"]
    end

    subgraph ContainerRegistry["🐳 Docker Hub Registry (carlorigoni/eurario)"]
        MultiArchBuild["Build Multi-Architettura\n(linux/amd64 & linux/arm64)"]
        TagLatest["Tag: latest\n(Rolling Production Tag)"]
        TagVersion["Tag Immutabile: vX.Y.Z\n(es. :v1.9.6)"]
        MultiArchBuild --> TagLatest
        MultiArchBuild --> TagVersion
    end

    subgraph ProductionEnv["🏢 Server di Produzione & Istituti Scolastici"]
        subgraph ServerHost["Server Host / VM / NAS"]
            ReverseProxy["Reverse Proxy & TLS\n(Caddy / Nginx / Cloudflare Tunnel)"]
            DockerEngine["Docker Engine Runtime"]
            Watchtower["Watchtower / Update Cron\n(Controllo Notturno Nuove Immagini)"]
            PersistentVol["Volume Dati Persistente\n(/instance <-> ./data host)"]
        end
        subgraph ContainerApp["Container Eurario"]
            PyServer["Server HTTP Python\n(Standard Library nativa)"]
            AuthEngine["Auth & Brute-Force Defense\n(PBKDF2 600k + Rate Limiter)"]
            FETExec["fet-cl Nativo\n(Binario compilato C++)"]
            LocalData["Storage JSON / Snapshot .fet\n(Anagrafiche, Vincoli, Orari)"]
        end
    end

    %% Relazioni tra ambienti
    DevFiles -->|"git commit & git push"| MainBranch
    GitTag -->|"Trigger Build Automatica"| MultiArchBuild
    MainBranch -->|"Webhook Git Deploy"| CF_Landing
    MainBranch -->|"Webhook Git Deploy"| CF_Docs

    TagLatest -.->|"docker pull / auto-update"| DockerEngine
    DockerEngine --> ContainerApp
    ReverseProxy -->|"Proxy pass :8000"| PyServer
    PyServer --> AuthEngine
    PyServer --> FETExec
    PyServer <--> LocalData
    LocalData <--> PersistentVol
    Watchtower -.->|"Interroga Tags"| TagLatest

    ContainerApp -.->|"Verifica Nuove Versioni\nvia Docker Hub API"| ContainerRegistry
```

---

## 2. Componenti Software Interni & Runtime Locale

L'architettura del software è concepita per eliminare qualsiasi complessità superflua e garantire longevità decennale senza rotture provocate da aggiornamenti di librerie di terze parti:

```mermaid
graph LR
    Browser["🌐 Browser Client\n(Material 3 / Vanilla ES6)"] 
    -->|"HTTP REST API & EventStream"| ServerPy["⚙️ webapp/server.py\n(Python HTTP Server Nativo)"]
    
    subgraph CoreBackend["Backend Eurario (Standard Library Only)"]
        ServerPy --> AuthPy["🛡️ webapp/auth.py\n(PBKDF2, IP Lockout, Rate Limiter)"]
        ServerPy --> Exporter["📄 Procedura 9 & 12\n(Generatore PDF A3/A4 e Word .docx)"]
        ServerPy --> SolverManager["⚡ Timetable Solver Manager\n(Subprocess fet-cl C++)"]
    end

    subgraph NativeBinary["Solutore ad Alte Prestazioni"]
        SolverManager --> FET["bin/fet-cl\n(C++ Nativo Qt-Free FET 7.12.0)"]
    end

    subgraph DataStorage["Persistenza Dati Atomica (instance/)"]
        ServerPy <--> JsonData["data.json / settings.json\n(Salvataggio Atomico con lock)"]
        ServerPy <--> Snapshots["snapshots/\n(Punti di ripristino .fet e .json)"]
        FET --> SolutionXML["orario_soluzione.xml\n(Risultato del calcolo orario)"]
    end
```

### Dettaglio dei singoli layer:

1. **Frontend (Zero-Framework Vanilla Stack)**:
   - Scritto in **HTML5 semantico**, **Vanilla ES6+ JavaScript** e **CSS moderno** con variabili personalizzate per il supporto dinamico a Tema Chiaro e Tema Scuro.
   - Design System ispirato a Google Classroom / Google Material 3 (colori istituzionali `#1B2A4A`, `#059669`, `#E4572E`, card modulari, rail flyout per la barra laterale).
   - Nessun bundler (Webpack, Vite o Rollup) in fase di esecuzione: il caricamento è immediato, con cache-busting automatico tramite query param di versione (`?v=1.9.5`).

2. **Backend Python (`webapp/server.py` & `webapp/auth.py`)**:
   - Esegue su Python 3.10+ utilizzando **esclusivamente moduli della Standard Library**: `http.server`, `urllib`, `json`, `hashlib`, `hmac`, `secrets`, `subprocess`, `threading`.
   - Nessun framework pesante (Django/FastAPI) e nessuna dipendenza di rete runtime.
   - Sicurezza enterprise: password con hash crittografico **PBKDF2-HMAC-SHA256 a 600.000 iterazioni**, salting casuale crittografico (16 byte), delay esponenziale (tarpit) e blocco IP automatico temporizzato contro attacchi brute-force.

3. **Motore Solutore Euristico (`bin/fet-cl`)**:
   - Binario compilato nativo in C++ dal codice sorgente di FET 7.12.0 (ideato da Liviu Lalescu e Volker Dirr).
   - Viene invocato dal server Python come subprocess indipendente con passaggio argomenti ottimizzato. Non carica l'interfaccia grafica Qt, operando in modalità pura a riga di comando per la massima velocità di calcolo e stabilità su server headless.

4. **Storage Atomico su File System (`instance/` e `data/`)**:
   - Nessun database relazionale esterno da configurare o mantenere (niente Postgres o MySQL complessi).
   - I dati scolastici, le anagrafiche docenti, i blocchi orari e le preferenze risiedono in file JSON strutturati.
   - Le scritture su disco sono atomiche (scrittura su file temporaneo seguita da `os.replace`), prevenendo qualsiasi corruzione anche in caso di improvvisa interruzione di alimentazione.

---

## 3. Gestione del Controllo di Versione & Flusso Git

Eurario adotta il modello **Semantic Versioning (SemVer 2.0.0)** nel formato `vMAJOR.MINOR.PATCH`:

* **`MAJOR`**: Rilasci architetturali di vasta portata o cambiamenti strutturali profondi.
* **`MINOR`**: Nuove funzionalità applicative, integrazioni di nuove procedure di stampa o estensioni dei vincoli FET.
* **`PATCH`**: Correzioni di bug, ottimizzazioni prestazionali, rifiniture grafiche e aggiornamenti di sicurezza.

### File sincronizzati all'avanzamento di versione:

A ogni cambio versione, un set coerente di file viene sincronizzato per garantire che l'intero ecosistema esponga lo stesso identico identificativo:

| File | Identificativo / Variabile | Scopo |
| :--- | :--- | :--- |
| `webapp/server.py` | `APP_VERSION = "1.9.5"` | Esposta dalle API server e nei log di avvio |
| `webapp/static/app.js` | `const APP_VERSION = '1.9.5'` | Utilizzata per il check remoto su Docker Hub |
| `webapp/static/index.html` | Etichette UI e cache buster (`?v=1.9.5`) | Sidebar, About modal e invalidazione cache browser |
| `landing/content/site_data.json` | `"current_version": "v1.9.5"` | Visualizzazione versione su eurario.it e annunci |
| `landing/index.html` | `#liveVerTag` | Tag dell'immagine consigliata nella sezione hero |
| `zensical.toml` | Query parameter asset CSS/JS | Cache busting per la documentazione docs.eurario.it |

---

## 4. Pipeline di Containerizzazione su Docker Hub

Alla creazione di un nuovo Git Tag (es. `git tag v1.9.5 && git push origin v1.9.5`), viene generata l'immagine container multi-piattaforma ufficiale:

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Sviluppatore / Maintainer
    participant Git as GitHub (carlorigoni/eurario)
    participant Hub as Docker Hub Registry
    participant Prod as Server di Produzione

    Dev->>Git: git push origin v1.9.5
    Note over Git,Hub: Automated Multi-Arch Build Trigger
    Git->>Hub: Compilazione container per linux/amd64 e linux/arm64
    Hub->>Hub: Pubblicazione carlorigoni/eurario:v1.9.5
    Hub->>Hub: Aggiornamento tag carlorigoni/eurario:latest

    loop Controllo Periodico (Client o Server)
        Prod->>Hub: GET /v2/repositories/carlorigoni/eurario/tags
        Hub-->>Prod: Elenco ultimi tag pubblicati (latest: v1.9.5)
    end

    alt Versione Locale < Ultimo Tag
        Prod->>Prod: Mostra notifica "Nuovo Aggiornamento Disponibile"
        Prod->>Hub: docker compose pull && docker compose up -d
        Prod->>Prod: Riavvio a caldo con dati persistenti intatti
    else Versione Locale == Ultimo Tag
        Prod->>Prod: Badge verde "Release Stabile Allineata"
    end
```

### Multi-Architettura:
La build genera un unico manifest multi-arch che raggruppa:
- **`linux/amd64`**: per server cloud tradizionali, VM e PC con processori Intel/AMD.
- **`linux/arm64`**: per Apple Silicon (M1/M2/M3/M4), VPS Hetzner CAX basati su Ampere Altra e Raspberry Pi 5.

Quando l'amministratore esegue `docker pull carlorigoni/eurario:latest`, il demone Docker seleziona in automatico l'architettura adatta all'hardware in uso.

---

## 5. Controllo di Versione & Aggiornamenti nel Server di Produzione

Eurario include un meccanismo integrato di autodiagnosi e monitoraggio degli aggiornamenti accessibile sia dalla barra di stato della WebApp che tramite automazione di sistema:

### 1. Rilevamento tramite API di Docker Hub
Nella WebApp, la funzione client interroga l'endpoint pubblico:
```http
GET https://hub.docker.com/v2/repositories/carlorigoni/eurario/tags?page_size=10
```
La risposta JSON contiene tutti i tag rilasciati con i relativi digest e timestamp di creazione. L'algoritmo di confronto estrae l'ultimo tag valido che segue la convenzione `vX.Y.Z` e lo confronta numericamente con `APP_VERSION`:

* Se `Versione Remota > Versione Locale`: il badge nel footer della sidebar diventa arancione/ambra e invita l'amministratore a procedere con l'aggiornamento.
* Cliccando sul badge, si apre il **Modal di Verifica Aggiornamenti** con la data del rilascio e le istruzioni immediate di aggiornamento.

### 2. Aggiornamento Manuale (Zero Rischio)
Per aggiornare un'installazione Docker Compose esistente, è sufficiente eseguire due comandi nella directory del server:

```bash
docker compose pull
docker compose up -d
```

Grazie al montaggio del volume locale (`./data:/app/data` o `./instance:/app/instance`), il container precedente viene sostituito dal nuovo in meno di 5 secondi, mantenendo intatti al 100%:
- Anagrafiche dell'istituto e docenti;
- Storico degli snapshot e file `.fet`;
- Password e credenziali master;
- Registri di audit e log degli accessi.

### 3. Aggiornamento Automatico Notturno con Watchtower
Per gli istituti scolastici che desiderano aggiornamenti silenti e automatici senza interventi manuali, è possibile affiancare il container **Watchtower**:

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

> [!NOTE]
> Con questa configurazione, ogni 24 ore Watchtower verifica se su Docker Hub è presente un'immagine più recente di `carlorigoni/eurario:latest`. Se presente, la scarica, riavvia `eurario-app` e rimuove la vecchia immagine inutilizzata.

---

## 6. Il Ruolo Strategico di Cloudflare nell'Ecosistema Eurario

Cloudflare costituisce il pilastro di rete e sicurezza dell'intera infrastruttura Eurario, assolvendo a tre funzioni critiche distinte: **Hosting Edge CI/CD (Cloudflare Pages)**, **Protezione DNS & WAF Anycast**, e **Connessione Sicura On-Premise (Cloudflare Tunnel)**:

```mermaid
flowchart LR
    subgraph InternetUsers["🌐 Docenti, Studenti & Visitatori"]
        BrowserDocs["Consultazione Manuale\n(docs.eurario.it)"]
        BrowserLanding["Visitatore & Showcase\n(eurario.it)"]
        BrowserApp["Dirigente & Commissione Orario\n(app.eurario.it)"]
    end

    subgraph CloudflareGlobal["☁️ Rete Edge Globale Cloudflare (300+ Città)"]
        subgraph CFEnhancements["Edge Security, DNS & Acceleration"]
            EdgeDNS["Anycast DNS (1.1.1.1)\n+ WAF + Anti-DDoS L3/L4/L7"]
            EdgeTLS["Terminazione SSL/TLS Automatica\n+ HTTP/3 (QUIC) + Compressione Brotli"]
        end
        subgraph CFPages["Cloudflare Pages (Static Edge CI/CD)"]
            EdgeDocs["docs.eurario.it\n(Build Zensical & Cache Globale)"]
            EdgeLanding["eurario.it\n(Static Showcase & Demo)"]
        end
        subgraph CFTunnel["Cloudflare Zero-Trust Network"]
            EdgeTunnelEndpoint["Cloudflare Tunnel Edge Endpoint\n(Ingress Criptato)"]
        end
    end

    subgraph SchoolInfrastructure["🏫 Rete Istituto Scolastico / Server Host"]
        subgraph LocalFirewall["Firewall Scolastico (Nessuna porta aperta in ingresso)"]
            Cloudflared["cloudflared Daemon (Container)\n(Connessione crittografata outbound)"]
            EurarioContainer["Eurario WebApp Container\n(:8000 locale isolato)"]
            SchoolData["Storage Dati Persistenti\n(instance/ e snapshots/)"]
        end
    end

    BrowserDocs --> EdgeDNS --> EdgeTLS --> EdgeDocs
    BrowserLanding --> EdgeDNS --> EdgeTLS --> EdgeLanding
    BrowserApp --> EdgeDNS --> EdgeTLS --> EdgeTunnelEndpoint
    EdgeTunnelEndpoint <==|"Tunnel QUIC/TLS Outbound (Bypass NAT/Firewall)"|==> Cloudflared
    Cloudflared -->|"HTTP interno :8000"| EurarioContainer
    EurarioContainer <--> SchoolData
```

### 6.1 Cloudflare Pages: CI/CD & Static Edge Hosting

I siti pubblici ad alto traffico ([eurario.it](https://eurario.it) e [docs.eurario.it](https://docs.eurario.it)) non risiedono sul server di calcolo degli orari, ma sono distribuiti in modalità *serverless static edge* tramite **Cloudflare Pages**:

* **Deploy Continuo su Git Push**: A ogni push sul branch `main` di GitHub, Cloudflare Pages clona il repository in un runner isolato ed esegue il comando di build:
  ```bash
  pip install zensical && zensical build
  ```
* **Prestazioni Sub-Millisecondo**: I file compilati HTML, CSS, JavaScript e le immagini SVG sono replicati istantaneamente su oltre 300 data center edge in tutto il mondo, garantendo tempi di caricamento inferiori a 15 millisecondi e disponibilità 100% SLA.
* **Isolamento Totale**: Un picco di visite su `eurario.it` o la consultazione massiva della documentazione non sottrae neanche un singolo ciclo di CPU al motore solutore FET in esecuzione sull'istanza applicativa.

### 6.2 Cloudflare DNS, WAF & Terminazione SSL/TLS

Tutti i domini dell'ecosistema sono gestiti attraverso la rete DNS Anycast di Cloudflare:

* **Certificati SSL/TLS Rigorosi**: Gestione automatica del rinnovo certificati con crittografia end-to-end *Full (Strict)*, abilitazione trasparente di **HTTP/3 (QUIC)** e fallback HTTP/2.
* **Scudo Anti-DDoS & WAF**: Mitigazione volumetrica istantanea contro attacchi Denial of Service a livello 3, 4 e 7.
* **Ottimizzazione Asset**: Compressione dinamica **Brotli** e minificazione al volo per ridurre al minimo il consumo di banda.

### 6.3 Cloudflare Tunnel (`cloudflared`): Esposizione On-Premise a Zero-Trust

Per gli istituti scolastici italiani che installano Eurario on-premise sui propri server interni (o VM), la configurazione di rete presenta storicamente ostacoli notevoli:
* Reti protette da firewall rigidi ministeriali o provinciali;
* Presenza di doppi o tripli NAT senza controllo del router perimetrale;
* Mancanza di un indirizzo IP pubblico statico;
* Divieto di aprire porte in ingresso (`80` o `443`) per motivi di sicurezza informatica.

**Cloudflare Tunnel** risolve radicalmente questi vincoli tramite il demone leggero `cloudflared`:

1. **Solo Connessione Outbound**: Il container `cloudflared` in esecuzione nel server della scuola stabilisce una connessione crittografata verso i nodi perimetrali Cloudflare più vicini (utilizzando porte in uscita `443` o `7844/UDP`).
2. **Nessuna Porta Aperta nel Router**: Tutte le porte in ingresso del firewall scolastico rimangono **ermeticamente chiuse**. Non è richiesto alcun port-forwarding o IP statico.
3. **Instradamento Sicuro**: Gli utenti autorizzati (docenti e commissione orario) navigano su `https://app.eurario.it` o sul sottodominio scolastico `https://orario.istituto.edu.it`: Cloudflare riceve la richiesta cifrata e la inoltra attraverso il tunnel verso il container locale `eurario:8000`.

#### Esempio di Deploy Docker Compose con Cloudflare Tunnel:

```yaml
version: '3.8'

services:
  eurario:
    image: carlorigoni/eurario:latest
    container_name: eurario-app
    restart: unless-stopped
    volumes:
      - ./data:/app/data
    environment:
      - PORT=8000
    # Nota: la porta 8000 non necessita neanche di essere esposta all'esterno del server!

  tunnel:
    image: cloudflare/cloudflared:latest
    container_name: eurario-tunnel
    restart: unless-stopped
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... # Token generato da Cloudflare Zero Trust
```

> [!TIP]
> Questa architettura garantisce che il server scolastico rimanga totalmente invisibile agli scanner di porte su Internet, beneficiando contestualmente della protezione DDoS globale e del certificato HTTPS gestito di Cloudflare.
