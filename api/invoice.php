<?php
/**
 * cstrsk.de Workspace & Room Booking System - Invoice Generation
 * Lizenziert unter GNU AGPLv3 (https://cstrsk.de)
 * Konform nach § 14 UStG (Netto, 19% MwSt, Brutto, Rechnungsnummer, Leistungszeitraum)
 */

declare(strict_types=1);
require_once __DIR__ . '/db.php';

$pdo = getDb();
$bookingId = $_GET['booking_id'] ?? '';

if (empty($bookingId)) {
    die('Buchungs-ID fehlt.');
}

$stmt = $pdo->prepare('
    SELECT b.*, r.title as resource_title, r.location, r.type_id,
           u.name as user_name, u.email as user_email, u.company, u.phone
    FROM bookings b
    JOIN resources r ON b.resource_id = r.id
    JOIN users u ON b.user_id = u.id
    WHERE b.id = :id
');
$stmt->execute([':id' => $bookingId]);
$b = $stmt->fetch();

if (!$b) {
    die('Buchung nicht gefunden.');
}

$invoiceNumber = 'RE-' . substr($b['booking_number'], 4);
$invoiceDate = date('d.m.Y', strtotime($b['created_at']));
$serviceDateStart = date('d.m.Y H:i', strtotime($b['start_time']));
$serviceDateEnd = date('d.m.Y H:i', strtotime($b['end_time']));
$netAmount = number_format((float)$b['total_price_net'], 2, ',', '.');
$taxAmount = number_format((float)($b['total_price_gross'] - $b['total_price_net']), 2, ',', '.');
$grossAmount = number_format((float)$b['total_price_gross'], 2, ',', '.');
?>
<!DOCTYPE html>
<html lang="de">
<head>
    <meta charset="UTF-8">
    <title>Rechnung <?php echo htmlspecialchars($invoiceNumber); ?> - cstrsk.de</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; color: #0D1628; margin: 40px auto; max-width: 800px; line-height: 1.5; font-size: 14px; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0070AD; padding-bottom: 20px; margin-bottom: 30px; }
        .logo-text { font-size: 26px; font-weight: bold; color: #0070AD; }
        .logo-sub { font-size: 13px; color: #6B7280; font-weight: normal; letter-spacing: 1px; }
        .sender-small { font-size: 10px; color: #6B7280; text-decoration: underline; margin-bottom: 8px; }
        .recipient { margin-bottom: 30px; }
        .meta-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 30px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        th { text-align: left; background: #0070AD; color: #fff; padding: 10px; font-weight: 600; font-size: 13px; }
        td { padding: 12px 10px; border-bottom: 1px solid #e2e8f0; }
        .total-row td { font-weight: bold; }
        .grand-total { font-size: 16px; color: #0070AD; border-top: 2px solid #0070AD; }
        .footer { margin-top: 60px; padding-top: 20px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #6B7280; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        .print-btn { background: #0070AD; color: #fff; padding: 8px 16px; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600; margin-bottom: 20px; }
        @media print {
            .print-btn { display: none; }
            body { margin: 0; }
        }
    </style>
</head>
<body>
    <button class="print-btn" onclick="window.print()">Drucken / Als PDF speichern</button>

    <div class="header">
        <div>
            <div class="logo-text">cstrsk.de</div>
            <div class="logo-sub">WORKSPACE SOLUTIONS</div>
        </div>
        <div style="text-align: right; font-size: 12px; color: #4b5563;">
            <strong>cstrsk.de Workspace Solutions</strong><br>
            Digital Hub & Campus<br>
            Web: https://cstrsk.de<br>
            USt-IdNr.: DE 987654321
        </div>
    </div>

    <div class="sender-small">cstrsk.de Workspace Solutions · https://cstrsk.de · Software lizenziert unter GNU AGPLv3</div>
    <div class="recipient">
        <strong><?php echo htmlspecialchars($b['company'] ?: $b['user_name']); ?></strong><br>
        <?php if (!empty($b['company'])): ?>z. H. <?php echo htmlspecialchars($b['user_name']); ?><br><?php endif; ?>
        <?php echo htmlspecialchars($b['user_email']); ?><br>
        <?php if (!empty($b['phone'])): ?>Tel: <?php echo htmlspecialchars($b['phone']); ?><br><?php endif; ?>
    </div>

    <div class="meta-box">
        <div><strong>Rechnungsnummer:</strong><br><?php echo htmlspecialchars($invoiceNumber); ?></div>
        <div><strong>Rechnungsdatum:</strong><br><?php echo htmlspecialchars($invoiceDate); ?></div>
        <div><strong>Buchungsreferenz:</strong><br><?php echo htmlspecialchars($b['booking_number']); ?></div>
    </div>

    <h2 style="font-size: 18px; margin-bottom: 15px; color: #0D1628;">Rechnung zur Buchung</h2>
    <p style="font-size: 13px; color: #4b5563; margin-bottom: 20px;">
        Leistungszeitraum: <strong><?php echo htmlspecialchars($serviceDateStart); ?> Uhr</strong> bis <strong><?php echo htmlspecialchars($serviceDateEnd); ?> Uhr</strong>
    </p>

    <table>
        <thead>
            <tr>
                <th>Pos.</th>
                <th>Bezeichnung & Details</th>
                <th style="text-align: center;">Menge</th>
                <th style="text-align: right;">Netto</th>
                <th style="text-align: right;">Gesamt Netto</th>
            </tr>
        </thead>
        <tbody>
            <tr>
                <td>1</td>
                <td>
                    <strong><?php echo htmlspecialchars($b['resource_title']); ?></strong><br>
                    <span style="font-size: 12px; color: #6b7280;">Standort: <?php echo htmlspecialchars($b['location']); ?> | Zweck: <?php echo htmlspecialchars($b['title']); ?></span>
                </td>
                <td style="text-align: center;">1</td>
                <td style="text-align: right;"><?php echo $netAmount; ?> €</td>
                <td style="text-align: right;"><?php echo $netAmount; ?> €</td>
            </tr>
            <tr class="total-row">
                <td colspan="4" style="text-align: right;">Nettobetrag:</td>
                <td style="text-align: right;"><?php echo $netAmount; ?> €</td>
            </tr>
            <tr class="total-row">
                <td colspan="4" style="text-align: right;">zzgl. 19 % MwSt.:</td>
                <td style="text-align: right;"><?php echo $taxAmount; ?> €</td>
            </tr>
            <tr class="total-row grand-total">
                <td colspan="4" style="text-align: right;">Rechnungsbetrag Gesamt:</td>
                <td style="text-align: right;"><?php echo $grossAmount; ?> €</td>
            </tr>
        </tbody>
    </table>

    <div style="background: #f1f5f9; padding: 12px 15px; border-radius: 6px; font-size: 12px; margin-bottom: 30px;">
        Zahlungsstatus: <strong>Vollständig beglichen (Kostenstelle / Guthaben / Rechnung)</strong>.<br>
        Vielen Dank für Ihre Buchung bei cstrsk.de Workspace!
    </div>

    <div class="footer">
        <div>
            <strong>cstrsk.de Workspace Solutions</strong><br>
            Plattform-Entwicklung & Betrieb<br>
            Lizenz: GNU AGPLv3 (Copyleft)
        </div>
        <div>
            <strong>Bankverbindung</strong><br>
            GLS Gemeinschaftsbank<br>
            IBAN: DE89 4306 0967 0123 4567 89<br>
            BIC: GENODEM1GLS
        </div>
        <div>
            <strong>Kontakt & Web</strong><br>
            E-Mail: workspace@cstrsk.de<br>
            Web: https://cstrsk.de<br>
            Open Source unter GNU AGPLv3
        </div>
    </div>
</body>
</html>
