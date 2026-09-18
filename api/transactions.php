<?php
require_once __DIR__ . '/bootstrap.php';
// $CURRENT_USER_ID is set by bootstrap.php from the caller's token.

$pdo = get_db();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $since = $_GET['since'] ?? null;

    if ($since) {
        $stmt = $pdo->prepare(
            'SELECT id, type, amount, category_id, txn_date, note, created_at, updated_at, deleted
             FROM transactions WHERE user_id = :uid AND updated_at > :since ORDER BY updated_at ASC'
        );
        $stmt->execute(['uid' => $CURRENT_USER_ID, 'since' => date('Y-m-d H:i:s', strtotime($since))]);
    } else {
        $stmt = $pdo->prepare(
            'SELECT id, type, amount, category_id, txn_date, note, created_at, updated_at, deleted
             FROM transactions WHERE user_id = :uid ORDER BY updated_at ASC'
        );
        $stmt->execute(['uid' => $CURRENT_USER_ID]);
    }

    echo json_encode($stmt->fetchAll());
    exit;
}

if ($method === 'POST') {
    $body = read_json_body();
    $records = $body['records'] ?? [];

    // Only ever write rows owned by the caller. If an id already belongs
    // to someone else, skip it rather than letting one user overwrite
    // another user's entry.
    $ownerCheck = $pdo->prepare('SELECT user_id FROM transactions WHERE id = :id');
    $upsert = $pdo->prepare(
        'INSERT INTO transactions (id, user_id, type, amount, category_id, txn_date, note, created_at, updated_at, deleted)
         VALUES (:id, :user_id, :type, :amount, :category_id, :txn_date, :note, :created_at, :updated_at, :deleted)
         ON DUPLICATE KEY UPDATE
           type = IF(VALUES(updated_at) >= updated_at, VALUES(type), type),
           amount = IF(VALUES(updated_at) >= updated_at, VALUES(amount), amount),
           category_id = IF(VALUES(updated_at) >= updated_at, VALUES(category_id), category_id),
           txn_date = IF(VALUES(updated_at) >= updated_at, VALUES(txn_date), txn_date),
           note = IF(VALUES(updated_at) >= updated_at, VALUES(note), note),
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

    echo json_encode(['ok' => true, 'count' => count($records) - $skipped, 'skipped' => $skipped]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'Method not allowed']);
