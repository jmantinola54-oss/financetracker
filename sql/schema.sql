-- Run this in phpMyAdmin (Hostinger hPanel > Databases > phpMyAdmin)
-- on the database you create for this app.

CREATE TABLE IF NOT EXISTS categories (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  type ENUM('income','expense') NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS transactions (
  id CHAR(36) PRIMARY KEY,
  type ENUM('income','expense') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  category_id CHAR(36) NULL,
  txn_date DATE NOT NULL,
  note VARCHAR(255) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  INDEX idx_updated (updated_at),
  INDEX idx_date (txn_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
