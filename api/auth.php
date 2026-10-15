<?php
/**
 * cstrsk.de Workspace & Room Booking System - Authentication API
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * Login, Registrierung, Logout, Session-Status, CSRF, Rate-Limiting
 */

declare(strict_types=1);
require_once __DIR__ . '/db.php';

$action = $_GET['action'] ?? $_POST['action'] ?? '';
$pdo = getDb();
$input = getJsonInput();

switch ($action) {
    case 'login':
        handleLogin($pdo, $input);
        break;

    case 'register':
        handleRegister($pdo, $input);
        break;

    case 'me':
    case 'status':
        handleMe($pdo);
        break;

    case 'logout':
        handleLogout();
        break;

    case 'csrf':
        jsonResponse(['csrf_token' => getCsrfToken()]);
        break;

    case 'reset_password':
        handlePasswordReset($pdo, $input);
        break;

    default:
        errorResponse('Ungültige Auth-Aktion.', 400);
}

function handleLogin(PDO $pdo, array $input): void {
    $email = strtolower(trim((string)($input['email'] ?? '')));
    $password = (string)($input['password'] ?? '');

    if (empty($email) || empty($password)) {
        errorResponse('E-Mail-Adresse und Passwort sind erforderlich.', 422);
    }

    // Rate-Limiting: Prüfe fehlerhafte Versuche in der Session
    $attempts = $_SESSION['login_attempts'] ?? 0;
    $lastAttempt = $_SESSION['last_attempt_time'] ?? 0;
    if ($attempts >= 5 && (time() - $lastAttempt) < 300) {
        $waitTime = 300 - (time() - $lastAttempt);
        errorResponse("Zu viele fehlgeschlagene Versuche. Bitte warten Sie noch {$waitTime} Sekunden.", 429);
    }

    $stmt = $pdo->prepare('SELECT id, email, password_hash, name, role, credits, company, phone, is_active FROM users WHERE email = :email');
    $stmt->execute([':email' => $email]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        $_SESSION['login_attempts'] = $attempts + 1;
        $_SESSION['last_attempt_time'] = time();
        errorResponse('Ungültige Anmeldedaten. Bitte überprüfen Sie E-Mail und Passwort.', 401);
    }

    if ((int)$user['is_active'] !== 1) {
        errorResponse('Dieses Benutzerkonto wurde deaktiviert.', 403);
    }

    // Login erfolgreich: Session regenerieren (Session Fixation Schutz)
    session_regenerate_id(true);
    $_SESSION['user_id'] = $user['id'];
    $_SESSION['login_attempts'] = 0;

    logAudit('user_login', $user['id'], 'user', $user['id'], ['email' => $email]);

    unset($user['password_hash']);
    jsonResponse([
        'success' => true,
        'user' => $user,
        'csrf_token' => getCsrfToken(),
    ]);
}

function handleRegister(PDO $pdo, array $input): void {
    $email = strtolower(trim((string)($input['email'] ?? '')));
    $password = (string)($input['password'] ?? '');
    $name = trim((string)($input['name'] ?? ''));
    $company = trim((string)($input['company'] ?? ''));
    $phone = trim((string)($input['phone'] ?? ''));
    $consentPrivacy = !empty($input['consent_privacy']);
    $consentTerms = !empty($input['consent_terms']);

    if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        errorResponse('Bitte geben Sie eine gültige E-Mail-Adresse ein.', 422);
    }

    if (strlen($password) < 8) {
        errorResponse('Das Passwort muss mindestens 8 Zeichen lang sein.', 422);
    }

    if (empty($name)) {
        errorResponse('Bitte geben Sie Ihren vollständigen Namen an.', 422);
    }

    // DSGVO-Pflichtprüfungen
    if (!$consentPrivacy || !$consentTerms) {
        errorResponse('Die Zustimmung zur Datenschutzerklärung und den Nutzungsbedingungen ist erforderlich.', 422);
    }

    // E-Mail-Duplikat prüfen
    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = :email');
    $stmt->execute([':email' => $email]);
    if ($stmt->fetch()) {
        errorResponse('Diese E-Mail-Adresse ist bereits registriert.', 409);
    }

    $userId = 'usr-' . bin2hex(random_bytes(6));
    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    $now = gmdate('Y-m-d\TH:i:s\Z');

    $stmt = $pdo->prepare('
        INSERT INTO users (id, email, password_hash, name, role, credits, company, phone, consent_privacy, consent_terms, is_active, created_at)
        VALUES (:id, :email, :hash, :name, :role, :credits, :company, :phone, :privacy, :terms, 1, :ts)
    ');

    $stmt->execute([
        ':id' => $userId,
        ':email' => $email,
        ':hash' => $passwordHash,
        ':name' => $name,
        ':role' => 'user',
        ':credits' => 50, // 50 Start-Credits
        ':company' => $company ?: null,
        ':phone' => $phone ?: null,
        ':privacy' => 1,
        ':terms' => 1,
        ':ts' => $now,
    ]);

    session_regenerate_id(true);
    $_SESSION['user_id'] = $userId;

    logAudit('user_registered', $userId, 'user', $userId, ['email' => $email]);

    jsonResponse([
        'success' => true,
        'user' => [
            'id' => $userId,
            'email' => $email,
            'name' => $name,
            'role' => 'user',
            'credits' => 50,
            'company' => $company,
            'phone' => $phone,
        ],
        'csrf_token' => getCsrfToken(),
    ], 201);
}

function handleMe(PDO $pdo): void {
    $user = getCurrentUser();
    jsonResponse([
        'authenticated' => $user !== null,
        'user' => $user,
        'csrf_token' => getCsrfToken(),
    ]);
}

function handleLogout(): void {
    $uid = $_SESSION['user_id'] ?? null;
    if ($uid) {
        logAudit('user_logout', $uid, 'user', $uid);
    }
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(session_name(), '', time() - 42000,
            $params['path'], $params['domain'],
            $params['secure'], $params['httponly']
        );
    }
    session_destroy();
    jsonResponse(['success' => true]);
}

function handlePasswordReset(PDO $pdo, array $input): void {
    $email = strtolower(trim((string)($input['email'] ?? '')));
    if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        errorResponse('Bitte eine gültige E-Mail-Adresse angeben.', 422);
    }

    // Aus Sicherheitsgründen immer Erfolgsmeldung zurückgeben
    jsonResponse([
        'success' => true,
        'message' => 'Falls die E-Mail existiert, wurde eine Anleitung zum Zurücksetzen versendet.',
    ]);
}
