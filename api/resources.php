<?php
/**
 * cstrsk.de Workspace & Room Booking System - Resources API
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * Filterung nach Datum, Zeitfenster, Typ, Kapazität, Ausstattung & Live-Verfügbarkeit
 */

declare(strict_types=1);
require_once __DIR__ . '/db.php';

$pdo = getDb();
$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method === 'GET') {
    if ($action === 'check_slot') {
        handleCheckSlot($pdo);
    } elseif (!empty($_GET['id'])) {
        handleGetSingle($pdo, (string)$_GET['id']);
    } else {
        handleList($pdo);
    }
} else {
    errorResponse('Methode nicht erlaubt', 405);
}

function handleList(PDO $pdo): void {
    $typeId = $_GET['type_id'] ?? null;
    $capacityMin = !empty($_GET['capacity']) ? (int)$_GET['capacity'] : 0;
    $deskType = $_GET['desk_type'] ?? null;
    $equipmentFilter = !empty($_GET['equipment']) ? explode(',', (string)$_GET['equipment']) : [];
    
    // Zeitfenster-Filterung falls angegeben
    $date = $_GET['date'] ?? null;
    $startUtc = $_GET['start_utc'] ?? null;
    $endUtc = $_GET['end_utc'] ?? null;

    $sql = 'SELECT r.*, rt.name as type_name, rt.icon as type_icon 
            FROM resources r
            JOIN resource_types rt ON r.type_id = rt.id
            WHERE r.is_active = 1';
    $params = [];

    if ($typeId) {
        $sql .= ' AND r.type_id = :type_id';
        $params[':type_id'] = $typeId;
    }

    if ($capacityMin > 0) {
        $sql .= ' AND r.capacity >= :capacity';
        $params[':capacity'] = $capacityMin;
    }

    if ($deskType) {
        $sql .= ' AND r.desk_type = :desk_type';
        $params[':desk_type'] = $deskType;
    }

    $sql .= ' ORDER BY r.type_id ASC, r.capacity DESC, r.title ASC';

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $results = [];
    foreach ($rows as $row) {
        $row['equipment'] = json_decode($row['equipment'] ?: '[]', true);
        $row['seating_options'] = json_decode($row['seating_options'] ?: '[]', true);

        // Ausstattungsfilter anwenden
        if (!empty($equipmentFilter)) {
            $hasAllEquipment = true;
            foreach ($equipmentFilter as $eq) {
                $eq = trim($eq);
                if (!empty($eq) && !in_array($eq, $row['equipment'], true)) {
                    $hasAllEquipment = false;
                    break;
                }
            }
            if (!$hasAllEquipment) {
                continue;
            }
        }

        // Falls Start- und Endzeit angegeben wurden, prüfe Verfügbarkeit
        if ($startUtc && $endUtc) {
            $conflict = checkConflict($pdo, $row['id'], $startUtc, $endUtc, (int)$row['buffer_minutes']);
            $row['is_available'] = !$conflict['has_conflict'];
            $row['conflict_reason'] = $conflict['reason'] ?? null;
        } else {
            $row['is_available'] = true;
        }

        $results[] = $row;
    }

    jsonResponse([
        'success' => true,
        'count' => count($results),
        'resources' => $results,
    ]);
}

