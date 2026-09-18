<?php
require_once __DIR__ . '/bootstrap.php';

$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $since = $_GET['since'] ?? null;

    if ($since) {
        $stmt = $pdo->prepare(
            'SELECT id, name, type, created_at, updated_at, deleted
             FROM categories WHERE updated_at > :since ORDER BY updated_at ASC'
        );
        $stmt->execute(['since' => date('Y-m-d H:i:s', strtotime($since))]);
    } else {
        $stmt = $pdo->query(
            'SELECT id, name, type, created_at, updated_at, deleted
             FROM categories ORDER BY updated_at ASC'
        );
    }

    echo json_encode($stmt->fetchAll());
    exit;
}

if ($method === 'POST') {
    $body = read_json_body();
    $records = $body['records'] ?? [];

    $sql = 'INSERT INTO categories (id, name, type, created_at, updated_at, deleted)
            VALUES (:id, :name, :type, :created_at, :updated_at, :deleted)
            ON DUPLICATE KEY UPDATE
              name = IF(VALUES(updated_at) >= updated_at, VALUES(name), name),
              type = IF(VALUES(updated_at) >= updated_at, VALUES(type), type),
              updated_at = IF(VALUES(updated_at) >= updated_at, VALUES(updated_at), updated_at),
              deleted = IF(VALUES(updated_at) >= updated_at, VALUES(deleted), deleted)';
    $stmt = $pdo->prepare($sql);

    $pdo->beginTransaction();
    foreach ($records as $r) {
        $stmt->execute([
            'id' => $r['id'],
            'name' => $r['name'],
            'type' => $r['type'],
            'created_at' => date('Y-m-d H:i:s', strtotime($r['created_at'])),
            'updated_at' => date('Y-m-d H:i:s', strtotime($r['updated_at'])),
            'deleted' => $r['deleted'] ?? 0,
        ]);
    }
    $pdo->commit();

    echo json_encode(['ok' => true, 'count' => count($records)]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
