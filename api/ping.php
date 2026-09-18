<?php
require_once __DIR__ . '/bootstrap.php';

echo json_encode(['ok' => true, 'time' => date('c')]);
