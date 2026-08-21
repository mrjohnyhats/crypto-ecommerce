const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ADMIN_PASSWORD = 'test-password-123';
process.env.SESSION_SECRET = 'test-session-secret-with-enough-length';
delete process.env.NOWPAYMENTS_API_KEY;

const { createDatabase } = require('../server/db');
const { createApp, slugify } = require('../server/server');

async function withServer(run) {
  const db = createDatabase(':memory:');
  const server = createApp({ db }).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run({ base, db }); } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
}

test('slugify produces clean catalog slugs', () => {
  assert.equal(slugify('  Sample Product / Blue  '), 'sample-product-blue');
});

test('fresh marketplace starts with a blank catalog', async () => withServer(async ({ base }) => {
  const response = await fetch(`${base}/api/products`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
}));

test('admin can sign in and create a product', async () => withServer(async ({ base }) => {
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test-password-123' })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const created = await fetch(`${base}/api/admin/products`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ name: 'Sample Item', price: '24.50', inventory: '3', category: 'General', description: 'A placeholder product.' })
  });
  assert.equal(created.status, 201);
  const product = await created.json();
  assert.equal(product.slug, 'sample-item');
  assert.equal(product.price_cents, 2450);

  const catalog = await (await fetch(`${base}/api/products`)).json();
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].name, 'Sample Item');
}));

test('checkout recalculates prices and creates a demo crypto invoice', async () => withServer(async ({ base, db }) => {
  db.prepare(`INSERT INTO products (id,name,slug,description,price_cents,category,inventory)
    VALUES ('p1','Sample Item','sample-item','',1250,'General',4)`).run();
  const response = await fetch(`${base}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'buyer@example.com', customerName: 'Sample Buyer', address: '1 Main St', city: 'Austin',
      region: 'TX', postalCode: '78701', country: 'United States', paymentCurrency: 'btc',
      items: [{ productId: 'p1', quantity: 2, price: 1 }]
    })
  });
  assert.equal(response.status, 201);
  const invoice = await response.json();
  assert.equal(invoice.subtotal, 25);
  assert.equal(invoice.demo, true);
  assert.match(invoice.paymentId, /^demo_/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
}));

test('checkout rejects quantities above inventory', async () => withServer(async ({ base, db }) => {
  db.prepare(`INSERT INTO products (id,name,slug,description,price_cents,category,inventory)
    VALUES ('p1','Sample Item','sample-item','',1250,'General',1)`).run();
  const response = await fetch(`${base}/api/orders`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'buyer@example.com', customerName: 'Sample Buyer', address: '1 Main St', city: 'Austin',
      region: 'TX', postalCode: '78701', country: 'United States', paymentCurrency: 'eth',
      items: [{ productId: 'p1', quantity: 2 }]
    })
  });
  assert.equal(response.status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
}));

test('payment callback requires configuration', async () => withServer(async ({ base }) => {
  const response = await fetch(`${base}/api/payments/ipn`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payment_id: 'demo' })
  });
  assert.equal(response.status, 503);
}));
