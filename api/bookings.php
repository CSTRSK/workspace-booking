<?php
/**
 * cstrsk.de Workspace & Room Booking System - Bookings API
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * Transaktionssichere Buchung, Live-Konfliktprüfung, Serienbuchungen,
 * Stornofristen, Check-in via QR-Code, MwSt-Berechnung & Wartelisten-Benachrichtigung
 */

declare(strict_types=1);
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/resources.php';

$pdo = getDb();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

switch ($method) {
    case 'GET':
        handleGetBookings($pdo);
        break;

    case 'POST':
        if ($action === 'checkin') {
            handleCheckin($pdo);
        } elseif ($action === 'cancel') {
            handleCancelBooking($pdo);
        } else {
            handleCreateBooking($pdo);
        }
        break;

    case 'PUT':
        handleUpdateBooking($pdo);
        break;

    case 'DELETE':
        handleCancelBooking($pdo);
        break;

    default:
        errorResponse('Methode nicht erlaubt', 405);
}

function handleGetBookings(PDO $pdo): void {
    $user = requireAuth();
    $isAdmin = in_array($user['role'], ['admin', 'staff'], true);
    $viewAll = $isAdmin && (!empty($_GET['all']) || !empty($_GET['admin']));

    $sql = '
        SELECT b.*, r.title as resource_title, r.location as resource_location, 
               r.type_id as resource_type, u.name as user_name, u.email as user_email
        FROM bookings b
        JOIN resources r ON b.resource_id = r.id
        JOIN users u ON b.user_id = u.id
    ';

    $params = [];
    if (!$viewAll) {
        $sql .= ' WHERE b.user_id = :uid';
        $params[':uid'] = $user['id'];
    } else {
        $sql .= ' WHERE 1=1';
        if (!empty($_GET['status'])) {
            $sql .= ' AND b.status = :status';
            $params[':status'] = $_GET['status'];
        }
        if (!empty($_GET['resource_id'])) {
            $sql .= ' AND b.resource_id = :rid';
            $params[':rid'] = $_GET['resource_id'];
        }
    }

    $sql .= ' ORDER BY b.start_time DESC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $bookings = $stmt->fetchAll();

    jsonResponse([
        'success' => true,
        'count' => count($bookings),
        'bookings' => $bookings,
    ]);
}

