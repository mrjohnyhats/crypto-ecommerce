const state = { products: [], cart: JSON.parse(localStorage.getItem('coincart-cart') || '{}') };
const $ = selector => document.querySelector(selector);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);

function persist() {
  localStorage.setItem('coincart-cart', JSON.stringify(state.cart));
  const count = Object.values(state.cart).reduce((sum, qty) => sum + qty, 0);
  $('#cartCount').textContent = count;
}

function renderProducts() {
  const grid = $('#productGrid');
  if (!state.products.length) {
    grid.innerHTML = '<div class="empty-state"><div><strong>The catalog is ready for your products.</strong><span>Sign in to the admin dashboard to add the first item.</span></div></div>';
    return;
  }
  grid.innerHTML = state.products.map(product => `
    <article class="product-card">
      <div class="product-image">${product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name)}" loading="lazy">` : 'PRODUCT IMAGE'}</div>
      <div class="product-body"><p class="product-category">${escapeHtml(product.category)}</p><h3>${escapeHtml(product.name)}</h3>
      <p>${escapeHtml(product.description || 'Product details coming soon.')}</p>
      <div class="product-bottom"><strong class="price">${money(product.price_cents)}</strong><button class="add-button" data-add="${product.id}" ${product.inventory ? '' : 'disabled'}>${product.inventory ? 'Add to cart' : 'Sold out'}</button></div></div>
    </article>`).join('');
}

function cartLines() {
  return Object.entries(state.cart).map(([id, quantity]) => ({ product: state.products.find(item => item.id === id), quantity })).filter(line => line.product);
}

function renderCart() {
  const lines = cartLines();
  $('#cartItems').innerHTML = lines.length ? lines.map(({ product, quantity }) => `
    <div class="cart-line"><div><strong>${escapeHtml(product.name)}</strong><p>${money(product.price_cents)} each</p></div>
      <div class="quantity-controls"><button data-qty="${product.id}" data-delta="-1" aria-label="Remove one">−</button><span>${quantity}</span><button data-qty="${product.id}" data-delta="1" aria-label="Add one">+</button></div></div>`).join('') : '<div class="empty-state">Your cart is empty.</div>';
  const total = lines.reduce((sum, line) => sum + line.product.price_cents * line.quantity, 0);
  $('#cartTotal').textContent = money(total);
  $('#checkoutButton').disabled = !lines.length;
}

document.addEventListener('click', event => {
  const add = event.target.closest('[data-add]');
  if (add) {
    const product = state.products.find(item => item.id === add.dataset.add);
    state.cart[product.id] = Math.min(product.inventory, (state.cart[product.id] || 0) + 1);
    persist();
  }
  const qty = event.target.closest('[data-qty]');
  if (qty) {
    const product = state.products.find(item => item.id === qty.dataset.qty);
    state.cart[product.id] = Math.min(product.inventory, Math.max(0, (state.cart[product.id] || 0) + Number(qty.dataset.delta)));
    if (!state.cart[product.id]) delete state.cart[product.id];
    persist(); renderCart();
  }
  const close = event.target.closest('[data-close]');
  if (close) close.closest('dialog').close();
});

$('#cartButton').addEventListener('click', () => { renderCart(); $('#cartDialog').showModal(); });
$('#checkoutButton').addEventListener('click', () => { $('#cartDialog').close(); $('#checkoutDialog').showModal(); });
$('#checkoutForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true; button.textContent = 'Creating invoice…'; $('#checkoutError').textContent = '';
  const body = Object.fromEntries(new FormData(event.currentTarget));
  body.items = cartLines().map(line => ({ productId: line.product.id, quantity: line.quantity }));
  try {
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Checkout failed');
    $('#invoiceOrder').textContent = data.orderNumber;
    $('#invoiceAmount').textContent = `${data.payAmount} ${data.paymentCurrency.toUpperCase()}`;
    $('#invoiceAddress').textContent = data.payAddress;
    $('#invoiceNote').textContent = data.demo ? 'This is a local demo invoice. Add gateway credentials to generate live addresses and amounts.' : 'The invoice will update after the payment network confirms your transfer.';
    state.cart = {}; persist(); $('#checkoutDialog').close(); $('#invoiceDialog').showModal();
  } catch (error) { $('#checkoutError').textContent = error.message; }
  finally { button.disabled = false; button.textContent = 'Create payment invoice'; }
});
$('#copyAddress').addEventListener('click', async () => { await navigator.clipboard.writeText($('#invoiceAddress').textContent); $('#copyAddress').textContent = 'Copied'; });

fetch('/api/products').then(response => response.json()).then(products => { state.products = products; renderProducts(); persist(); }).catch(() => { $('#productGrid').innerHTML = '<div class="empty-state">The catalog could not be loaded.</div>'; });
