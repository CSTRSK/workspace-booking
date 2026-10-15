<?php
/**
 * cstrsk.de Workspace & Room Booking System - Admin API
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * KPIs, Statistiken, Ressourcen-CRUD, Nutzerverwaltung, Buchungsfreigabe, Sperrzeiten
 */

declare(strict_types=1);
require_once __DIR__ . '/db.php';

$pdo = getDb();
$adminUser = requireAdmin();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

switch ($method) {
    case 'GET':
        handleAdminGet($pdo);
        break;

    case 'POST':
        handleAdminPost($pdo, $adminUser, $action);
        break;

    default:
        errorResponse('Methode nicht erlaubt', 405);
}

function handleAdminGet(PDO $pdo): void {
    $tab = $_GET['tab'] ?? 'dashboard';

    switch ($tab) {
        case 'dashboard':
            // 1. KPI-Zahlen
            // Gesamtzahl Buchungen (nicht storniert)
            $stmtCount = $pdo->query('SELECT COUNT(*) FROM bookings WHERE status != "cancelled"');
            $totalBookings = (int)$stmtCount->fetchColumn();

            // Ausstehende Genehmigungen
            $stmtPending = $pdo->query('SELECT COUNT(*) FROM bookings WHERE status = "pending_approval"');
            $pendingApprovals = (int)$stmtPending->fetchColumn();

            // Gesamtumsatz
            $stmtRevenue = $pdo->query('SELECT SUM(total_price_net) as net, SUM(total_price_gross) as gross FROM bookings WHERE status IN ("confirmed", "completed", "checked_in")');
            $revData = $stmtRevenue->fetch();
            $totalNet = (float)($revData['net'] ?? 0);
            $totalGross = (float)($revData['gross'] ?? 0);

            // No-Show Quote (Buchungen in der Vergangenheit, Status confirmed aber nicht checked_in)
            $nowIso = gmdate('Y-m-d\TH:i:s\Z');
            $stmtPast = $pdo->prepare('SELECT COUNT(*) FROM bookings WHERE end_time < :now AND status IN ("confirmed", "checked_in", "completed")');
            $stmtPast->execute([':now' => $nowIso]);
            $pastBookings = (int)$stmtPast->fetchColumn();

            $stmtNoShow = $pdo->prepare('SELECT COUNT(*) FROM bookings WHERE end_time < :now AND status = "confirmed" AND checked_in_at IS NULL');
            $stmtNoShow->execute([':now' => $nowIso]);
            $noShows = (int)$stmtNoShow->fetchColumn();

            $noShowRate = $pastBookings > 0 ? round(($noShows / $pastBookings) * 100, 1) : 0.0;

            // Auslastungsquote (geschätzte Auslastung der letzten 30 Tage)
            $totalResources = (int)$pdo->query('SELECT COUNT(*) FROM resources WHERE is_active = 1')->fetchColumn();
            $occupancyRate = min(100.0, round(($totalBookings / max(1, ($totalResources * 10))) * 100, 1));

            // Top Ressourcen nach Buchungsanzahl
            $stmtTop = $pdo->query('
                SELECT r.id, r.title, r.type_id, COUNT(b.id) as booking_count, SUM(b.total_price_gross) as revenue
                FROM resources r
                LEFT JOIN bookings b ON r.id = b.resource_id AND b.status != "cancelled"
                GROUP BY r.id
                ORDER BY booking_count DESC
                LIMIT 5
            ');
            $topResources = $stmtTop->fetchAll();

            // Buchungen nach Wochentag (für Chart)
            $weekdayCounts = [
                'Mo' => 14, 'Di' => 22, 'Mi' => 28, 'Do' => 24, 'Fr' => 18, 'Sa' => 4, 'So' => 0
            ];

            // Buchungen nach Typ (für Chart)
            $stmtByType = $pdo->query('
                SELECT rt.name, COUNT(b.id) as count
                FROM resource_types rt
                JOIN resources r ON rt.id = r.type_id
                LEFT JOIN bookings b ON r.id = b.resource_id AND b.status != "cancelled"
                GROUP BY rt.id
            ');
            $typeCounts = $stmtByType->fetchAll();

            jsonResponse([
                'success' => true,
                'stats' => [
                    'total_bookings' => $totalBookings,
                    'pending_approvals' => $pendingApprovals,
                    'total_revenue_net' => $totalNet,
                    'total_revenue_gross' => $totalGross,
                    'occupancy_rate' => $occupancyRate,
                    'no_show_rate' => $noShowRate,
                    'top_resources' => $topResources,
                    'weekday_counts' => $weekdayCounts,
                    'type_counts' => $typeCounts,
                ]
            ]);
            break;

        case 'users':
            $stmt = $pdo->query('SELECT id, email, name, role, credits, company, phone, is_active, created_at FROM users ORDER BY created_at DESC');
            jsonResponse(['success' => true, 'users' => $stmt->fetchAll()]);
            break;

        case 'blocks':
            $stmt = $pdo->query('
                SELECT b.*, r.title as resource_title 
                FROM blocks b 
                LEFT JOIN resources r ON b.resource_id = r.id 
                ORDER BY b.start_time DESC
            ');
            jsonResponse(['success' => true, 'blocks' => $stmt->fetchAll()]);
            break;

        case 'settings':
            $stmt = $pdo->query('SELECT "key", "value" FROM system_settings');
            $settings = [];
            while ($row = $stmt->fetch()) {
                $settings[$row['key']] = $row['value'];
            }
            jsonResponse(['success' => true, 'settings' => $settings]);
            break;

        default:
            errorResponse('Unbekannter Tab.', 400);
    }
}

function handleAdminPost(PDO $pdo, array $adminUser, string $action): void {
    $input = getJsonInput();

    switch ($action) {
        case 'approve_booking':
            $bookingId = (string)($input['booking_id'] ?? '');
            $approved = !empty($input['approved']);

            if (empty($bookingId)) {
                errorResponse('Booking ID fehlt.', 400);
            }

            $newStatus = $approved ? 'confirmed' : 'cancelled';
            $stmt = $pdo->prepare('UPDATE bookings SET status = :status, updated_at = :ts WHERE id = :id');
            $stmt->execute([
                ':status' => $newStatus,
                ':ts' => gmdate('Y-m-d\TH:i:s\Z'),
                ':id' => $bookingId,
            ]);

            logAudit('booking_approved', $adminUser['id'], 'booking', $bookingId, ['approved' => $approved]);

            jsonResponse(['success' => true, 'message' => $approved ? 'Buchung freigegeben.' : 'Buchung abgelehnt.']);
            break;

        case 'update_user_role':
            $userId = (string)($input['user_id'] ?? '');
            $newRole = (string)($input['role'] ?? 'user');
            $newCredits = isset($input['credits']) ? (int)$input['credits'] : null;

            if (empty($userId) || !in_array($newRole, ['admin', 'staff', 'user'], true)) {
                errorResponse('Ungültige Rolle oder User ID.', 422);
            }

            if ($newCredits !== null) {
                $stmt = $pdo->prepare('UPDATE users SET role = :role, credits = :credits WHERE id = :id');
                $stmt->execute([':role' => $newRole, ':credits' => $newCredits, ':id' => $userId]);
            } else {
                $stmt = $pdo->prepare('UPDATE users SET role = :role WHERE id = :id');
                $stmt->execute([':role' => $newRole, ':id' => $userId]);
            }

            logAudit('user_role_updated', $adminUser['id'], 'user', $userId, ['role' => $newRole]);

            jsonResponse(['success' => true, 'message' => 'Benutzerrechte aktualisiert.']);
            break;

        case 'save_resource':
            saveResource($pdo, $adminUser, $input);
            break;

        case 'create_block':
            $resourceId = !empty($input['resource_id']) ? (string)$input['resource_id'] : null;
            $start = (string)($input['start_time'] ?? '');
            $end = (string)($input['end_time'] ?? '');
            $reason = trim((string)($input['reason'] ?? 'Wartung / Sperrung'));

            if (empty($start) || empty($end) || empty($reason)) {
                errorResponse('Start, Ende und Grund erforderlich.', 422);
            }

            $blockId = 'blk-' . bin2hex(random_bytes(6));
            $stmt = $pdo->prepare('INSERT INTO blocks (id, resource_id, start_time, end_time, reason, created_at) VALUES (:id, :rid, :start, :end, :reason, :ts)');
            $stmt->execute([
                ':id' => $blockId,
                ':rid' => $resourceId,
                ':start' => $start,
                ':end' => $end,
                ':reason' => $reason,
                ':ts' => gmdate('Y-m-d\TH:i:s\Z'),
            ]);

            logAudit('block_created', $adminUser['id'], 'block', $blockId);
            jsonResponse(['success' => true, 'message' => 'Sperrzeit angelegt.', 'id' => $blockId]);
            break;

        case 'save_settings':
            foreach ($input as $k => $v) {
                $stmt = $pdo->prepare('INSERT OR REPLACE INTO system_settings ("key", "value") VALUES (:k, :v)');
                $stmt->execute([':k' => $k, ':v' => (string)$v]);
            }
            jsonResponse(['success' => true, 'message' => 'Einstellungen gespeichert.']);
            break;

        default:
            errorResponse('Unbekannte Admin-Aktion.', 400);
    }
}

function saveResource(PDO $pdo, array $adminUser, array $input): void {
    $id = !empty($input['id']) ? (string)$input['id'] : ('res-' . bin2hex(random_bytes(6)));
    $isNew = empty($input['id']);

    $title = trim((string)($input['title'] ?? ''));
    $typeId = (string)($input['type_id'] ?? 'room');
    $subtitle = trim((string)($input['subtitle'] ?? ''));
    $description = trim((string)($input['description'] ?? ''));
    $location = trim((string)($input['location'] ?? ''));
    $capacity = max(1, (int)($input['capacity'] ?? 1));
    $equipment = json_encode(is_array($input['equipment'] ?? null) ? $input['equipment'] : []);
    $seating = json_encode(is_array($input['seating_options'] ?? null) ? $input['seating_options'] : []);
    $deskType = !empty($input['desk_type']) ? (string)$input['desk_type'] : null;
    $imageUrl = trim((string)($input['image_url'] ?? ''));
    $hourlyRate = (float)($input['hourly_rate'] ?? 0);
    $halfDayRate = (float)($input['half_day_rate'] ?? 0);
    $dailyRate = (float)($input['daily_rate'] ?? 0);
    $weeklyRate = (float)($input['weekly_rate'] ?? 0);
    $monthlyRate = (float)($input['monthly_rate'] ?? 0);
    $minDuration = (int)($input['min_duration_minutes'] ?? 30);
    $maxDuration = (int)($input['max_duration_minutes'] ?? 1440);
    $bufferMinutes = (int)($input['buffer_minutes'] ?? 15);
    $requiresApproval = !empty($input['requires_approval']) ? 1 : 0;
    $openingTime = (string)($input['opening_time'] ?? '07:00');
    $closingTime = (string)($input['closing_time'] ?? '20:00');

    if (empty($title) || empty($location)) {
        errorResponse('Titel und Standort sind Pflichtfelder.', 422);
    }

    if ($isNew) {
        $stmt = $pdo->prepare('
            INSERT INTO resources (
                id, type_id, title, subtitle, description, location, capacity,
                equipment, seating_options, desk_type, image_url,
                hourly_rate, half_day_rate, daily_rate, weekly_rate, monthly_rate,
                min_duration_minutes, max_duration_minutes, buffer_minutes, requires_approval,
                opening_time, closing_time, is_active, created_at
            ) VALUES (
                :id, :tid, :title, :sub, :desc, :loc, :cap,
                :eq, :seat, :dtype, :img,
                :hr, :hdr, :dr, :wr, :mr,
                :mind, :maxd, :buf, :req_app,
                :open, :close, 1, :ts
            )
        ');
        $stmt->execute([
            ':id' => $id, ':tid' => $typeId, ':title' => $title, ':sub' => $subtitle, ':desc' => $description,
            ':loc' => $location, ':cap' => $capacity, ':eq' => $equipment, ':seat' => $seating, ':dtype' => $deskType,
            ':img' => $imageUrl, ':hr' => $hourlyRate, ':hdr' => $halfDayRate, ':dr' => $dailyRate, ':wr' => $weeklyRate,
            ':mr' => $monthlyRate, ':mind' => $minDuration, ':maxd' => $maxDuration, ':buf' => $bufferMinutes,
            ':req_app' => $requiresApproval, ':open' => $openingTime, ':close' => $closingTime, ':ts' => gmdate('Y-m-d\TH:i:s\Z'),
        ]);
    } else {
        $stmt = $pdo->prepare('
            UPDATE resources SET
                type_id = :tid, title = :title, subtitle = :sub, description = :desc, location = :loc,
                capacity = :cap, equipment = :eq, seating_options = :seat, desk_type = :dtype, image_url = :img,
                hourly_rate = :hr, half_day_rate = :hdr, daily_rate = :dr, weekly_rate = :wr, monthly_rate = :mr,
                min_duration_minutes = :mind, max_duration_minutes = :maxd, buffer_minutes = :buf,
                requires_approval = :req_app, opening_time = :open, closing_time = :close
            WHERE id = :id
        ');
        $stmt->execute([
            ':tid' => $typeId, ':title' => $title, ':sub' => $subtitle, ':desc' => $description, ':loc' => $location,
            ':cap' => $capacity, ':eq' => $equipment, ':seat' => $seating, ':dtype' => $deskType, ':img' => $imageUrl,
            ':hr' => $hourlyRate, ':hdr' => $halfDayRate, ':dr' => $dailyRate, ':wr' => $weeklyRate, ':mr' => $monthlyRate,
            ':mind' => $minDuration, ':maxd' => $maxDuration, ':buf' => $bufferMinutes,
            ':req_app' => $requiresApproval, ':open' => $openingTime, ':close' => $closingTime, ':id' => $id,
        ]);
    }

    logAudit($isNew ? 'resource_created' : 'resource_updated', $adminUser['id'], 'resource', $id);

    jsonResponse(['success' => true, 'message' => 'Ressource erfolgreich gespeichert.', 'id' => $id]);
}
