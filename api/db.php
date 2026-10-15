<?php
/**
 * cstrsk.de Workspace & Room Booking System - Database & Utilities
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * PHP 8 + SQLite PDO mit Prepared Statements, Sessions und CSRF
 */

declare(strict_types=1);

// Standard-Zeitzone für DACH-Region
date_default_timezone_set('Europe/Berlin');

// Fehler-Reporting für Production konfigurieren
ini_set('display_errors', '0');
error_reporting(E_ALL);

// Session sicher starten
if (session_status() === PHP_SESSION_NONE) {
    ini_set('session.cookie_httponly', '1');
    ini_set('session.cookie_samesite', 'Lax');
    ini_set('session.use_strict_mode', '1');
    session_start();
}

// CORS & JSON Header
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-CSRF-Token');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

/**
 * SQLite PDO Verbindungs-Singleton
 */
function getDb(): PDO {
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    $dbDir = __DIR__ . '/../data';
    if (!is_dir($dbDir)) {
        mkdir($dbDir, 0755, true);
    }

    $dbFile = $dbDir . '/workspace.sqlite';
    $isNewDb = !file_exists($dbFile);

    try {
        $pdo = new PDO('sqlite:' . $dbFile, null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        // SQLite Pragmas für Integrität und Performance
        $pdo->exec('PRAGMA foreign_keys = ON;');
        $pdo->exec('PRAGMA journal_mode = WAL;');
        $pdo->exec('PRAGMA synchronous = NORMAL;');

        if ($isNewDb) {
            initDatabase($pdo);
        }

        return $pdo;
    } catch (PDOException $e) {
        error_log('Database Connection Error: ' . $e->getMessage());
        jsonResponse(['error' => 'Datenbankverbindung fehlgeschlagen.'], 500);
        exit;
    }
}

/**
 * Initialisiert Schema und Beispieldaten, falls DB neu erstellt wurde
 */
function initDatabase(PDO $pdo): void {
    $schemaFile = __DIR__ . '/../schema.sql';
    $seedFile = __DIR__ . '/../seed.sql';

    if (file_exists($schemaFile)) {
        $schemaSql = file_get_contents($schemaFile);
        $pdo->exec($schemaSql);
    }

    if (file_exists($seedFile)) {
        $seedSql = file_get_contents($seedFile);
        $pdo->exec($seedSql);
    }
}

/**
 * Sendet JSON Response
 */
function jsonResponse(mixed $data, int $statusCode = 200): void {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * Sendet Fehler als JSON
 */
function errorResponse(string $message, int $statusCode = 400, mixed $details = null): void {
    jsonResponse([
        'success' => false,
        'error' => $message,
        'details' => $details,
    ], $statusCode);
}

/**
 * Liest JSON Request Body
 */
function getJsonInput(): array {
    $raw = file_get_contents('php://input');
    if (empty($raw)) {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/**
 * Liefert den aktuell eingeloggten Benutzer aus der Session
 */
function getCurrentUser(): ?array {
    if (!empty($_SESSION['user_id'])) {
        $pdo = getDb();
        $stmt = $pdo->prepare('SELECT id, email, name, role, credits, company, phone FROM users WHERE id = :id AND is_active = 1');
        $stmt->execute([':id' => $_SESSION['user_id']]);
        $user = $stmt->fetch();
        if ($user) {
            return $user;
        }
    }
    return null;
}

/**
 * Erzwingt Login
 */
function requireAuth(): array {
    $user = getCurrentUser();
    if (!$user) {
        errorResponse('Authentifizierung erforderlich.', 401);
    }
    return $user;
}

/**
 * Erzwingt Admin- oder Staff-Rolle
 */
function requireAdmin(): array {
    $user = requireAuth();
    if ($user['role'] !== 'admin' && $user['role'] !== 'staff') {
        errorResponse('Zugriff verweigert. Administrator-Rechte erforderlich.', 403);
    }
    return $user;
}

/**
 * CSRF-Token erzeugen & validieren
 */
function getCsrfToken(): string {
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function verifyCsrfToken(?string $token): bool {
    if (empty($token) || empty($_SESSION['csrf_token'])) {
        return false;
    }
    return hash_equals($_SESSION['csrf_token'], $token);
}

/**
 * Erzeugt UUIDv4
 */
function generateUuid(): string {
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

/**
 * Audit Log Eintrag schreiben
 */
function logAudit(string $action, ?string $userId, string $entityType, string $entityId, array $details = []): void {
    try {
        $pdo = getDb();
        $stmt = $pdo->prepare('INSERT INTO audit_log (action, user_id, entity_type, entity_id, details, created_at) VALUES (:action, :uid, :etype, :eid, :details, :ts)');
        $stmt->execute([
            ':action' => $action,
            ':uid' => $userId,
            ':etype' => $entityType,
            ':eid' => $entityId,
            ':details' => json_encode($details, JSON_UNESCAPED_UNICODE),
            ':ts' => gmdate('Y-m-d\TH:i:s\Z'),
        ]);
    } catch (Exception $e) {
        // Stille Unterdrückung bei Logging-Fehlern
    }
}
