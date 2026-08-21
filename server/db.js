const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

function createDatabase(filename = process.env.DB_FILE || path.join(__dirname, '..', 'store.db')) {
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
      image_url TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'General',
      inventory INTEGER NOT NULL DEFAULT 0 CHECK(inventory >= 0),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      order_number TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      address TEXT NOT NULL,
      city TEXT NOT NULL,
      region TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country TEXT NOT NULL,
      subtotal_cents INTEGER NOT NULL,
      payment_currency TEXT NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'awaiting_payment',
      gateway_payment_id TEXT,
      pay_address TEXT,
      pay_amount TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price_cents INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL
    );
  `);

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD;
  if (!db.prepare('SELECT 1 FROM admin_users LIMIT 1').get()) {
    if (!password) throw new Error('ADMIN_PASSWORD is required on first start');
    db.prepare('INSERT INTO admin_users (id, username, password_hash) VALUES (?, ?, ?)')
      .run(crypto.randomUUID(), username, bcrypt.hashSync(password, 12));
  }
  return db;
}

module.exports = { createDatabase };
