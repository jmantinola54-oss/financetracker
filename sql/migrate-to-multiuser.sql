-- Run this INSTEAD of schema.sql if you already have data in your
-- transactions/categories tables from before (your test entries).
-- It keeps everything and assigns it to a new "owner" account.
--
-- Run these statements one block at a time in phpMyAdmin's SQL tab.

-- 1. New tables
CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE,
  pin_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS device_tokens (
  token CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. A placeholder account to own your existing test data.
--    PIN is "0000" — log into the app with this name/PIN once, then
--    change it, or just delete this account and its data later if it
--    was only test entries.
INSERT INTO users (id, name, pin_hash, created_at)
VALUES (
  'a0000000-0000-4000-8000-000000000001',
  'owner',
  -- bcrypt hash of "0000" — change this PIN inside the app after logging in once
  '$2b$10$fcsEHjQv.6WbrNAC6yXBZ.8J1DP0zFFZnmvmDWvxmMhBqepyN/onO',
  NOW()
);

-- 3. Add ownership columns to the existing tables
ALTER TABLE transactions ADD COLUMN user_id CHAR(36) NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000001' AFTER id;
ALTER TABLE categories ADD COLUMN user_id CHAR(36) NOT NULL DEFAULT 'a0000000-0000-4000-8000-000000000001' AFTER id;

ALTER TABLE transactions ADD INDEX idx_user_updated (user_id, updated_at);
ALTER TABLE transactions ADD INDEX idx_user_date (user_id, txn_date);
ALTER TABLE categories ADD INDEX idx_user_updated (user_id, updated_at);

ALTER TABLE transactions ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE categories ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
