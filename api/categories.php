<?php
require_once __DIR__ . '/bootstrap.php';

$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $since = $_GET['since'] ?? null;

    if ($since) {
        $stmt = $pdo->prepare(
            'SELECT id, name, type, created_at, updated_at, deleted
             FROM categories WHERE user_id = :uid AND updated_at > :since ORDER BY updated_at ASC'
        );
        $stmt->execute(['uid' => $CURRENT_USER_ID, 'since' => date('Y-m-d H:i:s', strtotime($since))]);
    } else {
        $stmt = $pdo->prepare(
            'SELECT id, name, type, created_at, updated_at, deleted
             FROM categories WHERE user_id = :uid ORDER BY updated_at ASC'
        );
        $stmt->execute(['uid' => $CURRENT_USER_ID]);
    }

    echo json_encode($stmt->fetchAll());
    exit;
}

if ($method === 'POST') {
    $body = read_json_body();
    $records = $body['records'] ?? [];

    $ownerCheck = $pdo->prepare('SELECT user_id FROM categories WHERE id = :id');
    $upsert = $pdo->prepare(
        'INSERT INTO categories (id, user_id, name, type, created_at, updated_at, deleted)
         VALUES (:id, :user_id, :name, :type, :created_at, :updated_at, :deleted)
         ON DUPLICATE KEY UPDATE
           name = IF(VALUES(updated_at) >= updated_at, VALUES(name), name),
           type = IF(VALUES(updated_at) >= updated_at, VALUES(type), type),
           updated_at = IF(VALUES(updated_at) >= updated_at, VALUES(updated_at), updated_at),
           deleted = IF(VALUES(updated_at) >= updated_at, VALUES(deleted), deleted)'
    );

    $pdo->beginTransaction();
    $skipped = 0;
    foreach ($records as $r) {
        $ownerCheck->execute(['id' => $r['id']]);
        $existing = $ownerCheck->fetch();
        if ($existing && $existing['user_id'] !== $CURRENT_USER_ID) {
            $skipped++;
            continue;
        }

        $upsert->execute([
            'id' => $r['id'],
            'user_id' => $CURRENT_USER_ID,
            'name' => $r['name'],
            'type' => $r['type'],
            'created_at' => date('Y-m-d H:i:s', strtotime($r['created_at'])),
            'updated_at' => date('Y-m-d H:i:s', strtotime($r['updated_at'])),
            'deleted' => $r['deleted'] ?? 0,
        ]);
    }
    $pdo->commit();

    echo json_encode(['ok' => true, 'count' => count($records) - $skipped, 'skipped' => $skipped]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
