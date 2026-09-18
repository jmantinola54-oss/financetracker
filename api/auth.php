<?php
require_once __DIR__ . '/cors.php';

$pdo = get_db();
$body = read_json_body();
$action = $body['action'] ?? '';
$name = trim($body['name'] ?? '');
$pin = trim($body['pin'] ?? '');

function issue_token(PDO $pdo, string $userId): string {
    $token = bin2hex(random_bytes(32));
    $stmt = $pdo->prepare('INSERT INTO device_tokens (token, user_id, created_at) VALUES (:token, :user_id, :created_at)');
    $stmt->execute([
        'token' => $token,
        'user_id' => $userId,
        'created_at' => date('Y-m-d H:i:s'),
    ]);
    return $token;
}

function uuid(): string {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

if ($name === '' || $pin === '') {
    http_response_code(400);
    echo json_encode(['error' => 'Name and PIN are required']);
    exit;
}
if (strlen($pin) < 4) {
    http_response_code(400);
    echo json_encode(['error' => 'PIN must be at least 4 digits']);
    exit;
}

if ($action === 'register') {
    $check = $pdo->prepare('SELECT id FROM users WHERE name = :name');
    $check->execute(['name' => $name]);
    if ($check->fetch()) {
        http_response_code(409);
        echo json_encode(['error' => 'That name is already taken. Try logging in instead, or pick another name.']);
        exit;
    }

    $userId = uuid();
    $stmt = $pdo->prepare('INSERT INTO users (id, name, pin_hash, created_at) VALUES (:id, :name, :pin_hash, :created_at)');
    $stmt->execute([
        'id' => $userId,
        'name' => $name,
        'pin_hash' => password_hash($pin, PASSWORD_DEFAULT),
        'created_at' => date('Y-m-d H:i:s'),
    ]);

    $token = issue_token($pdo, $userId);
    echo json_encode(['token' => $token, 'user_id' => $userId, 'name' => $name]);
    exit;
}

if ($action === 'login') {
    $stmt = $pdo->prepare('SELECT id, pin_hash FROM users WHERE name = :name');
    $stmt->execute(['name' => $name]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($pin, $user['pin_hash'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Name or PIN is incorrect']);
        exit;
    }

    $token = issue_token($pdo, $user['id']);
    echo json_encode(['token' => $token, 'user_id' => $user['id'], 'name' => $name]);
    exit;
}

http_response_code(400);
echo json_encode(['error' => 'action must be "register" or "login"']);
