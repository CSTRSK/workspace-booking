<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

$pdo = getDbConnection();

$stmt = $pdo->query('SELECT "key", "value" FROM system_settings');
$settings = [];
while ($row = $stmt->fetch()) {
    $settings[$row['key']] = $row['value'];
}

jsonResponse([
    'success' => true,
    'settings' => [
        'allow_guest_booking' => $settings['allow_guest_booking'] ?? '1',
        'advance_booking_days_max' => $settings['advance_booking_days_max'] ?? '60',
        'min_lead_time_hours' => $settings['min_lead_time_hours'] ?? '1',
        'cancellation_cutoff_hours' => $settings['cancellation_cutoff_hours'] ?? '2',
        'company_name' => $settings['company_name'] ?? 'cstrsk.de Workspace Solutions',
        'qr_provider' => $settings['qr_provider'] ?? 'internal',
        'qr_api_url_template' => $settings['qr_api_url_template'] ?? 'https://api.qrserver.com/v1/create-qr-code/?size={size}x{size}&data={data}',
        'qr_api_auth_header' => $settings['qr_api_auth_header'] ?? '',
        'qr_content_format' => $settings['qr_content_format'] ?? 'url'
    ]
]);
