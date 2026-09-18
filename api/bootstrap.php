<?php
// bootstrap.php — required by every endpoint that needs a logged-in user
// (transactions.php, categories.php). Resolves the Authorization: Bearer
// token to a user, and makes that user's id available as $CURRENT_USER_ID.

require_once __DIR__ . '/cors.php';

function get_bearer_token(): string {
    // Some shared-hosting setups (Hostinger's LiteSpeed/PHP-FPM included)
    // don't reliably surface custom/Authorization headers through
    // getallheaders(), so we check every place it could show up.
    $auth = '';

    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strtolower($name) === 'authorization') { $auth = $value; break; }
        }
    }
    if (!$auth && !empty($_SERVER['HTTP_AUTHORIZATION'])) {
        $auth = $_SERVER['HTTP_AUTHORIZATION'];
    }
    if (!$auth && !empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        $auth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    if (!$auth && function_exists('apache_request_headers')) {
        foreach (apache_request_headers() as $name => $value) {
            if (strtolower($name) === 'authorization') { $auth = $value; break; }
        }
    }

    if (preg_match('/Bearer\s+(\S+)/i', $auth, $m)) {
        return $m[1];
    }
    return '';
}

$token = get_bearer_token();
if (!$token) {
    http_response_code(401);
    echo json_encode(['error' => 'Not signed in']);
    exit;
}

$pdo = get_db();
$stmt = $pdo->prepare('SELECT user_id FROM device_tokens WHERE token = :token');
$stmt->execute(['token' => $token]);
$row = $stmt->fetch();

if (!$row) {
    http_response_code(401);
    echo json_encode(['error' => 'Session expired, please sign in again']);
    exit;
}

$CURRENT_USER_ID = $row['user_id'];
