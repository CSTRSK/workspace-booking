<?php
/**
 * cstrsk.de Workspace & Room Booking System - Export API
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * CSV-Export für Excel & RFC-5545 iCalendar (.ics) Dateien
 */

declare(strict_types=1);
require_once __DIR__ . '/db.php';

$pdo = getDb();
$format = $_GET['format'] ?? 'csv';

if ($format === 'ics') {
    handleIcsExport($pdo);
} else {
    handleCsvExport($pdo);
}

function handleCsvExport(PDO $pdo): void {
    $user = requireAdmin();

    $stmt = $pdo->query('
        SELECT b.booking_number, b.start_time, b.end_time, b.status, b.title,
               r.title as resource_title, r.location,
               u.name as user_name, u.email as user_email, u.company,
               b.total_price_net, b.total_price_gross, b.attendees_count, b.check_in_code
        FROM bookings b
        JOIN resources r ON b.resource_id = r.id
        JOIN users u ON b.user_id = u.id
        ORDER BY b.start_time DESC
    ');
    $rows = $stmt->fetchAll();

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="cstrsk_buchungen_' . date('Y-m-d') . '.csv"');

    // UTF-8 BOM für Excel
    echo "\xEF\xBB\xBF";

    $output = fopen('php://output', 'w');

    // Header Zeile (deutsch, Semikolon-getrennt für deutsches Excel)
    fputcsv($output, [
        'Buchungsnummer', 'Ressource', 'Standort', 'Titel', 'Kunde/Nutzer', 'E-Mail',
        'Unternehmen', 'Start (UTC)', 'Ende (UTC)', 'Status', 'Teilnehmer',
        'Netto (EUR)', 'Brutto (EUR)', 'Check-in Code'
    ], ';');

    foreach ($rows as $row) {
        fputcsv($output, [
            $row['booking_number'],
            $row['resource_title'],
            $row['location'],
            $row['title'],
            $row['user_name'],
            $row['user_email'],
            $row['company'] ?? '',
            $row['start_time'],
            $row['end_time'],
            $row['status'],
            $row['attendees_count'],
            number_format((float)$row['total_price_net'], 2, ',', ''),
            number_format((float)$row['total_price_gross'], 2, ',', ''),
            $row['check_in_code'],
        ], ';');
    }

    fclose($output);
    exit;
}

function handleIcsExport(PDO $pdo): void {
    $bookingId = $_GET['booking_id'] ?? '';
    if (empty($bookingId)) {
        errorResponse('booking_id erforderlich.', 400);
    }

    $stmt = $pdo->prepare('
        SELECT b.*, r.title as resource_title, r.location as resource_location
        FROM bookings b
        JOIN resources r ON b.resource_id = r.id
        WHERE b.id = :id
    ');
    $stmt->execute([':id' => $bookingId]);
    $bk = $stmt->fetch();

    if (!$bk) {
        errorResponse('Buchung nicht gefunden.', 404);
    }

    $startUtc = gmdate('Ymd\THis\Z', strtotime($bk['start_time']));
    $endUtc = gmdate('Ymd\THis\Z', strtotime($bk['end_time']));
    $nowUtc = gmdate('Ymd\THis\Z');

    $ics = "BEGIN:VCALENDAR\r\n";
    $ics .= "VERSION:2.0\r\n";
    $ics .= "PRODID:-//cstrsk.de//Workspace Booking System//DE\r\n";
    $ics .= "CALSCALE:GREGORIAN\r\n";
    $ics .= "METHOD:REQUEST\r\n";
    $ics .= "BEGIN:VEVENT\r\n";
    $ics .= "UID:" . $bk['id'] . "@cstrsk.de\r\n";
    $ics .= "DTSTAMP:" . $nowUtc . "\r\n";
    $ics .= "DTSTART:" . $startUtc . "\r\n";
    $ics .= "DTEND:" . $endUtc . "\r\n";
    $ics .= "SUMMARY:" . str_replace("\n", " ", $bk['title'] . ' - ' . $bk['resource_title']) . "\r\n";
    $ics .= "LOCATION:" . str_replace("\n", " ", $bk['resource_location']) . "\r\n";
    $ics .= "DESCRIPTION:Buchung #" . $bk['booking_number'] . " | Check-in Code: " . $bk['check_in_code'] . "\r\n";
    $ics .= "STATUS:CONFIRMED\r\n";
    $ics .= "END:VEVENT\r\n";
    $ics .= "END:VCALENDAR\r\n";

    header('Content-Type: text/calendar; charset=utf-8');
    header('Content-Disposition: attachment; filename="termin_' . $bk['booking_number'] . '.ics"');
    echo $ics;
    exit;
}
