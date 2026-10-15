-- ============================================================================
-- cstrsk.de Workspace & Room Booking System - SQLite Schema
-- Version: 1.0.0 (Production)
-- Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
-- Zeitzone: Zeiten werden standardisiert in ISO-8601 UTC gespeichert.
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Ressourcentypen (Seminarraum, Tisch, Shared-Workspace-Platz)
CREATE TABLE IF NOT EXISTS resource_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT
);

-- 2. Ressourcen
CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    type_id TEXT NOT NULL REFERENCES resource_types(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    location TEXT NOT NULL,             -- z.B. "1. OG - Ostflügel", "EG - Coworking Space"
    capacity INTEGER NOT NULL DEFAULT 1,
    equipment TEXT DEFAULT '[]',        -- JSON Array: ["beamer","whiteboard","video","catering","monitor","docking","power"]
    seating_options TEXT DEFAULT '[]',  -- JSON Array für Räume: ["reihen","u_form","block"]
    desk_type TEXT DEFAULT NULL,        -- 'hot_desk' oder 'fixed_desk' für Workspaces
    image_url TEXT,
    hourly_rate REAL DEFAULT 0,         -- Netto in EUR
    half_day_rate REAL DEFAULT 0,       -- Netto in EUR (4 Std)
    daily_rate REAL DEFAULT 0,          -- Netto in EUR (Tag)
    weekly_rate REAL DEFAULT 0,         -- Netto in EUR
    monthly_rate REAL DEFAULT 0,        -- Netto in EUR
    min_duration_minutes INTEGER DEFAULT 30,
    max_duration_minutes INTEGER DEFAULT 1440,
    buffer_minutes INTEGER DEFAULT 15,  -- Pufferzeit zwischen Buchungen (Reinigung/Lüften)
    requires_approval INTEGER DEFAULT 0,-- 1 = Admin-Genehmigung erforderlich
    opening_time TEXT DEFAULT '07:00',  -- HH:MM
    closing_time TEXT DEFAULT '20:00',  -- HH:MM
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
);

-- 3. Preisstaffelungen & Sondertarife
CREATE TABLE IF NOT EXISTS prices (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    tier_name TEXT NOT NULL,            -- 'hourly', 'half_day', 'daily', 'weekly', 'monthly'
    amount_net REAL NOT NULL,
    tax_rate REAL NOT NULL DEFAULT 0.19,
    amount_gross REAL NOT NULL,
    description TEXT
);

-- 4. Benutzer & Rollen (Admin, Mitarbeiter, Nutzer)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'staff', 'user')),
    credits INTEGER DEFAULT 0,          -- Buchungskontingent/Guthaben
    company TEXT,
    phone TEXT,
    consent_privacy INTEGER DEFAULT 1,  -- DSGVO Checkbox
    consent_terms INTEGER DEFAULT 1,
    is_active INTEGER DEFAULT 1,
    created_at TEXT NOT NULL
);

-- 5. Wiederholungsregeln (Serienbuchungen)
CREATE TABLE IF NOT EXISTS recurrences (
    id TEXT PRIMARY KEY,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    interval_val INTEGER NOT NULL DEFAULT 1,
    until_date TEXT NOT NULL,           -- Enddatum YYYY-MM-DD
    created_at TEXT NOT NULL
);

-- 6. Buchungen
CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY,
    booking_number TEXT UNIQUE NOT NULL,-- z.B. AX-2026-1001
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    start_time TEXT NOT NULL,           -- ISO-8601 UTC: '2026-10-15T08:00:00Z'
    end_time TEXT NOT NULL,             -- ISO-8601 UTC: '2026-10-15T12:00:00Z'
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'pending_approval', 'cancelled', 'completed', 'checked_in')),
    title TEXT NOT NULL,
    notes TEXT,
    seating_choice TEXT,                -- 'reihen', 'u_form', 'block'
    recurrence_id TEXT REFERENCES recurrences(id) ON DELETE SET NULL,
    total_price_net REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 0.19,
    total_price_gross REAL NOT NULL DEFAULT 0,
    attendees_count INTEGER DEFAULT 1,
    check_in_code TEXT NOT NULL,        -- Token für QR-Code Check-in
    checked_in_at TEXT,
    cancellation_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 7. Sperrzeiten & Feiertage (Blocks)
CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    resource_id TEXT REFERENCES resources(id) ON DELETE CASCADE, -- NULL = alle Ressourcen (z.B. Feiertag)
    start_time TEXT NOT NULL,           -- ISO-8601 UTC
    end_time TEXT NOT NULL,             -- ISO-8601 UTC
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- 8. Warteliste (Benachrichtigung, wenn Slot frei wird)
CREATE TABLE IF NOT EXISTS waitlist (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    desired_start TEXT NOT NULL,
    desired_end TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'notified', 'fulfilled', 'cancelled')),
    notified_at TEXT,
    created_at TEXT NOT NULL
);

-- 9. Audit-Log (DSGVO & Nachvollziehbarkeit)
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,               -- 'booking_created', 'booking_cancelled', 'user_registered', etc.
    user_id TEXT,
    entity_type TEXT NOT NULL,          -- 'booking', 'user', 'resource'
    entity_id TEXT NOT NULL,
    details TEXT,                       -- JSON Details
    created_at TEXT NOT NULL
);

-- 10. Globale Systemeinstellungen
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- ============================================================================
-- Indizes für Performanz und atomare Konfliktprüfung
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_bookings_resource_time 
    ON bookings (resource_id, start_time, end_time, status);

CREATE INDEX IF NOT EXISTS idx_bookings_user 
    ON bookings (user_id, start_time);

CREATE INDEX IF NOT EXISTS idx_bookings_status 
    ON bookings (status);

CREATE INDEX IF NOT EXISTS idx_blocks_resource_time 
    ON blocks (resource_id, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_waitlist_resource_status 
    ON waitlist (resource_id, status);

CREATE INDEX IF NOT EXISTS idx_users_email 
    ON users (email);
