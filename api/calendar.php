<?php
/**
 * cstrsk.de Workspace & Room Booking System - Calendar Grid API
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * Raumplan-Raster: Ressourcen als Zeilen, Uhrzeiten als Spalten
 */

declare(strict_types=1);
require_once __DIR__ . '/db.php';

$pdo = getDb();
$user = getCurrentUser();
$currentUserId = $user ? $user['id'] : null;

$date = $_GET['date'] ?? date('Y-m-d');
$typeId = $_GET['type_id'] ?? null;

// Stunden-Spalten definieren (07:00 bis 20:00)
$hours = [];
for ($h = 7; $h <= 20; $h++) {
    $hours[] = sprintf('%02d:00', $h);
}

// 1. Ressourcen laden
$sqlRes = 'SELECT r.id, r.title, r.subtitle, r.type_id, r.location, r.capacity, r.requires_approval, rt.name as type_name
           FROM resources r
           JOIN resource_types rt ON r.type_id = rt.id
           WHERE r.is_active = 1';
$resParams = [];
if ($typeId) {
    $sqlRes .= ' AND r.type_id = :type_id';
    $resParams[':type_id'] = $typeId;
}
$sqlRes .= ' ORDER BY r.type_id ASC, r.title ASC';

$stmtRes = $pdo->prepare($sqlRes);
$stmtRes->execute($resParams);
$resources = $stmtRes->fetchAll();

// 2. Buchungen für das gewählte Datum laden
$dayStart = $date . 'T00:00:00Z';
$dayEnd = $date . 'T23:59:59Z';

$stmtBk = $pdo->prepare('
    SELECT b.id, b.resource_id, b.user_id, b.start_time, b.end_time, b.status, b.title, u.name as user_name
    FROM bookings b
    JOIN users u ON b.user_id = u.id
    WHERE b.status IN ("confirmed", "pending_approval", "checked_in")
      AND b.start_time <= :dayEnd AND b.end_time >= :dayStart
');
$stmtBk->execute([':dayStart' => $dayEnd, ':dayEnd' => $dayStart]);
$bookings = $stmtBk->fetchAll();

// 3. Sperrzeiten (Blocks) für das Datum laden
$stmtBlk = $pdo->prepare('
    SELECT id, resource_id, start_time, end_time, reason 
    FROM blocks 
    WHERE start_time <= :dayEnd AND end_time >= :dayStart
');
$stmtBlk->execute([':dayStart' => $dayEnd, ':dayEnd' => $dayStart]);
$blocks = $stmtBlk->fetchAll();

// 4. Matrix aufbauen
$grid = [];
foreach ($resources as $res) {
    $rowSlots = [];
    $rid = $res['id'];

    foreach ($hours as $timeStr) {
        $slotStartIso = $date . 'T' . $timeStr . ':00Z';
        $slotNextHour = date('H:i', strtotime($timeStr) + 3600);
        $slotEndIso = $date . 'T' . $slotNextHour . ':00Z';

        $slotState = 'free'; // Status-Farben: frei=Grün, belegt=Grau, eigene Buchung=Brand Blau, Genehmigung=Magenta
        $bookingDetails = null;

        // Prüfe Sperrzeit
        foreach ($blocks as $blk) {
            if ($blk['resource_id'] === null || $blk['resource_id'] === $rid) {
                if ($blk['start_time'] < $slotEndIso && $blk['end_time'] > $slotStartIso) {
                    $slotState = 'blocked';
                    $bookingDetails = ['title' => 'Gesperrt: ' . $blk['reason']];
                    break;
                }
            }
        }

        // Prüfe Buchung
        if ($slotState === 'free') {
            foreach ($bookings as $bk) {
                if ($bk['resource_id'] === $rid) {
                    if ($bk['start_time'] < $slotEndIso && $bk['end_time'] > $slotStartIso) {
                        if ($bk['status'] === 'pending_approval') {
                            $slotState = 'pending_approval'; // Magenta
                        } elseif ($currentUserId && $bk['user_id'] === $currentUserId) {
                            $slotState = 'own_booking';      // Brand Blau
                        } else {
                            $slotState = 'busy';             // Grau
                        }
                        $bookingDetails = [
                            'id' => $bk['id'],
                            'title' => $bk['title'],
                            'user_name' => $bk['user_name'],
                            'start' => substr($bk['start_time'], 11, 5),
                            'end' => substr($bk['end_time'], 11, 5),
                        ];
                        break;
                    }
                }
            }
        }

        $rowSlots[] = [
            'time' => $timeStr,
            'state' => $slotState,
            'details' => $bookingDetails,
        ];
    }

    $grid[] = [
        'resource' => $res,
        'slots' => $rowSlots,
    ];
}

jsonResponse([
    'success' => true,
    'date' => $date,
    'hours' => $hours,
    'grid' => $grid,
]);
