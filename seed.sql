-- ============================================================================
-- cstrsk.de Workspace & Room Booking System - Seed Data
-- Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
-- 2 Seminarräume, 6 Tische, 12 Workspace-Plätze, Demobenutzer, Buchungen
-- ============================================================================

-- Ressourcentypen
INSERT OR IGNORE INTO resource_types (id, name, description, icon) VALUES 
('room', 'Seminarraum', 'Voll ausgestattete Besprechungs- und Seminarräume mit flexibler Bestuhlung', 'presentation'),
('desk', 'Einzeltisch', 'Reservierte Tische in Zonen oder Teamflächen für fokussiertes Arbeiten', 'table'),
('workspace', 'Shared Workspace', 'Ergonomische Arbeitsplätze (Hot Desk oder Fixed Desk) im Coworking-Bereich', 'laptop');

-- Benutzer (Passwörter: admin123, mitarbeiter123, nutzer123)
INSERT OR IGNORE INTO users (id, email, password_hash, name, role, credits, company, phone, consent_privacy, consent_terms, is_active, created_at) VALUES
('usr-admin-01', 'admin@cstrsk.de', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Alexander Weber (Admin)', 'admin', 500, 'cstrsk.de Workspace Solutions', '+49 731 123450', 1, 1, 1, '2026-01-01T08:00:00Z'),
('usr-staff-01', 'team@cstrsk.de', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Sabine Bauer (Facility)', 'staff', 250, 'cstrsk.de Operations', '+49 731 123451', 1, 1, 1, '2026-01-01T08:00:00Z'),
('usr-demo-01', 'nutzer@beispiel.de', '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'Dr. Thomas Meyer', 'user', 100, 'CloudInnovate AG', '+49 89 9876543', 1, 1, 1, '2026-01-01T08:00:00Z');

-- 2 Seminarräume
INSERT OR IGNORE INTO resources (id, type_id, title, subtitle, description, location, capacity, equipment, seating_options, desk_type, image_url, hourly_rate, half_day_rate, daily_rate, weekly_rate, monthly_rate, min_duration_minutes, max_duration_minutes, buffer_minutes, requires_approval, opening_time, closing_time, is_active, created_at) VALUES
('room-kepler', 'room', 'Saal Ulmer Münster', 'Repräsentativer Kongress- & Tagungssaal mit Münsterblick', 
 'Höchster Komfort für Konferenzen, Tagungen und Präsentationen. Ausgestattet mit 85" 4K-Display, Decken-Arraymikrofonen, 4K-Videobar und flexibler Bestuhlung (Reihen, U-Form, Block) mit Blick auf den weltberühmten Kirchturm.',
 '3. OG - Münster-Etage', 30, '["beamer","whiteboard","video","catering","power"]', '["reihen","u_form","block"]', NULL,
 'https://images.unsplash.com/photo-1517502884422-41eaead166d4?auto=format&fit=crop&w=800&q=80',
 45.0, 160.0, 280.0, 0, 0, 60, 480, 15, 0, '07:30', '20:00', 1, '2026-01-01T00:00:00Z'),

('room-humboldt', 'room', 'Innovationsraum Schneider von Ulm', 'Kreativ- & Flugpionier-Studio für Ideen & Workshops',
 'Benannt nach Albrecht Ludwig Berblinger. Flexibles Mobiliar auf Rollen, beschreibbare Whiteboard-Wände, Moderationskoffer, Barista-Kaffeebar-Zugang und modernste Medientechnik für agile Teams.',
 '2. OG - Berblinger-Flügel', 16, '["beamer","whiteboard","video","catering"]', '["block","u_form"]', NULL,
 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80',
 35.0, 130.0, 220.0, 0, 0, 60, 480, 15, 1, '08:00', '19:30', 1, '2026-01-01T00:00:00Z');

-- 6 Einzeltische
INSERT OR IGNORE INTO resources (id, type_id, title, subtitle, description, location, capacity, equipment, seating_options, desk_type, image_url, hourly_rate, half_day_rate, daily_rate, weekly_rate, monthly_rate, min_duration_minutes, max_duration_minutes, buffer_minutes, requires_approval, opening_time, closing_time, is_active, created_at) VALUES
('desk-a1', 'desk', 'Tisch Fischerviertel', 'Ruhiger Zweiertisch an der Blau (Silent Zone)', 'Fokussiertes Arbeiten in idyllischer Ruhezone. Akustikpaneele zur Schalldämpfung mit Blick auf den Gerber-Innenhof.', 'EG - Blau-Trakt', 2, '["power","monitor"]', '[]', NULL, 'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&w=800&q=80', 10.0, 35.0, 45.0, 0, 0, 30, 600, 10, 0, '07:00', '21:00', 1, '2026-01-01T00:00:00Z'),
('desk-a2', 'desk', 'Tisch Metzgerturm', 'Ruhiger Zweiertisch an der Stadtmauer (Silent Zone)', 'Ruhiger Arbeitsplatz mit viel Tageslicht und ergonomischer Ausstattung im historischen Flügel.', 'EG - Stadtmauer-Flügel', 2, '["power","monitor"]', '[]', NULL, 'https://images.unsplash.com/photo-1527192491265-7e15c55b1ed2?auto=format&fit=crop&w=800&q=80', 10.0, 35.0, 45.0, 0, 0, 30, 600, 10, 0, '07:00', '21:00', 1, '2026-01-01T00:00:00Z'),
('desk-b1', 'desk', 'Tisch Schwörhaus', 'Vierertisch für Teamberatung & Projektgruppen', 'Offene Kollaborationszone mit Whiteboard-Tafel, Tischsteckdosen und Besprechungsmonitor.', '1. OG - Weinhof-Zone', 4, '["power","whiteboard"]', '[]', NULL, 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=800&q=80', 15.0, 50.0, 65.0, 0, 0, 30, 600, 10, 0, '07:00', '21:00', 1, '2026-01-01T00:00:00Z'),
('desk-b2', 'desk', 'Tisch Albert Einstein', 'Denkraum & Vierertisch für Ideenentwicklung', 'Inspiration pur: Zentraler Tisch in der Denkwerkstatt für agiles Brainstorming und konzentrierte Teamarbeit.', '1. OG - Einstein-Denkraum', 4, '["power","whiteboard"]', '[]', NULL, 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=800&q=80', 15.0, 50.0, 65.0, 0, 0, 30, 600, 10, 0, '07:00', '21:00', 1, '2026-01-01T00:00:00Z'),
('desk-c1', 'desk', 'Tisch Ulmer Schachtel', 'Großer Sechsertisch im Projektbereich Donau', 'Traditionelles Design trifft moderne Kollaboration: Massiver Arbeitstisch für bis zu 6 Personen mit Konferenzmonitor und Whiteboard.', '1. OG - Donau-Deck', 6, '["power","monitor","whiteboard"]', '[]', NULL, 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=800&q=80', 20.0, 70.0, 90.0, 0, 0, 60, 600, 15, 0, '07:00', '21:00', 1, '2026-01-01T00:00:00Z'),
('desk-c2', 'desk', 'Tisch Friedrichsau', 'Großer Sechsertisch mit Parkblick', 'Großzügiger Arbeitstisch für Teams mit Blick in den Park, Glas-Trennwand und direktem Zugang zur Teeküche.', '1. OG - Friedrichsau-Zone', 6, '["power","monitor","whiteboard"]', '[]', NULL, 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=800&q=80', 20.0, 70.0, 90.0, 0, 0, 60, 600, 15, 0, '07:00', '21:00', 1, '2026-01-01T00:00:00Z');

-- 12 Shared Workspace Plätze (6 Hot Desks, 6 Fixed Desks)
INSERT OR IGNORE INTO resources (id, type_id, title, subtitle, description, location, capacity, equipment, seating_options, desk_type, image_url, hourly_rate, half_day_rate, daily_rate, weekly_rate, monthly_rate, min_duration_minutes, max_duration_minutes, buffer_minutes, requires_approval, opening_time, closing_time, is_active, created_at) VALUES
('ws-hd-01', 'workspace', 'Hot Desk Donau', 'Flexibler Arbeitsplatz am Flusslauf', 'Elektrisch höhenverstellbarer Schreibtisch mit USB-C PD Dockingstation und 27" Monitor.', 'EG - Coworking Open Space', 1, '["monitor","docking","power"]', '[]', 'hot_desk', 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&q=80', 5.0, 18.0, 25.0, 100.0, 320.0, 60, 720, 5, 0, '06:00', '22:00', 1, '2026-01-01T00:00:00Z'),
('ws-hd-02', 'workspace', 'Hot Desk Blau', 'Flexibler Einzelarbeitsplatz', 'Mit 27" 4K Monitor, LAN-Kabel und kabellosem Ladepad.', 'EG - Coworking Open Space', 1, '["monitor","docking","power"]', '[]', 'hot_desk', 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&q=80', 5.0, 18.0, 25.0, 100.0, 320.0, 60, 720, 5, 0, '06:00', '22:00', 1, '2026-01-01T00:00:00Z'),
('ws-hd-03', 'workspace', 'Hot Desk Iller', 'Flexibler Einzelarbeitsplatz', 'Ergonomischer Bürostuhl von Sedus, Tageslicht, Schreibtischlampe.', 'EG - Coworking Open Space', 1, '["power","docking"]', '[]', 'hot_desk', 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&q=80', 5.0, 18.0, 25.0, 100.0, 320.0, 60, 720, 5, 0, '06:00', '22:00', 1, '2026-01-01T00:00:00Z'),
('ws-hd-04', 'workspace', 'Hot Desk Gänsturm', 'Flexibler Einzelarbeitsplatz', 'Kompakter Arbeitsplatz in Fensternähe mit High-Speed WLAN.', 'EG - Coworking Open Space', 1, '["power","monitor"]', '[]', 'hot_desk', 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&q=80', 5.0, 18.0, 25.0, 100.0, 320.0, 60, 720, 5, 0, '06:00', '22:00', 1, '2026-01-01T00:00:00Z'),
('ws-hd-05', 'workspace', 'Hot Desk Schiefes Haus', 'Flexibler Einzelarbeitsplatz', 'Ruhiger Eckplatz mit Stromanschluss und ergonomischem Hocker.', 'EG - Coworking Open Space', 1, '["power","docking"]', '[]', 'hot_desk', 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&q=80', 5.0, 18.0, 25.0, 100.0, 320.0, 60, 720, 5, 0, '06:00', '22:00', 1, '2026-01-01T00:00:00Z'),
('ws-hd-06', 'workspace', 'Hot Desk Grabenhäusle', 'Flexibler Einzelarbeitsplatz', 'Arbeitsplatz nahe der Kaffeestation mit Monitor & Dock.', 'EG - Coworking Open Space', 1, '["monitor","docking","power"]', '[]', 'hot_desk', 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=800&q=80', 5.0, 18.0, 25.0, 100.0, 320.0, 60, 720, 5, 0, '06:00', '22:00', 1, '2026-01-01T00:00:00Z'),

('ws-fd-101', 'workspace', 'Fixed Desk Münsterblick', 'Fester Arbeitsplatz mit Schließfach', 'Dual-Monitor-Setup (2x 27" Dell UltraSharp), Thunderbolt 4 Dock, abschließbarer Rollcontainer.', '1. OG - Coworking Dedicated', 1, '["monitor","docking","power"]', '[]', 'fixed_desk', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=80', 8.0, 25.0, 35.0, 140.0, 450.0, 120, 1440, 5, 0, '00:00', '23:59', 1, '2026-01-01T00:00:00Z'),
('ws-fd-102', 'workspace', 'Fixed Desk Berblinger-Turm', 'Fester Arbeitsplatz mit Schließfach', 'Dual-Monitor-Setup, mechanische Tastatur & Maus, ergonomischer Stuhl.', '1. OG - Coworking Dedicated', 1, '["monitor","docking","power"]', '[]', 'fixed_desk', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=80', 8.0, 25.0, 35.0, 140.0, 450.0, 120, 1440, 5, 0, '00:00', '23:59', 1, '2026-01-01T00:00:00Z'),
('ws-fd-103', 'workspace', 'Fixed Desk Einstein-Labor', 'Fester Arbeitsplatz mit Schließfach', 'Curved Ultrawide 34" Monitor, integrierte Webcam und Konferenzlautsprecher.', '1. OG - Coworking Dedicated', 1, '["monitor","docking","power","video"]', '[]', 'fixed_desk', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=80', 8.0, 25.0, 35.0, 140.0, 450.0, 120, 1440, 5, 0, '00:00', '23:59', 1, '2026-01-01T00:00:00Z'),
('ws-fd-104', 'workspace', 'Fixed Desk Weinhof', 'Fester Arbeitsplatz mit Schließfach', 'Höhenverstellbarer Premium-Tisch, schallisolierende Seitenblende.', '1. OG - Coworking Dedicated', 1, '["monitor","docking","power"]', '[]', 'fixed_desk', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=80', 8.0, 25.0, 35.0, 140.0, 450.0, 120, 1440, 5, 0, '00:00', '23:59', 1, '2026-01-01T00:00:00Z'),
('ws-fd-105', 'workspace', 'Fixed Desk Neuer Bau', 'Fester Arbeitsplatz mit Schließfach', 'Direkt am Fenster mit Südausrichtung, inkl. Monitor und Dockingstation.', '1. OG - Coworking Dedicated', 1, '["monitor","docking","power"]', '[]', 'fixed_desk', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=80', 8.0, 25.0, 35.0, 140.0, 450.0, 120, 1440, 5, 0, '00:00', '23:59', 1, '2026-01-01T00:00:00Z'),
('ws-fd-106', 'workspace', 'Fixed Desk Glacis-Park', 'Fester Arbeitsplatz mit Schließfach', 'Inkl. Postfachservice, LAN-Direktanschluss und Schließfach.', '1. OG - Coworking Dedicated', 1, '["monitor","docking","power"]', '[]', 'fixed_desk', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=80', 8.0, 25.0, 35.0, 140.0, 450.0, 120, 1440, 5, 0, '00:00', '23:59', 1, '2026-01-01T00:00:00Z');

-- Systemeinstellungen
INSERT OR IGNORE INTO system_settings (key, value) VALUES
('allow_guest_booking', '1'),
('advance_booking_days_max', '60'),
('min_lead_time_hours', '1'),
('cancellation_cutoff_hours', '2'),
('tax_rate_percent', '19'),
('currency', 'EUR'),
('company_name', 'cstrsk.de Workspace Solutions'),
('company_address', 'cstrsk.de Digital Space, 80331 München'),
('company_vat_id', 'DE987654321');