function handleGetSingle(PDO $pdo, string $id): void {
    $stmt = $pdo->prepare('
        SELECT r.*, rt.name as type_name, rt.icon as type_icon 
        FROM resources r
        JOIN resource_types rt ON r.type_id = rt.id
        WHERE r.id = :id AND r.is_active = 1
    ');
    $stmt->execute([':id' => $id]);
    $resource = $stmt->fetch();

    if (!$resource) {
        errorResponse('Ressource nicht gefunden.', 404);
    }

    $resource['equipment'] = json_decode($resource['equipment'] ?: '[]', true);
    $resource['seating_options'] = json_decode($resource['seating_options'] ?: '[]', true);

    // Belegungen für den heutigen bzw. gewählten Tag abrufen
    $date = $_GET['date'] ?? gmdate('Y-m-d');
    $dayStart = $date . 'T00:00:00Z';
    $dayEnd = $date . 'T23:59:59Z';

    $stmtBookings = $pdo->prepare('
        SELECT id, start_time, end_time, status, title
        FROM bookings
        WHERE resource_id = :id 
          AND status IN ("confirmed", "pending_approval", "checked_in")
          AND start_time <= :dayEnd AND end_time >= :dayStart
        ORDER BY start_time ASC
    ');
    $stmtBookings->execute([
        ':id' => $id,
        ':dayStart' => $dayStart,
        ':dayEnd' => $dayEnd,
    ]);
    $resource['day_bookings'] = $stmtBookings->fetchAll();

    jsonResponse([
        'success' => true,
        'resource' => $resource,
    ]);
}

function handleCheckSlot(PDO $pdo): void {
    $resourceId = (string)($_GET['resource_id'] ?? '');
    $startUtc = (string)($_GET['start_utc'] ?? '');
    $endUtc = (string)($_GET['end_utc'] ?? '');
    $excludeBookingId = $_GET['exclude_id'] ?? null;

    if (empty($resourceId) || empty($startUtc) || empty($endUtc)) {
        errorResponse('resource_id, start_utc und end_utc sind erforderlich.', 422);
    }

    $stmt = $pdo->prepare('SELECT buffer_minutes FROM resources WHERE id = :id');
    $stmt->execute([':id' => $resourceId]);
    $res = $stmt->fetch();
    $buffer = $res ? (int)$res['buffer_minutes'] : 15;

    $conflict = checkConflict($pdo, $resourceId, $startUtc, $endUtc, $buffer, $excludeBookingId);

    jsonResponse([
        'success' => true,
        'available' => !$conflict['has_conflict'],
        'has_conflict' => $conflict['has_conflict'],
        'reason' => $conflict['reason'] ?? null,
    ]);
}

/**
 * Konfliktprüfung mit Pufferzeit und Sperrzeiten
 */
function checkConflict(PDO $pdo, string $resourceId, string $startUtc, string $endUtc, int $bufferMinutes = 15, ?string $excludeId = null): array {
    // 1. Pufferzeit berechnen
    $startTimestamp = strtotime($startUtc);
    $endTimestamp = strtotime($endUtc);

    if ($endTimestamp <= $startTimestamp) {
        return ['has_conflict' => true, 'reason' => 'Endzeitpunkt muss nach Startzeitpunkt liegen.'];
    }

    // Pufferzeit einbeziehen
    $bufferedStart = gmdate('Y-m-d\TH:i:s\Z', $startTimestamp - ($bufferMinutes * 60));
    $bufferedEnd = gmdate('Y-m-d\TH:i:s\Z', $endTimestamp + ($bufferMinutes * 60));

    // 2. Prüfe bestehende Buchungen
    $sql = 'SELECT id, start_time, end_time, title FROM bookings 
            WHERE resource_id = :rid 
              AND status IN ("confirmed", "pending_approval", "checked_in")
              AND start_time < :bufEnd 
              AND end_time > :bufStart';
    $params = [
        ':rid' => $resourceId,
        ':bufEnd' => $bufferedEnd,
        ':bufStart' => $bufferedStart,
    ];

    if ($excludeId) {
        $sql .= ' AND id != :excludeId';
        $params[':excludeId'] = $excludeId;
    }

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $existing = $stmt->fetch();

    if ($existing) {
        return [
            'has_conflict' => true,
            'reason' => 'Zeitfenster überschneidet sich mit bestehender Buchung (inkl. ' . $bufferMinutes . ' Min. Pufferzeit).',
            'conflict_with' => $existing['id'],
        ];
    }

    // 3. Prüfe Sperrzeiten (Blocks/Wartung/Feiertage)
    $stmtBlock = $pdo->prepare('
        SELECT reason FROM blocks 
        WHERE (resource_id = :rid OR resource_id IS NULL)
          AND start_time < :end 
          AND end_time > :start
    ');
    $stmtBlock->execute([
        ':rid' => $resourceId,
        ':start' => $startUtc,
        ':end' => $endUtc,
    ]);
    $block = $stmtBlock->fetch();

    if ($block) {
        return [
            'has_conflict' => true,
            'reason' => 'Gesperrter Zeitraum: ' . $block['reason'],
        ];
    }

    return ['has_conflict' => false];
}