function handleCreateBooking(PDO $pdo): void {
    $user = getCurrentUser();
    $input = getJsonInput();

    // Gast-Buchung prüfen, falls nicht eingeloggt
    if (!$user) {
        $stmtSetting = $pdo->query('SELECT "value" FROM system_settings WHERE "key" = \'allow_guest_booking\'');
        $allowGuest = (int)($stmtSetting->fetchColumn() ?: 1);
        if (!$allowGuest) {
            errorResponse('Gast-Buchungen sind deaktiviert. Bitte melden Sie sich an.', 401);
        }

        // Automatischen Gast-Benutzer erzeugen oder bestehenden anhand E-Mail nutzen
        $guestEmail = strtolower(trim((string)($input['guest_email'] ?? '')));
        $guestName = trim((string)($input['guest_name'] ?? 'Gast'));

        if (empty($guestEmail) || !filter_var($guestEmail, FILTER_VALIDATE_EMAIL)) {
            errorResponse('Bitte geben Sie für Gast-Buchungen eine gültige E-Mail-Adresse an.', 422);
        }

        $stmtUser = $pdo->prepare('SELECT id, name, email, role FROM users WHERE email = :email');
        $stmtUser->execute([':email' => $guestEmail]);
        $existing = $stmtUser->fetch();

        if ($existing) {
            $user = $existing;
        } else {
            $guestId = 'usr-guest-' . bin2hex(random_bytes(4));
            $now = gmdate('Y-m-d\TH:i:s\Z');
            $stmtNew = $pdo->prepare('
                INSERT INTO users (id, email, password_hash, name, role, credits, consent_privacy, consent_terms, is_active, created_at)
                VALUES (:id, :email, :dummy, :name, "user", 0, 1, 1, 1, :ts)
            ');
            $stmtNew->execute([
                ':id' => $guestId,
                ':email' => $guestEmail,
                ':dummy' => password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT),
                ':name' => $guestName,
                ':ts' => $now,
            ]);
            $user = ['id' => $guestId, 'name' => $guestName, 'email' => $guestEmail, 'role' => 'user'];
        }
    }

    // Falls Admin für einen anderen Benutzer bucht
    if (!empty($input['booking_for_user_id']) && in_array($user['role'], ['admin', 'staff'], true)) {
        $targetUserId = (string)$input['booking_for_user_id'];
        $stmtTarget = $pdo->prepare('SELECT id, name, email, role FROM users WHERE id = :id');
        $stmtTarget->execute([':id' => $targetUserId]);
        $targetUser = $stmtTarget->fetch();
        if ($targetUser) {
            $user = $targetUser;
        }
    }

    $resourceId = (string)($input['resource_id'] ?? '');
    $startTime = (string)($input['start_time'] ?? ''); // ISO 8601 UTC
    $endTime = (string)($input['end_time'] ?? '');     // ISO 8601 UTC
    $title = trim((string)($input['title'] ?? 'Arbeitsplatz-/Raumbuchung'));
    $notes = trim((string)($input['notes'] ?? ''));
    $seatingChoice = $input['seating_choice'] ?? null;
    $attendeesCount = max(1, (int)($input['attendees_count'] ?? 1));

    if (empty($resourceId) || empty($startTime) || empty($endTime)) {
        errorResponse('resource_id, start_time und end_time sind Pflichtfelder.', 422);
    }

    $startTimestamp = strtotime($startTime);
    $endTimestamp = strtotime($endTime);
    $nowTimestamp = time();

    if ($endTimestamp <= $startTimestamp) {
        errorResponse('Der Endzeitpunkt muss nach dem Startzeitpunkt liegen.', 422);
    }

    if ($startTimestamp < ($nowTimestamp - 300)) {
        errorResponse('Buchungen in der Vergangenheit sind nicht zulässig.', 422);
    }

    $durationMinutes = (int)(($endTimestamp - $startTimestamp) / 60);

    // =========================================================================
    // Atomare Transaktion für Konfliktprüfung und Buchungserstellung
    // =========================================================================
    $pdo->beginTransaction();

    try {
        // Ressourcendetails abrufen
        $stmtRes = $pdo->prepare('SELECT * FROM resources WHERE id = :id AND is_active = 1');
        $stmtRes->execute([':id' => $resourceId]);
        $resource = $stmtRes->fetch();

        if (!$resource) {
            $pdo->rollBack();
            errorResponse('Die gewählte Ressource existiert nicht oder ist inaktiv.', 404);
        }

        // Dauer-Validierung
        if ($durationMinutes < (int)$resource['min_duration_minutes']) {
            $pdo->rollBack();
            errorResponse("Die Mindestbuchungsdauer beträgt {$resource['min_duration_minutes']} Minuten.", 422);
        }
        if ($durationMinutes > (int)$resource['max_duration_minutes']) {
            $pdo->rollBack();
            errorResponse("Die maximale Buchungsdauer beträgt {$resource['max_duration_minutes']} Minuten.", 422);
        }

        // Kapazitätsvalidierung
        if ($attendeesCount > (int)$resource['capacity']) {
            $pdo->rollBack();
            errorResponse("Die maximale Personenzahl beträgt {$resource['capacity']}.", 422);
        }

        // Serienbuchung prüfen
        $isRecurring = !empty($input['is_recurring']) && !empty($input['frequency']) && !empty($input['until_date']);
        $recurrenceId = null;
        $bookingDates = [];

        if ($isRecurring) {
            $freq = (string)$input['frequency']; // 'daily', 'weekly', 'monthly'
            $untilDate = (string)$input['until_date'];
            $untilTimestamp = strtotime($untilDate . 'T23:59:59Z');

            $recurrenceId = 'rec-' . bin2hex(random_bytes(6));
            $stmtRec = $pdo->prepare('INSERT INTO recurrences (id, frequency, interval_val, until_date, created_at) VALUES (:id, :freq, 1, :until, :ts)');
            $stmtRec->execute([
                ':id' => $recurrenceId,
                ':freq' => $freq,
                ':until' => $untilDate,
                ':ts' => gmdate('Y-m-d\TH:i:s\Z'),
            ]);

            // Daten generieren
            $curStart = $startTimestamp;
            $curEnd = $endTimestamp;
            while ($curStart <= $untilTimestamp) {
                $bookingDates[] = [
                    'start' => gmdate('Y-m-d\TH:i:s\Z', $curStart),
                    'end' => gmdate('Y-m-d\TH:i:s\Z', $curEnd),
                ];
                if ($freq === 'daily') {
                    $curStart = strtotime('+1 day', $curStart);
                    $curEnd = strtotime('+1 day', $curEnd);
                } elseif ($freq === 'weekly') {
                    $curStart = strtotime('+1 week', $curStart);
                    $curEnd = strtotime('+1 week', $curEnd);
                } elseif ($freq === 'monthly') {
                    $curStart = strtotime('+1 month', $curStart);
                    $curEnd = strtotime('+1 month', $curEnd);
                }
            }
        } else {
            $bookingDates[] = [
                'start' => $startTime,
                'end' => $endTime,
            ];
        }

        // Live-Konfliktprüfung für alle Termine
        $bufferMinutes = (int)$resource['buffer_minutes'];
        foreach ($bookingDates as $slot) {
            $conflict = checkConflict($pdo, $resourceId, $slot['start'], $slot['end'], $bufferMinutes);
            if ($conflict['has_conflict']) {
                $pdo->rollBack();
                errorResponse("Konflikt für Termin am " . substr($slot['start'], 0, 10) . ": " . $conflict['reason'], 409);
            }
        }

        // Preisberechnung
        $pricing = calculatePrice($resource, $durationMinutes);
        $status = ((int)$resource['requires_approval'] === 1) ? 'pending_approval' : 'confirmed';

        $createdBookings = [];
        $stmtInsert = $pdo->prepare('
            INSERT INTO bookings (
                id, booking_number, resource_id, user_id, start_time, end_time, 
                status, title, notes, seating_choice, recurrence_id, 
                total_price_net, tax_rate, total_price_gross, attendees_count, 
                check_in_code, created_at, updated_at
            ) VALUES (
                :id, :bnum, :rid, :uid, :start, :end,
                :status, :title, :notes, :seating, :rec_id,
                :net, :tax, :gross, :attendees,
                :code, :created, :updated
            )
        ');

        foreach ($bookingDates as $idx => $slot) {
            $bookingId = 'bk-' . bin2hex(random_bytes(6));
            $bookingNumber = 'CST-' . date('Y') . '-' . strtoupper(substr(bin2hex(random_bytes(3)), 0, 6));
            $checkInCode = strtoupper(bin2hex(random_bytes(4)));
            $now = gmdate('Y-m-d\TH:i:s\Z');

            $stmtInsert->execute([
                ':id' => $bookingId,
                ':bnum' => $bookingNumber,
                ':rid' => $resourceId,
                ':uid' => $user['id'],
                ':start' => $slot['start'],
                ':end' => $slot['end'],
                ':status' => $status,
                ':title' => $title,
                ':notes' => $notes ?: null,
                ':seating' => $seatingChoice ?: null,
                ':rec_id' => $recurrenceId,
                ':net' => $pricing['net'],
                ':tax' => $pricing['tax_rate'],
                ':gross' => $pricing['gross'],
                ':attendees' => $attendeesCount,
                ':code' => $checkInCode,
                ':created' => $now,
                ':updated' => $now,
            ]);

            $createdBookings[] = [
                'id' => $bookingId,
                'booking_number' => $bookingNumber,
                'start_time' => $slot['start'],
                'end_time' => $slot['end'],
                'status' => $status,
                'check_in_code' => $checkInCode,
                'total_price_gross' => $pricing['gross'],
            ];
        }

        $pdo->commit();

        logAudit('booking_created', $user['id'], 'booking', $createdBookings[0]['id'], [
            'count' => count($createdBookings),
            'resource' => $resource['title'],
        ]);

        jsonResponse([
            'success' => true,
            'message' => $status === 'pending_approval' 
                ? 'Buchung erfolgreich eingereicht! Warten auf Freigabe durch den Administrator.'
                : 'Buchung erfolgreich bestätigt!',
            'booking' => $createdBookings[0],
            'all_created' => $createdBookings,
            'pricing' => $pricing,
        ], 201);

    } catch (Exception $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('Booking Create Error: ' . $e->getMessage());
        errorResponse('Buchung fehlgeschlagen: ' . $e->getMessage(), 500);
    }
}

function handleUpdateBooking(PDO $pdo): void {
    $user = requireAuth();
    $bookingId = (string)($_GET['id'] ?? '');
    $input = getJsonInput();

    if (empty($bookingId)) {
        errorResponse('Booking ID fehlt.', 400);
    }

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = :id');
    $stmt->execute([':id' => $bookingId]);
    $booking = $stmt->fetch();

    if (!$booking) {
        errorResponse('Buchung nicht gefunden.', 404);
    }

    // Nur Eigentümer oder Admin dürfen bearbeiten
    $isAdmin = in_array($user['role'], ['admin', 'staff'], true);
    if (!$isAdmin && $booking['user_id'] !== $user['id']) {
        errorResponse('Keine Berechtigung zum Ändern dieser Buchung.', 403);
    }

    if ($booking['status'] === 'cancelled') {
        errorResponse('Stornierte Buchungen können nicht mehr bearbeitet werden.', 422);
    }

    $newStart = $input['start_time'] ?? $booking['start_time'];
    $newEnd = $input['end_time'] ?? $booking['end_time'];
    $newTitle = trim((string)($input['title'] ?? $booking['title']));
    $newNotes = isset($input['notes']) ? trim((string)$input['notes']) : $booking['notes'];

    // Konfliktprüfung bei Terminänderung
    if ($newStart !== $booking['start_time'] || $newEnd !== $booking['end_time']) {
        $stmtRes = $pdo->prepare('SELECT buffer_minutes FROM resources WHERE id = :id');
        $stmtRes->execute([':id' => $booking['resource_id']]);
        $buffer = (int)($stmtRes->fetchColumn() ?: 15);

        $conflict = checkConflict($pdo, $booking['resource_id'], $newStart, $newEnd, $buffer, $bookingId);
        if ($conflict['has_conflict']) {
            errorResponse('Terminkonflikt: ' . $conflict['reason'], 409);
        }
    }

    $stmtUpdate = $pdo->prepare('
        UPDATE bookings SET 
            start_time = :start, 
            end_time = :end, 
            title = :title, 
            notes = :notes, 
            updated_at = :ts 
        WHERE id = :id
    ');

    $stmtUpdate->execute([
        ':start' => $newStart,
        ':end' => $newEnd,
        ':title' => $newTitle,
        ':notes' => $newNotes,
        ':ts' => gmdate('Y-m-d\TH:i:s\Z'),
        ':id' => $bookingId,
    ]);

    logAudit('booking_updated', $user['id'], 'booking', $bookingId);

    jsonResponse(['success' => true, 'message' => 'Buchung erfolgreich aktualisiert.']);
}

function handleCancelBooking(PDO $pdo): void {
    $user = requireAuth();
    $input = getJsonInput();
    $bookingId = (string)($_GET['id'] ?? $input['id'] ?? $input['booking_id'] ?? '');

    if (empty($bookingId)) {
        errorResponse('Booking ID fehlt.', 400);
    }

    $stmt = $pdo->prepare('SELECT * FROM bookings WHERE id = :id');
    $stmt->execute([':id' => $bookingId]);
    $booking = $stmt->fetch();

    if (!$booking) {
        errorResponse('Buchung nicht gefunden.', 404);
    }

    $isAdmin = in_array($user['role'], ['admin', 'staff'], true);
    if (!$isAdmin && $booking['user_id'] !== $user['id']) {
        errorResponse('Keine Berechtigung zum Stornieren dieser Buchung.', 403);
    }

    // Stornofrist prüfen (z.B. mindestens 2 Stunden vorher)
    $stmtCutoff = $pdo->query('SELECT "value" FROM system_settings WHERE "key" = \'cancellation_cutoff_hours\'');
    $cutoffHours = (int)($stmtCutoff->fetchColumn() ?: 2);

    $startTs = strtotime($booking['start_time']);
    if (!$isAdmin && ($startTs - time()) < ($cutoffHours * 3600)) {
        errorResponse("Stornofrist abgelaufen. Buchungen müssen mindestens {$cutoffHours} Stunden vor Beginn storniert werden.", 422);
    }

    $stmtCancel = $pdo->prepare('
        UPDATE bookings SET 
            status = "cancelled", 
            cancellation_reason = :reason,
            updated_at = :ts 
        WHERE id = :id
    ');

    $stmtCancel->execute([
        ':reason' => 'Vom Nutzer storniert',
        ':ts' => gmdate('Y-m-d\TH:i:s\Z'),
        ':id' => $bookingId,
    ]);

    logAudit('booking_cancelled', $user['id'], 'booking', $bookingId);

    // Warteliste prüfen und benachrichtigen!
    notifyWaitlist($pdo, $booking['resource_id'], $booking['start_time'], $booking['end_time']);

    jsonResponse([
        'success' => true,
        'message' => 'Buchung wurde erfolgreich storniert. Ein etwaiger Platz auf der Warteliste wurde freigegeben.',
    ]);
}

function handleCheckin(PDO $pdo): void {
    $input = getJsonInput();
    $code = strtoupper(trim((string)($input['check_in_code'] ?? '')));

    if (empty($code)) {
        errorResponse('Check-in-Code erforderlich.', 422);
    }

    $stmt = $pdo->prepare('
        SELECT b.*, r.title as resource_title, u.name as user_name 
        FROM bookings b
        JOIN resources r ON b.resource_id = r.id
        JOIN users u ON b.user_id = u.id
        WHERE b.check_in_code = :code AND b.status IN ("confirmed", "pending_approval")
    ');
    $stmt->execute([':code' => $code]);
    $booking = $stmt->fetch();

    if (!$booking) {
        errorResponse('Ungültiger oder bereits genutzter Check-in-Code.', 404);
    }

    $now = gmdate('Y-m-d\TH:i:s\Z');
    $stmtUpdate = $pdo->prepare('UPDATE bookings SET status = "checked_in", checked_in_at = :ts, updated_at = :ts WHERE id = :id');
    $stmtUpdate->execute([':ts' => $now, ':id' => $booking['id']]);

    jsonResponse([
        'success' => true,
        'message' => "Erfolgreich eingecheckt für '{$booking['resource_title']}'!",
        'booking' => $booking,
    ]);
}

/**
 * Wartelisten-Benachrichtigung
 */
function notifyWaitlist(PDO $pdo, string $resourceId, string $startUtc, string $endUtc): void {
    $stmt = $pdo->prepare('
        SELECT w.*, u.email, u.name 
        FROM waitlist w
        JOIN users u ON w.user_id = u.id
        WHERE w.resource_id = :rid 
          AND w.status = "waiting"
          AND w.desired_start <= :end 
          AND w.desired_end >= :start
        ORDER BY w.created_at ASC
    ');
    $stmt->execute([
        ':rid' => $resourceId,
        ':start' => $startUtc,
        ':end' => $endUtc,
    ]);
    $waitingUsers = $stmt->fetchAll();

    foreach ($waitingUsers as $entry) {
        $stmtUpdate = $pdo->prepare('UPDATE waitlist SET status = "notified", notified_at = :ts WHERE id = :id');
        $stmtUpdate->execute([
            ':ts' => gmdate('Y-m-d\TH:i:s\Z'),
            ':id' => $entry['id'],
        ]);
        // In Produktion: mail() mit ICS
    }
}

/**
 * Preisberechnung (Stunde, Halbtag, Tag, Woche, Monat) + 19% MwSt
 */
function calculatePrice(array $resource, int $durationMinutes): array {
    $hours = $durationMinutes / 60.0;
    $net = 0.0;

    $hourly = (float)$resource['hourly_rate'];
    $halfDay = (float)$resource['half_day_rate'];
    $daily = (float)$resource['daily_rate'];
    $weekly = (float)$resource['weekly_rate'];
    $monthly = (float)$resource['monthly_rate'];

    if ($hours >= 168 && $weekly > 0) {
        // Wochenweise
        $weeks = ceil($hours / 168);
        $net = $weeks * $weekly;
    } elseif ($hours >= 8 && $daily > 0) {
        // Tageweise
        $days = ceil($hours / 8);
        $net = $days * $daily;
    } elseif ($hours >= 4 && $halfDay > 0) {
        // Halbtag
        $halfDays = ceil($hours / 4);
        $net = $halfDays * $halfDay;
    } elseif ($hourly > 0) {
        // Stundengenaue Abrechnung
        $net = round($hours * $hourly, 2);
    } else {
        $net = 0.0;
    }

    $taxRate = 0.19;
    $taxAmount = round($net * $taxRate, 2);
    $gross = round($net + $taxAmount, 2);

    return [
        'duration_minutes' => $durationMinutes,
        'duration_hours' => $hours,
        'net' => $net,
        'tax_rate' => $taxRate,
        'tax_amount' => $taxAmount,
        'gross' => $gross,
    ];
}
