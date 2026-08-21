require('dotenv').config();

const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { createDatabase } = require('./db');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const COINS = new Set(['btc', 'eth', 'usdc', 'usdt']);

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function slugify(value) {
  return clean(value, 120).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function orderNumber() {
  return `CM-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObjectKeys(value[key]);
    return result;
  }, {});
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'Admin sign-in required' });
  next();
}

function createApp({ db = createDatabase(), fetchImpl = fetch } = {}) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '100kb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(session({
    secret: process.env.SESSION_SECRET || 'development-only-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000 }
  }));
  app.use('/api/', rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/products', (_req, res) => {
    res.json(db.prepare('SELECT id, name, slug, description, price_cents, image_url, category, inventory FROM products WHERE active = 1 ORDER BY category, name').all());
  });

  app.post('/api/admin/login', (req, res) => {
    const user = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(clean(req.body.username, 80));
    if (!user || !bcrypt.compareSync(String(req.body.password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    req.session.adminId = user.id;
    res.json({ ok: true, username: user.username });
  });
  app.post('/api/admin/logout', requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
  app.get('/api/admin/session', (req, res) => res.json({ authenticated: Boolean(req.session.adminId) }));
  app.get('/api/admin/products', requireAdmin, (_req, res) => res.json(db.prepare('SELECT * FROM products ORDER BY created_at DESC').all()));
  app.post('/api/admin/products', requireAdmin, (req, res) => {
    const name = clean(req.body.name, 120);
    const slug = slugify(req.body.slug || name);
    const priceCents = Math.round(Number(req.body.price) * 100);
    const inventory = Math.floor(Number(req.body.inventory));
    if (!name || !slug || !Number.isInteger(priceCents) || priceCents < 0 || !Number.isInteger(inventory) || inventory < 0) {
      return res.status(400).json({ error: 'Name, valid price, and valid inventory are required' });
    }
    const product = {
      id: crypto.randomUUID(), name, slug, description: clean(req.body.description, 1000), priceCents,
      imageUrl: clean(req.body.imageUrl, 500), category: clean(req.body.category, 80) || 'General', inventory
    };
    try {
      db.prepare(`INSERT INTO products (id,name,slug,description,price_cents,image_url,category,inventory)
        VALUES (@id,@name,@slug,@description,@priceCents,@imageUrl,@category,@inventory)`).run(product);
      res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(product.id));
    } catch (error) {
      res.status(409).json({ error: error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Slug already exists' : 'Product could not be created' });
    }
  });
  app.patch('/api/admin/products/:id', requireAdmin, (req, res) => {
    const current = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!current) return res.status(404).json({ error: 'Product not found' });
    const active = req.body.active == null ? current.active : (req.body.active ? 1 : 0);
    const inventory = req.body.inventory == null ? current.inventory : Math.max(0, Math.floor(Number(req.body.inventory) || 0));
    db.prepare('UPDATE products SET active = ?, inventory = ? WHERE id = ?').run(active, inventory, current.id);
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(current.id));
  });
  app.get('/api/admin/orders', requireAdmin, (_req, res) => {
    res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all());
  });

  app.post('/api/orders', async (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const email = clean(req.body.email, 180).toLowerCase();
    const coin = clean(req.body.paymentCurrency, 12).toLowerCase();
    const required = ['customerName', 'address', 'city', 'region', 'postalCode', 'country'];
    if (!/^\S+@\S+\.\S+$/.test(email) || !COINS.has(coin) || !items.length || required.some(key => !clean(req.body[key]))) {
      return res.status(400).json({ error: 'Complete the checkout form and choose a supported currency' });
    }

    const lines = [];
    let subtotalCents = 0;
    for (const item of items.slice(0, 50)) {
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(clean(item.productId, 80));
      const quantity = Math.floor(Number(item.quantity));
      if (!product || !Number.isInteger(quantity) || quantity < 1 || quantity > product.inventory) {
        return res.status(409).json({ error: 'A cart item is unavailable or exceeds inventory' });
      }
      lines.push({ product, quantity });
      subtotalCents += product.price_cents * quantity;
    }

    const id = crypto.randomUUID();
    const number = orderNumber();
    const fields = {
      id, number, email, customerName: clean(req.body.customerName, 160), address: clean(req.body.address),
      city: clean(req.body.city, 100), region: clean(req.body.region, 100), postalCode: clean(req.body.postalCode, 30),
      country: clean(req.body.country, 80), subtotalCents, coin
    };
    const insert = db.transaction(() => {
      db.prepare(`INSERT INTO orders (id,order_number,email,customer_name,address,city,region,postal_code,country,subtotal_cents,payment_currency)
        VALUES (@id,@number,@email,@customerName,@address,@city,@region,@postalCode,@country,@subtotalCents,@coin)`).run(fields);
      const stmt = db.prepare('INSERT INTO order_items (id,order_id,product_id,product_name,quantity,unit_price_cents) VALUES (?,?,?,?,?,?)');
      for (const line of lines) stmt.run(crypto.randomUUID(), id, line.product.id, line.product.name, line.quantity, line.product.price_cents);
    });
    insert();

    let invoice;
    const apiKey = process.env.NOWPAYMENTS_API_KEY;
    if (apiKey) {
      try {
        const response = await fetchImpl('https://api.nowpayments.io/v1/payment', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            price_amount: (subtotalCents / 100).toFixed(2), price_currency: 'usd', pay_currency: coin,
            order_id: number, order_description: `Marketplace order ${number}`,
            ipn_callback_url: `${String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/api/payments/ipn`
          })
        });
        if (!response.ok) throw new Error(`Gateway returned ${response.status}`);
        const data = await response.json();
        invoice = { paymentId: String(data.payment_id), payAddress: data.pay_address, payAmount: String(data.pay_amount), demo: false };
      } catch (error) {
        db.prepare("UPDATE orders SET payment_status = 'invoice_error' WHERE id = ?").run(id);
        return res.status(502).json({ error: 'The payment gateway did not create an invoice' });
      }
    } else {
      invoice = { paymentId: `demo_${crypto.randomBytes(6).toString('hex')}`, payAddress: `demo-${coin}-address`, payAmount: (subtotalCents / 100).toFixed(2), demo: true };
    }
    db.prepare('UPDATE orders SET gateway_payment_id = ?, pay_address = ?, pay_amount = ? WHERE id = ?')
      .run(invoice.paymentId, invoice.payAddress, invoice.payAmount, id);
    res.status(201).json({ orderNumber: number, subtotal: subtotalCents / 100, paymentCurrency: coin, ...invoice });
  });

  app.get('/api/orders/:number/status', (req, res) => {
    const order = db.prepare('SELECT order_number, subtotal_cents, payment_currency, payment_status, pay_address, pay_amount, created_at FROM orders WHERE order_number = ?').get(req.params.number);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  });

  app.post('/api/payments/ipn', (req, res) => {
    const secret = process.env.NOWPAYMENTS_IPN_SECRET;
    if (!secret) return res.status(503).json({ error: 'IPN is not configured' });
    const signature = String(req.get('x-nowpayments-sig') || '');
    const canonical = JSON.stringify(sortObjectKeys(req.body || {}));
    const expected = crypto.createHmac('sha512', secret).update(canonical).digest('hex');
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    const paymentId = clean(req.body.payment_id, 120);
    const status = clean(req.body.payment_status, 40);
    db.prepare('UPDATE orders SET payment_status = ? WHERE gateway_payment_id = ?').run(status, paymentId);
    res.json({ ok: true });
  });

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => console.log(`Marketplace listening on http://localhost:${port}`));
}

module.exports = { createApp, slugify };
