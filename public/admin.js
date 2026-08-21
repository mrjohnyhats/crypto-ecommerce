const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function loadDashboard() {
  const [products, orders] = await Promise.all([api('/api/admin/products'), api('/api/admin/orders')]);
  $('#productCount').textContent = products.length;
  $('#adminProducts').innerHTML = products.length ? products.map(product => `<div class="admin-product"><div><strong>${escapeHtml(product.name)}</strong><p>${money(product.price_cents)} · ${product.inventory} in stock</p><small>${product.active ? 'Visible' : 'Hidden'} · /${escapeHtml(product.slug)}</small></div><button data-toggle="${product.id}" data-active="${product.active}">${product.active ? 'Hide' : 'Show'}</button></div>`).join('') : '<p>No products yet.</p>';
  $('#orderCount').textContent = orders.length;
  $('#ordersBody').innerHTML = orders.length ? orders.map(order => `<tr><td>${escapeHtml(order.order_number)}</td><td>${escapeHtml(order.email)}</td><td>${money(order.subtotal_cents)}</td><td>${escapeHtml(order.payment_currency.toUpperCase())}</td><td>${escapeHtml(order.payment_status)}</td><td>${new Date(`${order.created_at}Z`).toLocaleDateString()}</td></tr>`).join('') : '<tr><td colspan="6">No orders yet.</td></tr>';
}

async function showDashboard() {
  $('#loginPanel').hidden = true; $('#dashboard').hidden = false;
  try { await loadDashboard(); } catch { location.reload(); }
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#loginError').textContent = '';
  try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); await showDashboard(); }
  catch (error) { $('#loginError').textContent = error.message; }
});
$('#productForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#productError').textContent = '';
  try { await api('/api/admin/products', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); event.currentTarget.reset(); event.currentTarget.elements.category.value = 'General'; await loadDashboard(); }
  catch (error) { $('#productError').textContent = error.message; }
});
$('#adminProducts').addEventListener('click', async event => {
  const button = event.target.closest('[data-toggle]'); if (!button) return;
  await api(`/api/admin/products/${button.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== '1' }) }); await loadDashboard();
});
$('#logoutButton').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); location.reload(); });

api('/api/admin/session').then(session => { if (session.authenticated) showDashboard(); });
