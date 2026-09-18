<?php
require_once __DIR__ . '/bootstrap.php';

$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    // Pull records updated since ?since=ISO8601 (or everything if omitted)
    $since = $_GET['since'] ?? null;

    if ($since) {
        $stmt = $pdo->prepare(
            'SELECT id, type, amount, category_id, txn_date, note, created_at, updated_at, deleted
             FROM transactions WHERE updated_at > :since ORDER BY updated_at ASC'
        );
        $stmt->execute(['since' => date('Y-m-d H:i:s', strtotime($since))]);
    } else {
        $stmt = $pdo->query(
            'SELECT id, type, amount, category_id, txn_date, note, created_at, updated_at, deleted
             FROM transactions ORDER BY updated_at ASC'
        );
    }

    echo json_encode($stmt->fetchAll());
    exit;
}

if ($method === 'POST') {
    // Upsert a batch of records pushed from a device
    $body = read_json_body();
    $records = $body['records'] ?? [];

    $sql = 'INSERT INTO transactions (id, type, amount, category_id, txn_date, note, created_at, updated_at, deleted)
            VALUES (:id, :type, :amount, :category_id, :txn_date, :note, :created_at, :updated_at, :deleted)
            ON DUPLICATE KEY UPDATE
              type = IF(VALUES(updated_at) >= updated_at, VALUES(type), type),
              amount = IF(VALUES(updated_at) >= updated_at, VALUES(amount), amount),
              category_id = IF(VALUES(updated_at) >= updated_at, VALUES(category_id), category_id),
              txn_date = IF(VALUES(updated_at) >= updated_at, VALUES(txn_date), txn_date),
              note = IF(VALUES(updated_at) >= updated_at, VALUES(note), note),
              updated_at = IF(VALUES(updated_at) >= updated_at, VALUES(updated_at), updated_at),
              deleted = IF(VALUES(updated_at) >= updated_at, VALUES(deleted), deleted)';
    $stmt = $pdo->prepare($sql);

    $pdo->beginTransaction();
    foreach ($records as $r) {
        $stmt->execute([
            'id' => $r['id'],
            'type' => $r['type'],
            'amount' => $r['amount'],
            'category_id' => $r['category_id'] ?? null,
            'txn_date' => $r['txn_date'],
            'note' => $r['note'] ?? null,
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
