# cstrsk.de Workspace & Room Booking System

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable-success.svg)](#progressive-web-app-pwa--offline-modus)
[![Frontend](https://img.shields.io/badge/Frontend-Mithril.js%202.2%20%2B%20TailwindCSS-0070AD.svg)](#tech-stack)
[![Backend](https://img.shields.io/badge/Backend-PHP%208%20%2B%20SQLite%20PDO-8892BF.svg)](#backend-architektur)
[![DSGVO / GDPR](https://img.shields.io/badge/DSGVO-Konform-0D1628.svg)](#dsgvo--datenschutz)
[![WCAG AA](https://img.shields.io/badge/WCAG-2.1_AA-10B981.svg)](#barrierefreiheit--design)
[![Author](https://img.shields.io/badge/Projekt-cstrsk.de-C5006E.svg)](https://cstrsk.de)

Ein vollständiges, produktionsnahes und DSGVO-konformes Buchungssystem für **Seminarräume**, **Einzeltische** und **Shared-Workspace-Plätze** (Hot Desks & Fixed Desks) als installierbare **Progressive Web App (PWA)**. 

Entwickelt für den DACH-Markt mit nativer Zeitzonenbehandlung (`Europe/Berlin`), automatischer Sommerzeitberechnung, § 14 UStG-konformer Rechnungsstellung und kompromissloser Sicherheit.

> **Projektwebseite:** [https://cstrsk.de](https://cstrsk.de)  
> **Lizenz:** Freie Software unter der [GNU Affero General Public License Version 3 (AGPL-3.0)](./LICENSE)

---

## Inhaltsverzeichnis

1. [Highlights & Funktionen](#highlights--funktionen)
2. [Tech-Stack](#tech-stack)
3. [Mithril.js Streams State Management](#mithriljs-streams-state-management)
   - [Architektur-Überblick](#architektur-überblick)
   - [1. User Authentication Streams](#1-user-authentication-streams)
   - [2. Resource Data & Filter Streams](#2-resource-data--filter-streams)
   - [3. Current Booking Selection Streams](#3-current-booking-selection-streams)
   - [4. Reactive Combining & Auto-Pricing](#4-reactive-combining--auto-pricing)
   - [5. Action Dispatcher & State Bridge](#5-action-dispatcher--state-bridge)
4. [Ressourcentypen](#ressourcentypen)
5. [Progressive Web App (PWA) & Offline-Modus](#progressive-web-app-pwa--offline-modus)
6. [Backend-Architektur & REST-API](#backend-architektur--rest-api)
7. [Datenmodell (SQLite)](#datenmodell-sqlite)
8. [DSGVO & Datenschutz](#dsgvo--datenschutz)
9. [Installation & Deployment](#installation--deployment)
   - [IONOS / Shared Hosting (PHP 8 + Apache)](#ionos--shared-hosting-php-8--apache)
   - [Lokale Entwicklung (Node.js / Express)](#lokale-entwicklung-nodejs--express)
10. [Standard-Zugangsdaten (Seed-Daten)](#standard-zugangsdaten-seed-daten)
11. [Lizenz](#lizenz)

---

## Highlights & Funktionen

- 🏢 **Multi-Ressourcenverwaltung:** Seminarräume (inkl. Bestuhlungsvarianten), Einzeltische und Shared-Workspace-Plätze.
- ⚡ **Zero-Build & Ultra-Lightweight:** Lauffähig ohne Node.js-Buildprozess im Produktivbetrieb – direkt per SFTP auf jedem Shared Webhosting (z. B. IONOS) installierbar.
- 📅 **Raumplan-Raster (Matrix):** Interaktiver Zeitplan mit Ressourcen als Zeilen und Uhrzeiten als Spalten zur visuellen Erkennung freier Zeitfenster.
- 🔒 **Transaktionssichere Buchung:** Atomare SQLite-Transaktionen (`BEGIN IMMEDIATE`) schließen Doppelbuchungen ("Race Conditions") serverseitig garantiert aus.
- 🔁 **Serienbuchungen:** Tägliche, wöchentliche oder monatliche Wiederholungen mit automatischem Vorab-Konfliktscan über alle Einzeltermine.
- 📱 **QR-Code Check-in:** Jeder Buchungseintrag erzeugt einen fälschungssicheren QR-Code-Token für das Einchecken vor Ort.
- ⏳ **Wartelisten-Automatik:** Voll besetzte Slots können abonniert werden; bei Stornierung erfolgt sofortige Benachrichtigung.
- 🧾 **Rechnungsstellung nach § 14 UStG:** Netto-, Steuer- (19% MwSt) und Bruttobetrag-Kalkulation mit browserseitiger PDF-Druckansicht.
- 📆 **RFC-5545 iCalendar:** Download von `.ics`-Dateien für Apple Kalender, Google Kalender und Microsoft Outlook.
- 📊 **Admin-Dashboard:** KPI-Kacheln für Auslastung, Umsatz, No-Show-Rate, Genehmigungs-Workflows und CSV-Export für Buchhaltung/Excel.
- 🛡️ **DSGVO-Werkzeuge:** Transparente Datenschutzeinwilligung, maschinenlesbarer JSON-Datenexport (Art. 20) und Selbstlöschung des Kontos (Art. 17).
- 📶 **PWA & Offline-Fähig:** Eigene Buchungen und Check-in-Codes sind dank Service-Worker-Caching auch im Funkloch abrufbar.
- 🌓 **Dark- & Light-Mode:** Barrierefreie Farbgestaltung nach WCAG 2.1 AA mit automatischem System-Theme-Support.

---

## Tech-Stack

| Ebene | Technologie | Beschreibung |
| :--- | :--- | :--- |
| **Frontend UI** | [Mithril.js](https://mithril.js.org/) (2.2.2) | 10 kB schnelles Virtual DOM Framework ohne JSX/Babel-Build-Zwang |
| **State Management** | Mithril.js Streams (`m.stream`) | Reaktives Stream-Paradigma mit FP-Kombinatoren (`map`, `combine`) |
| **CSS & Design** | [Tailwind CSS](https://tailwindcss.com/) | Responsive Utility-First Engine mit WCAG AA Farbkontrasten |
| **PWA & Offline** | Service Worker + Web Manifest | Offline-First Caching von Shell und API-Ressourcen, Add to Home Screen |
| **Backend API** | PHP 8.1+ | Schlanke REST-Endpunkte mit Prepared Statements, CSRF-Schutz & Rate-Limiting |
| **Datenbank** | SQLite 3 (PDO) | Zero-Config relationale Datenbank im WAL-Modus mit Foreign-Key Constraints |
| **Dev-Server** | Node.js + Express (tsx) | Paralleler Entwicklungs- und Preview-Server mit identischem API-Verhalten |

---

## Mithril.js Streams State Management

Die gesamte Frontend-Architektur in `app.js` basiert auf **Mithril.js Streams** (`m.stream`). Dies gewährleistet eine saubere Trennung von Geschäftslogik, asynchronen Datenströmen und der Benutzeroberfläche.

```
                              ┌──────────────────────────┐
                              │  Mithril Streams Store   │
                              │      (StreamState)       │
                              └─────────────┬────────────┘
                                            │
               ┌────────────────────────────┼───────────────────────────┐
               ▼                            ▼                           ▼
      ┌─────────────────┐          ┌─────────────────┐         ┌─────────────────┐
      │  auth streams   │          │ resource streams│         │ booking streams │
      │  user$, role$,  │          │ list$, loading$,│         │ selection$,     │
      │  isAdmin$, ...  │          │ filters, filtered$        │ duration, price │
      └────────┬────────┘          └────────┬────────┘         └────────┬────────┘
               │                            │                           │
               └────────────────────────────┼───────────────────────────┘
                                            ▼
                              ┌──────────────────────────┐
                              │    Reactive Observers    │
                              │    & stream.combine()    │
                              └─────────────┬────────────┘
                                            ▼
                              ┌──────────────────────────┐
                              │    Mithril Virtual DOM   │
                              │   Auto-Redraw (m.redraw) │
                              └──────────────────────────┘
```

### Architektur-Überblick

Alle Kern-Zustände sind in `StreamState` organisiert und in vier Domänen aufgeteilt:

```javascript
// Auf window.CstrskBooking.StreamState im Browser verfügbar
const StreamState = {
  auth:      { /* Authentifizierung, Token, Berechtigungen */ },
  resources: { /* Ressourcen-Liste, Suchfilter, gefilterte Streams */ },
  booking:   { /* Aktuelle Auswahl, Dauer, Preiskalkulation, Konflikte */ },
  app:       { /* Theme, aktiver Tab, Online-Status, Modal, Toasts */ }
};
```

---

### 1. User Authentication Streams

Verwaltet den aktuellen Login-Status, Berechtigungen und rollenbasierte Zugriffe:

```javascript
// Basis-Streams
StreamState.auth.user$      = stream(null); // Enthält { id, email, name, role, credits, ... }
StreamState.auth.csrfToken$ = stream('');   // CSRF-Token für schreibende API-Calls

// Abgeleitete reaktive Streams (Funktionale Projektion via .map)
StreamState.auth.isAuthenticated$ = StreamState.auth.user$.map(u => !!u);
StreamState.auth.userRole$        = StreamState.auth.user$.map(u => u ? u.role : 'guest');
StreamState.auth.isAdmin$         = StreamState.auth.userRole$.map(r => r === 'admin' || r === 'staff');
StreamState.auth.userCredits$     = StreamState.auth.user$.map(u => u ? (u.credits || 0) : 0);
```

#### Verwendung:
```javascript
// Wert auslesen (Getter)
const isLoggedIn = StreamState.auth.isAuthenticated$(); // true / false
const currentUser = StreamState.auth.user$();

// Auf Änderungen reagieren
StreamState.auth.isAuthenticated$.map(authed => {
  console.log('Auth-Status geändert:', authed);
});

// Komfortabler Action-Dispatcher
StreamState.auth.login(userData, csrfToken);
StreamState.auth.logout();
```

---

### 2. Resource Data & Filter Streams

Verwaltet die Liste der Räume/Tische und reagiert in Echtzeit auf Filteränderungen (Typ, Datum, Uhrzeit, Personen, Ausstattung):

```javascript
StreamState.resources.list$            = stream([]);
StreamState.resources.loading$         = stream(false);
StreamState.resources.filterType$      = stream('');
StreamState.resources.filterDate$      = stream('2026-10-14');
StreamState.resources.filterStartTime$ = stream('09:00');
StreamState.resources.filterEndTime$   = stream('12:00');
StreamState.resources.filterCapacity$  = stream(1);
StreamState.resources.filterEquipment$ = stream([]);
StreamState.resources.filterDeskType$  = stream('');
```

#### Abgeleitete gefilterte Liste via `stream.combine()`:
Ändert sich irgendeiner der Filter-Streams oder die Ressourcenliste, berechnet `filtered$` die Treffermenge vollautomatisch und synchron neu:

```javascript
StreamState.resources.filtered$ = stream.combine((list, type, cap, eq, desk) => {
  const all = list || [];
  return all.filter(r => {
    if (type && r.type_id !== type) return false;
    if (cap > 1 && r.capacity < cap) return false;
    if (desk && r.desk_type !== desk) return false;
    if (eq && eq.length > 0) {
      if (!eq.every(item => (r.equipment || []).includes(item))) return false;
    }
    return true;
  });
}, [
  StreamState.resources.list$,
  StreamState.resources.filterType$,
  StreamState.resources.filterCapacity$,
  StreamState.resources.filterEquipment$,
  StreamState.resources.filterDeskType$
]);
```

---

### 3. Current Booking Selection Streams

Hält die aktuell im Buchungsmodal ausgewählte Ressource und Zeitspanne:

```javascript
StreamState.booking.selection$      = stream(null);
StreamState.booking.conflictStatus$ = stream(null);

// Abgeleiteter Stream für die ausgewählte Ressource
StreamState.booking.selectedResource$ = StreamState.booking.selection$.map(sel => sel ? sel.resource : null);

// Abgeleitete Dauer in Dezimalstunden
StreamState.booking.durationHours$ = StreamState.booking.selection$.map(sel => {
  if (!sel || !sel.start_time || !sel.end_time) return 0;
  const start = new Date(sel.start_time).getTime();
  const end = new Date(sel.end_time).getTime();
  return end > start ? (end - start) / (3600 * 1000) : 0;
});
```

---

### 4. Reactive Combining & Auto-Pricing

Die Preiskalkulation (Stunden-, Halbtags-, Tages- und Wochentarife inkl. 19 % MwSt nach § 14 UStG) erfolgt reaktiv über einen abgeleiteten Stream:

```javascript
StreamState.booking.estimatedPrice$ = StreamState.booking.selection$.map(sel => {
  if (!sel || !sel.resource || !sel.start_time || !sel.end_time) {
    return { net: 0, tax: 0, gross: 0, hours: 0 };
  }
  const hours = StreamState.booking.durationHours$();
  const r = sel.resource;
  let net = 0;

  // Stufenweise Tarifberechnung
  if (hours >= 168 && r.weekly_rate > 0) {
    net = Math.ceil(hours / 168) * r.weekly_rate;
  } else if (hours >= 8 && r.daily_rate > 0) {
    net = Math.ceil(hours / 8) * r.daily_rate;
  } else if (hours >= 4 && r.half_day_rate > 0) {
    net = Math.ceil(hours / 4) * r.half_day_rate;
  } else if (r.hourly_rate > 0) {
    net = Math.round(hours * r.hourly_rate * 100) / 100;
  }

  const tax = Math.round((net * 0.19) * 100) / 100;
  const gross = Math.round((net + tax) * 100) / 100;
  return { net, tax, gross, hours };
});
```

---

### 5. Action Dispatcher & State Bridge

Für Entwicklerkomfort und Abwärtskompatibilität verfügt die Anwendung über direkte Dispatcher und eine transparente Getter/Setter-Bridge (`State`):

```javascript
// Action Dispatcher
StreamState.booking.select({
  resource: myResource,
  start_time: '2026-10-15T09:00:00Z',
  end_time: '2026-10-15T12:00:00Z',
  seating_layout: 'u_shape'
});

StreamState.booking.clear();

// Transparente Bridge zu Mithril Komponenten
// Zugriff auf State.user liest intern StreamState.auth.user$()
console.log(State.user);
State.currentTab = 'calendar'; // Aktualisiert StreamState.app.currentTab$
```

---

## Ressourcentypen

| Typ | Eigenschaften | Abrechnungseinheiten | Beispiel-Ressourcen (Ulm-Edition) |
| :--- | :--- | :--- | :--- |
| **Seminarraum** (`room`) | Kapazität 10–50 Personen, Beamer/Display, Whiteboard, Konferenz-Audio/Video, Catering | Std. / Halbtag / Tag | **Saal Ulmer Münster**, **Innovationsraum Schneider von Ulm** (Albrecht Berblinger) |
| **Einzeltisch** (`desk`) | 1–6 Sitzplätze, Fläche / Etage, Stromanschluss, ruhige Zone oder Teamfläche | Std. / Tag | **Tisch Fischerviertel**, **Tisch Metzgerturm**, **Tisch Schwörhaus**, **Tisch Albert Einstein**, **Tisch Ulmer Schachtel**, **Tisch Friedrichsau** |
| **Shared Workspace** (`workspace`) | Hot Desk (flexibel) oder Fixed Desk (fester Arbeitsplatz mit Schließfach) | Tag / Woche / Monat | Hot Desks: *Donau, Blau, Iller, Gänsturm, Schiefes Haus, Grabenhäusle*<br>Fixed Desks: *Münsterblick, Berblinger-Turm, Einstein-Labor, Weinhof, Neuer Bau, Glacis-Park* |

---

## Progressive Web App (PWA) & Offline-Modus

Das System ist als vollwertige PWA zertifiziert:
- **Web App Manifest (`manifest.json`):** Eigenständiges App-Icon, barrierefreie Theme-Farben (`#1A73E8` Primary, `#0F172A` Canvas Dark) und `display: standalone`.
- **Design System & Barrierefreiheit:** WCAG 2.1 AA konformes Designsystem mit ≥ 4.5:1 Textkontrast in Light & Dark Mode.
- **Service Worker (`sw.js`):**
  - **App-Shell Cache:** Speichert HTML, CSS, JavaScript und Vektor-Grafiken im Cache-Storage.
  - **Offline Bookings Cache:** API-Antworten unter `/api/bookings.php` werden automatisch gecacht. Befindet sich der Nutzer im Flugmodus oder Funkloch, bleiben alle bestätigten Buchungen und QR-Codes zur Vorlage beim Empfang vollständig sichtbar.
  - **Offline-Banner:** Ein diskretes Warnbanner informiert über den Offline-Zustand.

---

## Backend-Architektur & REST-API

Alle PHP-Skripte im Verzeichnis `/api` sind zustandslos und kommunizieren im JSON-Format:

| Endpunkt | Methode | Beschreibung |
| :--- | :--- | :--- |
| `POST /api/auth.php?action=login` | `POST` | E-Mail & Passwort Authentifizierung mit Rate-Limiting und CSRF-Token-Ausgabe |
| `POST /api/auth.php?action=register`| `POST` | Benutzerregistrierung mit DSGVO-Einwilligungsvalidierung |
| `GET  /api/auth.php?action=status` | `GET` | Liefert aktuellen Benutzer und Session-Gültigkeit |
| `POST /api/auth.php?action=logout` | `POST` | Sichere Session-Zerstörung |
| `GET  /api/resources.php` | `GET` | Ressourcenliste mit Live-Verfügbarkeitsprüfung für das gewählte Zeitfenster |
| `POST /api/bookings.php` | `POST` | Atomare Buchung mit Konfliktprüfung, Serienbuchung und Preiskalkulation |
| `GET  /api/bookings.php` | `GET` | Eigene Buchungen (Filter: kommend / vergangen / alle) |
| `PUT  /api/bookings.php?id=...` | `PUT` | Buchung ändern oder stornieren unter Beachtung der Stornofrist |
| `POST /api/bookings.php?action=checkin` | `POST` | Vor-Ort Check-in via QR-Code Token |
| `GET  /api/calendar.php?date=...` | `GET` | Matrix für das Raumplan-Raster (Ressourcen × Zeitleiste) |
| `GET/POST /api/waitlist.php` | `GET/POST`| Eintrag in die Warteliste für belegte Terminslots |
| `GET  /api/admin.php?action=dashboard` | `GET` | Admin-KPIs: Auslastung, Umsatz, No-Show-Rate, Top-Ressourcen |
| `POST /api/admin.php?action=approve` | `POST` | Manuelle Freigabe genehmigungspflichtiger Buchungen |
| `GET  /api/export.php?format=csv` | `GET` | Buchungsdaten als UTF-8 BOM CSV für Microsoft Excel |
| `GET  /api/export.php?format=ics` | `GET` | RFC-5545 iCalendar Termin-Export für Outlook, Apple & Google |
| `GET  /api/invoice.php?id=...` | `GET` | Druckoptimierte Rechnung nach § 14 UStG mit Ausweis von 19 % MwSt |
| `GET  /api/user.php?action=export` | `GET` | DSGVO Art. 20 Datenexport aller personenbezogenen Daten |
| `POST /api/user.php?action=delete` | `POST` | DSGVO Art. 17 Recht auf Vergessenwerden (Kontolöschung) |

---

## Datenmodell (SQLite)

Das Schema (`schema.sql`) erzwingt relationale Integrität auf Datenbankebene:

- `users`: Stammdaten, gehashte Passwörter (`password_hash` BCRYPT/ARGON2), Rollen (`admin`, `staff`, `user`), Guthaben-Credits.
- `resource_types`: Definition der 3 Grundkategorien (`room`, `desk`, `workspace`).
- `resources`: Ausstattungsmerkmale (JSON), Kapazitäten, Tarife, Genehmigungspflicht, Standort.
- `bookings`: Start-/Endzeiten (ISO-8601 UTC), Buchungsnummer, QR-Check-in-Code, Status (`confirmed`, `pending_approval`, `cancelled`, `checked_in`), Netto-/Bruttobeträge.
- `recurrences`: Metadaten für Serienbuchungen (Intervall, Enddatum, Wochentage).
- `blocks`: Administrativer Sperrkalender für Feiertage, Wartungs- und Umbauzeiten.
- `waitlist`: Warteschlangen-Einträge mit Status und Benachrichtigungszeitstempel.
- `audit_log`: Revisionssichere Protokollierung administrativer und sicherheitskritischer Aktionen.

---

## DSGVO & Datenschutz

- **Privacy by Design:** Keine externen Tracking-Dienste, keine Third-Party Cookies, keine Google Fonts CDNs im Produktivbetrieb.
- **Transparenz:** Bei der Registrierung wird die Datenschutzerklärung explizit bestätigt und revisionssicher protokolliert.
- **Auskunftsrecht (Art. 15 / 20 DSGVO):** Nutzer können mit einem Klick alle über sie gespeicherten Daten (Profil, Buchungen, Historie, Wartelisteneinträge) als standardisierte JSON-Datei herunterladen.
- **Recht auf Löschung (Art. 17 DSGVO):** Nutzer können ihr Profil und alle zugehörigen Daten unwiderruflich löschen. Buchungsdaten werden unter Wahrung handelsrechtlicher Aufbewahrungspflichten (§ 257 HGB / § 147 AO) anonymisiert.

---

## Installation & Deployment

### IONOS / Shared Hosting (PHP 8 + Apache)

1. **Dateien übertragen:**  
   Laden Sie den gesamten Repository-Inhalt via SFTP (z. B. FileZilla oder Cyberduck) in das Webspace-Stammverzeichnis (z. B. `/htdocs` oder `/kunden/homepages/.../htdocs`).
2. **PHP-Version konfigurieren:**  
   Im Hosting Control Center PHP 8.1 oder höher aktivieren.
3. **Rechte für Datenbankordner setzen:**  
   Das Verzeichnis `/data` benötigt Schreibrechte für SQLite:
   ```bash
   chmod 755 data
   ```
4. **Aufrufen & Fertig:**  
   Rufen Sie Ihre Domain im Browser auf (`https://ihre-domain.de`). Die Datenbank `data/workspace.sqlite` wird beim ersten Laden anhand von `schema.sql` und `seed.sql` vollautomatisch initialisiert.
5. **Sicherheit:**  
   Die beiliegende `.htaccess` unterbindet jeden direkten HTTP-Zugriff auf `.sql`, `.sqlite` und interne Konfigurationsdateien.

---

### Lokale Entwicklung (Node.js / Express)

Für Entwicklung, UI-Testing und CI/CD-Pipelines steht ein vollständiger Node.js-Server bereit:

```bash
# Abhängigkeiten installieren
npm install

# Entwicklungsserver starten (Port 3000)
npm run dev

# Anwendung im Browser öffnen:
# http://localhost:3000
```

---

## Standard-Zugangsdaten (Seed-Daten)

Nach der Initialisierung sind folgende Test-Konten sofort einsatzbereit:

| Rolle | E-Mail | Standardpasswort | Berechtigungen |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@cstrsk.de` | `admin123` | Dashboard, KPIs, Ressourcen-CRUD, Nutzerverwaltung, Genehmigungen, CSV-Export |
| **Mitarbeiter / Staff** | `team@cstrsk.de` | `mitarbeiter123` | Raumplan, Check-in, Terminverwaltung |
| **Nutzer** | `nutzer@beispiel.de` | `nutzer123` | Buchen, Stornieren, QR-Code Vorlage, DSGVO-Export |

> ⚠️ **Sicherheitshinweis:** Ändern Sie die Standardpasswörter nach der Ersteinrichtung umgehend im Profilmenü.

---

## Lizenz

Dieses Projekt ist freie Software lizenziert unter der **GNU Affero General Public License Version 3 (GNU AGPLv3)**.  
Den vollständigen Lizenztext finden Sie in der beiliegenden Datei [LICENSE](./LICENSE).

Entwickelt mit ❤️ von **[cstrsk.de](https://cstrsk.de)**.

## Repository & Live-Demo

- **Quellcode:** [https://github.com/CSTRSK/workspace-booking](https://github.com/CSTRSK/workspace-booking)
- **Lizenz:** GNU Affero General Public License v3 (AGPL-3.0) — siehe [LICENSE](./LICENSE)
- **Projektseite:** [https://cstrsk.de](https://cstrsk.de)
- **Live-Demo (GitHub Pages):** [https://cstrsk.github.io/workspace-booking/](https://cstrsk.github.io/workspace-booking/)

> **Hinweis zur Pages-Demo:** GitHub Pages liefert ausschliesslich statische Dateien aus und
> kann **kein PHP** ausfuehren. Die Demo zeigt daher die vollstaendige Oberflaeche, aber
> Anmeldung und Buchungen brauchen den PHP-Teil (`api/`). Fuer den vollen Funktionsumfang
> das Projekt auf einem PHP-Webspace (Apache + PHP 8.1+ mit `pdo_sqlite`) betreiben —
> die Einrichtung steht in [deploy.md](./deploy.md).
