# 🚀 Guida di Configurazione della Landing Page (eurario.it)

Questa guida illustra come pubblicare la nuova **Landing Page istituzionale bilingue (Italiano & Inglese)** su `eurario.it` separandola dall'applicazione operativa su `app.eurario.it`, e come mantenere aggiornati i contenuti del sito in modo **sostenibile, multilingua e a costo zero**.

---

## 🏛️ 1. Architettura dei Domini

| Dominio | Servizio | Destinazione |
| :--- | :--- | :--- |
| **`eurario.it`** / `www.eurario.it` | **Landing Page pubblica bilingue** (Vetrina, Features, FAQ, SEO) | Cloudflare Pages / Workers (0 €) o GitHub Pages |
| **`app.eurario.it`** | **Web App Operativa** (Login, Solver FET, Orario) | Container Docker (`carlorigoni/eurario:latest`) via Tunnel |

---

## ✏️ 2. Come Aggiornare i Contenuti in Maniera Sostenibile (Bilingue)

Tutti i testi della landing page risiedono nel file:
👉 **[`landing/content/site_data.json`](./content/site_data.json)**

Il file è organizzato in due sezioni simmetriche:
- `"it"` per la versione in lingua italiana.
- `"en"` per la versione in lingua inglese.

Per aggiornare il sito **non serve toccare l'HTML**:
- **Novità / Annunci**: Aggiungi o modifica gli annunci in `"announcements"` sia in `"it"` che in `"en"`.
- **Nuove Funzionalità / Punti di Forza**: Modifica l'array `"pillars"`.
- **Tabella di Confronto**: Aggiorna `"comparison"`.
- **Modelli di Adozione & Piani SaaS Cloud**: Modifica i piani e le caratteristiche in `"deployment_plans"`.
- **Domande Frequenti**: Aggiungi o ritocca `"faq"`.
- **Versione Corrente**: Cambia il campo `"current_version"` sotto `"site"`.

### 🌍 Selettore Lingua Automatico & Manuale
- Il sito include un toggle istantaneo `🇮🇹 IT | 🇬🇧 EN` nella barra di navigazione.
- Memorizza la preferenza nel `localStorage` del visitatore.
- Supporta il parametro URL esplicito (es. `https://eurario.it/?lang=en`).
- Rileva automaticamente la lingua del browser (`navigator.language`).

---

## 🌐 3. Distribuzione con Cloudflare Workers / Pages

Grazie al file [`wrangler.toml`](../wrangler.toml) presente nella radice del repository:
1. Cloudflare distribuisce direttamente i file statici della cartella `landing/`.
2. Assegna i domini personalizzati `eurario.it` e `www.eurario.it` nelle impostazioni del progetto.
3. Nel Cloudflare Tunnel (`eule.ro`), mantieni instradato solo `app.eurario.it` verso `http://localhost:8000`.
