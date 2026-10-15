# cstrsk.de Workspace & Room Booking System - Deployment- & Betriebsanleitung

> **Lizenz:** Freie Software lizenziert unter der **GNU Affero General Public License Version 3 (GNU AGPLv3)**.  
> **Projekt & Dokumentation:** [https://cstrsk.de](https://cstrsk.de)

---

## 1. Systemvoraussetzungen
- **Webserver:** Apache 2.4+ mit aktivierten Modulen `mod_rewrite`, `mod_headers`, `mod_expires` (auf IONOS Shared Hosting standardmäßig aktiv) oder Nginx.
- **PHP:** PHP 8.1, 8.2 oder 8.3
  - PHP-Erweiterungen: `pdo_sqlite`, `json`, `mbstring`, `session`
- **HTTPS-Zertifikat:** Zwingend erforderlich für Progressive Web Apps (PWA) und Service Worker (z. B. kostenloses Let's Encrypt über IONOS).

---

## 2. Ordnerstruktur auf dem Server
Laden Sie alle Projektdateien via SFTP (z. B. FileZilla oder IONOS Webspace Explorer) in das Zielverzeichnis (z. B. `/htdocs` oder eine Subdomain):

```
/ (Document Root)
├── LICENSE                   # GNU Affero General Public License v3 (AGPLv3)
├── .htaccess                 # Sicherheits- & Caching-Header, MIME-Types
├── index.html                # PWA Einstiegspunkt (Mithril.js + Tailwind)
├── app.js                    # Vollständige Frontend-Applikationslogik
├── sw.js                     # Service Worker für Offline-Fähigkeit
├── manifest.json             # PWA Web-App-Manifest
├── logo.svg                  # cstrsk.de Vektor-Logo
├── icon.svg                  # cstrsk Vektor-App-Icon
├── pwa-192x192.png           # PWA Icon 192x192
├── pwa-512x512.png           # PWA Icon 512x512
├── apple-touch-icon.png      # iOS Safari Touch Icon
├── schema.sql                # SQLite DDL Schema mit Indizes & Constraints
├── seed.sql                  # Beispieldaten (Räume, Tische, Workspaces, Admin)
├── data/                     # Automatisch erstelltes Verzeichnis für SQLite
│   └── workspace.sqlite      # SQLite-Datenbankdatei (geschützt via .htaccess)
└── api/
    ├── db.php                # PDO-Verbindung, CSRF, Helper, Auto-Init
    ├── auth.php              # Login, Registrierung, Session, Rate-Limiting
    ├── resources.php         # Ressourcenfilter & Live-Konfliktprüfung
    ├── bookings.php          # Atomare Buchungserstellung, Check-in, Storno
    ├── calendar.php          # Raumplan-Raster (Matrix Ressourcen x Zeit)
    ├── waitlist.php          # Warteliste für belegte Slots
    ├── admin.php             # KPIs, Genehmigungsworkflow, Ressourcen-CRUD
    ├── export.php            # CSV-Export für Excel & RFC-5545 iCalendar (.ics)
    ├── invoice.php           # §14 UStG Rechnungsdruck / PDF
    └── user.php              # DSGVO Datenexport (Art. 20) & Kontolöschung
```

---

## 3. Schritt-für-Schritt Installation (IONOS)

1. **Dateien hochladen:**
   Kopieren Sie alle Dateien in Ihr Webhosting-Verzeichnis.
2. **PHP-Version prüfen:**
   Im IONOS Control Center unter *Hosting > PHP-Verwaltung* sicherstellen, dass PHP 8.1 oder neuer aktiviert ist.
3. **Schreibrechte für das Datenbank-Verzeichnis vergeben:**
   Das Verzeichnis `data/` benötigt Schreibrechte durch den Webserver-Prozess:
   ```bash
   chmod 755 data
   ```
4. **Automatische Initialisierung:**
   Rufen Sie Ihre Domain im Browser auf. Beim ersten Aufruf erstellt `api/db.php` die SQLite-Datenbank `data/workspace.sqlite` vollautomatisch anhand von `schema.sql` und spielt die Beispieldaten aus `seed.sql` ein.

---

## 4. Standard-Zugangsdaten (Seed-Daten)

| Rolle | E-Mail | Standardpasswort |
| :--- | :--- | :--- |
| **Administrator** | `admin@cstrsk.de` | `admin123` |
| **Facility / Staff** | `team@cstrsk.de` | `mitarbeiter123` |
| **Nutzer** | `nutzer@beispiel.de` | `nutzer123` |

*Hinweis:* Ändern Sie die Passwörter nach dem ersten Produktiv-Start umgehend im Administrationsbereich!

---

## 5. Testfälle zur Abnahme

1. **Ressourcen & Suche:**
   - Filtern nach Datum, Typ (Seminarraum, Tisch, Workspace) und Ausstattung (z. B. Beamer, Dockingstation).
   - Prüfen, ob belegte Zeitfenster zuverlässig als „Belegt“ markiert werden.
2. **Raumplan-Raster:**
   - Kalender aufrufen und das Raster (Ressourcen als Zeilen, Zeiten von 07:00 bis 20:00 Uhr) prüfen.
   - Statusfarben verifizieren: Grün (frei), Grau (belegt), Blau (eigene Buchung), Magenta (Genehmigung).
3. **Konfliktprüfung & Buchung:**
   - Buchung durchführen: Pufferzeiten (z. B. 15 Minuten) werden serverseitig atomar per Transaktion geprüft. Doppelbuchungen sind unmöglich.
4. **PWA & Offline:**
   - Im Browser (Desktop oder Smartphone) auf „App installieren“ klicken.
   - Entwicklertools > Netzwerk auf „Offline“ stellen: Die Seite „Meine Buchungen“ zeigt zuvor geladene Reservierungen und den QR-Code weiterhin an.
5. **Admin & Compliance:**
   - Dashboard-Metriken (Auslastung, Umsatz, No-Show-Rate) prüfen.
   - CSV-Export herunterladen (`cstrsk_buchungen.csv`) und in Microsoft Excel öffnen (UTF-8 BOM sorgt für saubere Umlaute).
   - Rechnung als druckbares HTML/PDF aufrufen (§ 14 UStG konform mit 19 % MwSt. und cstrsk.de Ausweisung).
   - DSGVO-Datenexport und Kontolöschung testen.
   - Quellcode- und Lizenztransparenz über den Link zu [https://cstrsk.de](https://cstrsk.de) und die GNU AGPLv3 einsehen.
