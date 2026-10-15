<?php
/**
 * cstrsk.de Workspace & Room Booking System - GDPR User API
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * DSGVO Art. 15/20 Datenexport & Art. 17 Recht auf Löschung
 */

declare(strict_types=1);
require_once __DIR__ . '/db.php';

$pdo = getDb();
$user = requireAuth();
$action = $_GET['action'] ?? $_POST['action'] ?? '';

switch ($action) {
    case 'export_data':
        // DSGVO Datenexport
        $stmtBookings = $pdo->prepare('SELECT * FROM bookings WHERE user_id = :uid ORDER BY start_time DESC');
        $stmtBookings->execute([':uid' => $user['id']]);

        $stmtWaitlist = $pdo->prepare('SELECT * FROM waitlist WHERE user_id = :uid');
        $stmtWaitlist->execute([':uid' => $user['id']]);

        $stmtAudit = $pdo->prepare('SELECT * FROM audit_log WHERE user_id = :uid ORDER BY created_at DESC');
        $stmtAudit->execute([':uid' => $user['id']]);

        $exportData = [
            'export_date' => gmdate('Y-m-d\TH:i:s\Z'),
            'legal_basis' => 'DSGVO Art. 15 (Auskunftsrecht) & Art. 20 (Recht auf Datenübertragbarkeit)',
            'user_profile' => $user,
            'bookings' => $stmtBookings->fetchAll(),
            'waitlist' => $stmtWaitlist->fetchAll(),
            'audit_trail' => $stmtAudit->fetchAll(),
        ];

        header('Content-Type: application/json; charset=utf-8');
        header('Content-Disposition: attachment; filename="dsgvo_datenexport_' . $user['id'] . '.json"');
        echo json_encode($exportData, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        exit;

    case 'delete_account':
        // DSGVO Kontolöschung
        $input = getJsonInput();
        $confirmation = !empty($input['confirm_deletion']);
        if (!$confirmation) {
            errorResponse('Bitte bestätigen Sie die endgültige Löschung Ihres Kontos.', 422);
        }

        // Gesetzliche Aufbewahrungspflicht nach HGB/AO für Rechnungsdaten:
        // Benutzerdaten in Buchungen werden anonymisiert, Benutzerkonto wird gelöscht
        $pdo->beginTransaction();
        try {
            $stmtAnon = $pdo->prepare('
                UPDATE bookings 
                SET title = "Anonymisierte Buchung", notes = NULL 
                WHERE user_id = :uid
            ');
            $stmtAnon->execute([':uid' => $user['id']]);

            $stmtDelWait = $pdo->prepare('DELETE FROM waitlist WHERE user_id = :uid');
            $stmtDelWait->execute([':uid' => $user['id']]);

            $stmtDelUser = $pdo->prepare('DELETE FROM users WHERE id = :uid');
            $stmtDelUser->execute([':uid' => $user['id']]);

            $pdo->commit();

            logAudit('user_account_deleted', null, 'user', $user['id']);

            $_SESSION = [];
            session_destroy();

            jsonResponse([
                'success' => true,
                'message' => 'Ihr Konto und alle personenbezogenen Daten wurden DSGVO-konform gelöscht.',
            ]);
        } catch (Exception $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            errorResponse('Fehler bei der Kontolöschung: ' . $e->getMessage(), 500);
        }
        break;

    default:
        errorResponse('Ungültige Aktion.', 400);
}
