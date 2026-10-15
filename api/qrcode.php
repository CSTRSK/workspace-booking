<?php
declare(strict_types=1);

require_once __DIR__ . '/db.php';

$pdo = getDbConnection();

// Get settings
$stmt = $pdo->query('SELECT "key", "value" FROM system_settings');
$settings = [];
while ($row = $stmt->fetch()) {
    $settings[$row['key']] = $row['value'];
}

$data = (string)($_GET['data'] ?? $_GET['text'] ?? $_GET['code'] ?? 'cstrsk-checkin');
$size = (int)($_GET['size'] ?? 300);
$format = (string)($_GET['format'] ?? 'svg');

// If custom API template is set
$provider = $settings['qr_provider'] ?? 'internal';
$template = $settings['qr_api_url_template'] ?? 'https://api.qrserver.com/v1/create-qr-code/?size={size}x{size}&data={data}';

$targetUrl = str_replace(
    ['{data}', '{code}', '{booking_number}', '{size}'],
    [urlencode($data), urlencode($data), urlencode($data), (string)$size],
    $template
);

// Redirect or proxy the image
header('Location: ' . $targetUrl, true, 302);
exit;
