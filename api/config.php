<?php
// ============================================================
// Fill these in with the values from Hostinger hPanel > Databases.
// ============================================================

// Usually 'localhost' on Hostinger shared hosting
define('DB_HOST', 'localhost');

// e.g. u123456789_ledger
define('DB_NAME', 'your_db_name_here');

// e.g. u123456789_ledger_user
define('DB_USER', 'your_db_user_here');

define('DB_PASS', 'your_db_password_here');

// A long random secret only your app knows. Generate one at
// https://www.uuidgenerator.net/ or run: php -r "echo bin2hex(random_bytes(24));"
// This must match the "API key" you enter in the app's Settings screen.
define('API_KEY', 'change-this-to-a-long-random-secret');

// The origin(s) allowed to call this API. Set this to your GitHub Pages
// URL, e.g. 'https://yourusername.github.io'. Use '*' only while testing.
define('ALLOWED_ORIGIN', '*');
