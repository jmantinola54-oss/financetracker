<?php
require_once __DIR__ . '/cors.php';

echo json_encode(['ok' => true, 'time' => date('c')]);
