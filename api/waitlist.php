<?php
/**
 * cstrsk.de Workspace & Room Booking System - Waitlist API
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * Warteliste für belegte Slots & Benachrichtigung
 */

declare(strict_types=1);
require_once __DIR__ . '/db.php';

$pdo = getDb();
$user = requireAuth();
$method = $_SERVER['REQUEST_METHOD'];

switch ($method) {
    case 'GET':
        $stmt = $pdo->prepare('
            SELECT w.*, r.title as resource_title, r.location as resource_location
            FROM waitlist w
            JOIN resources r ON w.resource_id = r.id
            WHERE w.user_id = :uid
            ORDER BY w.created_at DESC
        ');
        $stmt->execute([':uid' => $user['id']]);
        jsonResponse(['success' => true, 'waitlist' => $stmt->fetchAll()]);
        break;

    case 'POST':
        $input = getJsonInput();
        $resourceId = (string)($input['resource_id'] ?? '');
        $desiredStart = (string)($input['desired_start'] ?? '');
        $desiredEnd = (string)($input['desired_end'] ?? '');

        if (empty($resourceId) || empty($desiredStart) || empty($desiredEnd)) {
            errorResponse('resource_id, desired_start und desired_end sind erforderlich.', 422);
        }

        // Bereits auf Warteliste?
        $stmtCheck = $pdo->prepare('
            SELECT id FROM waitlist 
            WHERE resource_id = :rid AND user_id = :uid AND status = "waiting"
        ');
        $stmtCheck->execute([':rid' => $resourceId, ':uid' => $user['id']]);
        if ($stmtCheck->fetch()) {
            errorResponse('Sie befinden sich bereits auf der Warteliste für diese Ressource.', 409);
        }

        $id = 'wt-' . bin2hex(random_bytes(6));
        $now = gmdate('Y-m-d\TH:i:s\Z');

        $stmtInsert = $pdo->prepare('
            INSERT INTO waitlist (id, resource_id, user_id, desired_start, desired_end, status, created_at)
            VALUES (:id, :rid, :uid, :start, :end, "waiting", :ts)
        ');
        $stmtInsert->execute([
            ':id' => $id,
            ':rid' => $resourceId,
            ':uid' => $user['id'],
            ':start' => $desiredStart,
            ':end' => $desiredEnd,
            ':ts' => $now,
        ]);

        logAudit('waitlist_joined', $user['id'], 'waitlist', $id);

        jsonResponse([
            'success' => true,
            'message' => 'Sie wurden erfolgreich auf die Warteliste gesetzt! Sie erhalten eine Benachrichtigung, sobald dieser Slot frei wird.',
            'id' => $id,
        ], 201);
        break;

    case 'DELETE':
        $id = (string)($_GET['id'] ?? '');
        if (empty($id)) {
            errorResponse('ID erforderlich.', 400);
        }

        $stmtDel = $pdo->prepare('DELETE FROM waitlist WHERE id = :id AND (user_id = :uid OR :isAdmin = 1)');
        $stmtDel->execute([
            ':id' => $id,
            ':uid' => $user['id'],
            ':isAdmin' => in_array($user['role'], ['admin', 'staff'], true) ? 1 : 0,
        ]);

        jsonResponse(['success' => true, 'message' => 'Eintrag von Warteliste entfernt.']);
        break;

    default:
        errorResponse('Methode nicht erlaubt', 405);
}
