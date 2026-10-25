# 🚀 Guida all'Installazione su NAS Synology (Container Manager / Docker)

Questa guida illustra passo per passo come installare e pubblicare **Eurario** sul tuo NAS Synology, rendendolo accessibile sia all'interno della rete scolastica che su Internet in modo sicuro con certificato SSL (HTTPS).

---

## 📋 Indice
1. [Prerequisiti sul NAS Synology](#1-prerequisiti-sul-nas-synology)
2. [Metodo 1: Tramite Interfaccia Grafica Container Manager (Consigliato)](#2-metodo-1-tramite-interfaccia-grafica-container-manager-consigliato)
3. [Metodo 2: Tramite Git e riga di comando (SSH)](#3-metodo-2-tramite-git-e-riga-di-comando-ssh)
4. [Persistenza dei Dati (Backup e Snapshot)](#4-persistenza-dei-dati-backup-e-snapshot)
5. [Pubblicazione su Internet con HTTPS (Reverse Proxy Synology)](#5-pubblicazione-su-internet-con-https-reverse-proxy-synology)

---

## 1. Prerequisiti sul NAS Synology

1. **DSM 7.2 o superiore** (o DSM 7.0/7.1 con pacchetto Docker).
2. Installare il pacchetto **Container Manager** (o **Docker**) dal *Centro Pacchetti* di Synology DSM.
3. Creare la cartella per i dati persistenti:
   - Apri **File Station** su DSM.
   - Nella cartella condivisa `docker`, crea la sottocartella `smarttimetable` e al suo interno la cartella `data`:
     ```
     /docker/smarttimetable/data
     ```

---

## 2. Metodo 1: Tramite Interfaccia Grafica Container Manager (Consigliato)

### Passo 1: Crea un nuovo Progetto
1. Apri **Container Manager** da DSM.
2. Nel menu a sinistra, clicca su **Progetto** e premi il pulsante **Crea**.
3. Compila la schermata di configurazione:
   - **Nome del progetto**: `smarttimetable`
   - **Percorso**: Seleziona la cartella `/docker/smarttimetable` creata prima.
   - **Origine**: Seleziona *"Crea docker-compose.yml"*.

### Passo 2: Incolla la configurazione Docker Compose
Incolla il seguente codice nel riquadro:

```yaml
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
      # - GOOGLE_CLIENT_ID=tuo-client-id.apps.googleusercontent.com
    volumes:
      # Mappa la cartella dei dati sul NAS Synology
      - ./data:/app/webapp/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/summary"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s
```

> **💡 Vantaggio:**  
> Usando `carlorigoni/smarttimetablefet:latest`, il NAS scarica l'immagine già pronta in pochi secondi senza dover compilare il motore FET C++ sul processore del NAS!

### Passo 3: Avvia il progetto
1. Clicca su **Avanti** e poi su **Fine**.
2. Container Manager scaricherà i sorgenti o l'immagine e avvierà il container.
3. Una volta completato, apri il browser all'indirizzo:
   ```
   http://<IP-DEL-TUO-NAS>:8000
   ```
   (es. `http://192.168.1.100:8000`)

---

## 3. Metodo 2: Tramite Git e riga di comando (SSH)

Se preferisci usare il terminale o SSH sul Synology:

1. Connettiti via SSH al Synology:
   ```bash
   ssh admin@<IP-DEL-TUO-NAS>
   ```
2. Spostati nella cartella docker e clona il tuo repository GitHub:
   ```bash
   cd /volume1/docker
   git clone https://github.com/<TUO-UTENTE-GITHUB>/<REPO>.git smarttimetable
   cd smarttimetable
   ```
3. Avvia il container con Docker Compose:
   ```bash
   docker compose up -d --build
   ```
4. Controlla lo stato e i log:
   ```bash
   docker compose logs -f
   ```

---

## 4. Persistenza dei Dati (Backup e Snapshot)

Tutti i dati dell'applicazione:
- Database corrente della scuola (`current_project.json`)
- Snapshot storici salvati (`snapshots/`)
- Orario risolto corrente (`solved_timetable.fet`)

vengono salvati automaticamente all'interno della cartella:
```
/volume1/docker/smarttimetable/data
```
- In caso di aggiornamento dell'immagine Docker o riavvio del NAS, **nessun dato andrà perso**.
- Per fare un backup dell'intera scuola, ti basta copiare o archiviare la cartella `data/` oppure usare **Synology Hyper Backup**.

---

## 5. Pubblicazione su Internet con HTTPS (Reverse Proxy Synology)

Per permettere a docenti, studenti e famiglie di accedere all'applicazione in modo sicuro (es. `https://orario.scuola.it` o `https://tuonome.synology.me`):

1. **Configura il Reverse Proxy su DSM**:
   - Apri **Pannello di controllo** di DSM.
   - Vai su **Portale di accesso** (o *Portale delle applicazioni*) $\rightarrow$ scheda **Avanzate** $\rightarrow$ pulsante **Proxy inverso**.
   - Clicca su **Crea** e imposta:
     - **Descrizione**: `Eurario`
     - **Sorgente**:
       - Protocollo: `HTTPS`
       - Nome host: `orario.iltuodominio.it` (oppure il tuo indirizzo Synology DDNS `tuonome.synology.me`)
       - Porta: `443`
       - Seleziona *"Abilita HSTS"*
     - **Destinazione**:
       - Protocollo: `HTTP`
       - Nome host: `localhost` (oppure `127.0.0.1`)
       - Porta: `8000`
2. **Abilita il supporto WebSocket (fondamentale per lo streaming del solutore FET in tempo reale)**:
   - Nella stessa finestra del Proxy inverso, clicca sulla scheda **Intestazione personalizzata**.
   - Clicca su **Crea** $\rightarrow$ seleziona **WebSocket**.
   - DSM aggiungerà automaticamente `Upgrade` e `Connection`. Clicca su **Salva**.

3. **Certificato SSL Gratuito (Let's Encrypt)**:
   - Vai su **Pannello di controllo** $\rightarrow$ **Sicurezza** $\rightarrow$ scheda **Certificato**.
   - Clicca su **Aggiungi** $\rightarrow$ *Aggiungi nuovo certificato* $\rightarrow$ *Ottieni un certificato da Let's Encrypt*.
   - Inserisci il dominio (es. `orario.iltuodominio.it`) e la tua email.
   - Nella scheda **Impostazioni**, assegna il nuovo certificato al Proxy inverso appena creato.

Ora l'applicazione è online e protetta da HTTPS per tutta la comunità scolastica! 🎉
