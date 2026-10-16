const API = '/api/atm';

// ------- Utilidades -------
function $(id) { return document.getElementById(id); }

function showResult(elId, msg, type = 'info') {
  const el = $(elId);
  el.textContent = msg;
  el.className = `result show ${type}`;
  setTimeout(() => el.classList.remove('show'), 6000);
}

function uuid() {
  return crypto.randomUUID();
}

function fmtMoney(n) {
  return '$' + Number(n).toFixed(2);
}

// ------- Reglas de montos y denominaciones -------
const VALID_DENOMS = [20, 50, 100, 200, 500, 1000];
const MIN_AMOUNT = 20;
const AMOUNT_STEP = 10;
const IMPOSSIBLE_AMOUNTS = new Set([30]);

function isValidAmount(amount) {
  if (!Number.isFinite(amount)) return false;
  if (amount < MIN_AMOUNT) return false;
  if (amount % AMOUNT_STEP !== 0) return false;
  if (IMPOSSIBLE_AMOUNTS.has(amount)) return false;
  return true;
}

async function api(path, method = 'GET', body = null) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ------- Tabs -------
document.querySelectorAll('.tabs button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ------- Estado del ATM -------
async function refreshStatus() {
  try {
    const s = await api('/status');
    $('atm-code-label').textContent = s.atmCode ? `— ${s.atmCode}` : '— sin configurar';
    const badge = $('status-badge');
    if (!s.configured) {
      badge.textContent = 'Sin configurar';
      badge.className = 'status warn';
    } else if (s.status === 'active') {
      badge.textContent = `Activo · Efectivo ${fmtMoney(s.localCash)}`;
      badge.className = 'status ok';
    } else {
      badge.textContent = s.status;
      badge.className = 'status err';
    }
  } catch {
    $('status-badge').textContent = 'Servidor no responde';
    $('status-badge').className = 'status err';
  }
}

// ------- Operaciones -------
async function consultarSaldo() {
  const acc = $('balance-account').value.trim();
  if (!acc) return showResult('balance-result', 'Ingresa el número de cuenta', 'error');
  try {
    const r = await api(`/balance/${encodeURIComponent(acc)}`);
    showResult('balance-result', `Saldo oficial: ${fmtMoney(r.balance)} — Estado: ${r.status}`, 'success');
  } catch (e) {
    showResult('balance-result', e.message, 'error');
  }
}

async function retirar() {
  const accountNumber = $('withdraw-account').value.trim();
  const amount = parseFloat($('withdraw-amount').value);
  if (!isValidAmount(amount)) {
  return showResult('withdraw-result',
    'El monto debe ser múltiplo de $10, mínimo $20, excepto $30 (ej: 20, 40, 50, 100...)',
    'error');
}
  if (!accountNumber || !amount) return showResult('withdraw-result', 'Completa cuenta y monto', 'error');
  try {
    const r = await api('/withdraw', 'POST', {
      accountNumber, amount, idempotencyKey: uuid()
    });
    const op = r.operation || {};
    showResult('withdraw-result',
      `Retiro ${op.status === 'completed' ? 'exitoso' : op.status}. Transacción central: ${op.central_transaction_id || '—'}`,
      op.status === 'completed' ? 'success' : 'error');
    refreshStatus();
    cargarInventario();
    cargarOperaciones();
  } catch (e) {
    showResult('withdraw-result', e.message, 'error');
    refreshStatus();
  }
}

async function depositar() {
  const accountNumber = $('deposit-account').value.trim();
  const amount = parseFloat($('deposit-amount').value);
  if (!isValidAmount(amount)) {
  return showResult('deposit-result',
    `El monto debe ser múltiplo de ${AMOUNT_STEP} y mínimo $${MIN_AMOUNT} (ej: 20, 50, 100, 200...)`,
    'error');
}
  if (!accountNumber || !amount) return showResult('deposit-result', 'Completa cuenta y monto', 'error');
  try {
    const r = await api('/deposit', 'POST', {
      accountNumber, amount, idempotencyKey: uuid()
    });
    const op = r.operation || {};
    showResult('deposit-result',
      `Depósito ${op.status}. Transacción central: ${op.central_transaction_id || '—'}`,
      op.status === 'completed' ? 'success' : 'error');
    refreshStatus();
    cargarInventario();
    cargarOperaciones();
  } catch (e) {
    showResult('deposit-result', e.message, 'error');
  }
}

// ------- Administración -------
async function configurarATM() {
  try {
    const r = await api('/configure', 'POST', {
      atmCode: $('cfg-atm-code').value.trim(),
      centralAtmId: $('cfg-central-id').value.trim() || null,
      branchCode: $('cfg-branch-code').value.trim(),
      location: $('cfg-location').value.trim(),
      apiKey: $('cfg-api-key').value.trim(),
      centralApiUrl: $('cfg-central-url').value.trim()
    });
    showResult('config-result', r.message + ' (' + r.atmCode + ')', 'success');
    refreshStatus();
  } catch (e) {
    showResult('config-result', e.message, 'error');
  }
}

// ------- Denominaciones dinámicas -------

function createDenomRow(denomination = '', quantity = 0) {
  const row = document.createElement('div');
  row.className = 'denom-row';
  const options = VALID_DENOMS.map(d =>
    `<option value="${d}" ${Number(denomination) === d ? 'selected' : ''}>$${d}</option>`
  ).join('');
  row.innerHTML = `
    <label>Denominación
      <select class="denom-value">
        <option value="">-- Selecciona --</option>
        ${options}
      </select>
    </label>
    <label>Cantidad
      <input type="number" class="denom-qty" min="0" step="1" value="${quantity}" />
    </label>
    <button type="button" title="Quitar">×</button>
  `;
  row.querySelector('button').onclick = () => row.remove();
  return row;
}

function renderDenomRows() {
  const container = $('denoms-container');
  container.innerHTML = '';
  // Prellenamos las 6 denominaciones válidas con cantidad 0
  VALID_DENOMS.forEach(d => container.appendChild(createDenomRow(d, 0)));
}

function addDenomRow() {
  const container = $('denoms-container');
  const row = createDenomRow('', 0);
  container.appendChild(row);
  row.querySelector('.denom-value').focus();
}

/*
const DEFAULT_DENOMS = [500, 200, 100, 50, 20];

function renderDenomRows() {
  const container = $('denoms-container');
  container.innerHTML = '';
  DEFAULT_DENOMS.forEach(d => {
    const row = document.createElement('div');
    row.className = 'denom-row';
    row.innerHTML = `
      <label>Denominación
        <input type="number" class="denom-value" value="${d}" readonly />
      </label>
      <label>Cantidad
        <input type="number" class="denom-qty" min="0" value="0" />
      </label>
      <button type="button" title="Quitar">×</button>
    `;
    row.querySelector('button').onclick = () => row.remove();
    container.appendChild(row);
  });
}
*/

async function cargarEfectivo() {
  const rows = document.querySelectorAll('#denoms-container .denom-row');
  const denominations = [];
  const seen = new Set();
  let error = null;

  rows.forEach(r => {
    const denomination = parseFloat(r.querySelector('.denom-value').value);
    const quantity = parseInt(r.querySelector('.denom-qty').value);
    if (!denomination) return;
    if (!VALID_DENOMS.includes(denomination)) {
      error = `Denominación inválida: $${denomination}`;
      return;
    }
    if (seen.has(denomination)) {
      error = `Denominación duplicada: $${denomination}`;
      return;
    }
    if (quantity > 0) {
      seen.add(denomination);
      denominations.push({ denomination, quantity });
    }
  });

  if (error) return showResult('cash-load-result', error, 'error');
  if (!denominations.length) return showResult('cash-load-result', 'Agrega al menos una denominación con cantidad', 'error');

   try {
    const r = await api('/cash/load', 'POST', { denominations });
    showResult('cash-load-result', `Efectivo cargado. Total disponible: ${fmtMoney(r.total)}`, 'success');
    cargarInventario();
    refreshStatus();
    cargarInventario();
    refreshStatus();
    // Reportar efectivo al Banco Central
    api('/report-cash', 'POST').catch(() => {});
  } catch (e) {
    showResult('cash-load-result', e.message, 'error');
  }
}

// ------- Listados -------
async function cargarInventario() {
  try {
    const r = await api('/cash');
    const tbody = $('inventory-body');
    tbody.innerHTML = '';
    if (!r.inventory || !r.inventory.length) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#94a3b8">Sin inventario</td></tr>';
    } else {
      r.inventory.forEach(i => {
        const subtotal = i.denomination * i.quantity;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${fmtMoney(i.denomination)}</td>
          <td>${i.quantity}</td>
          <td>${fmtMoney(subtotal)}</td>
        `;
        tbody.appendChild(tr);
      });
    }
    $('inventory-total').textContent = fmtMoney(r.total || 0);
  } catch {}
}

async function cargarOperaciones() {
  try {
    const ops = await api('/operations');
    const tbody = $('operations-body');
    tbody.innerHTML = '';
    if (!ops.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8">Sin operaciones</td></tr>';
      return;
    }
    ops.forEach(o => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${new Date(o.created_at).toLocaleString()}</td>
        <td><code>${o.operation_code}</code></td>
        <td>${o.operation_type}</td>
        <td>${o.account_number}</td>
        <td>${fmtMoney(o.amount)}</td>
        <td><span class="badge ${o.status}">${o.status}</span></td>
      `;
      tbody.appendChild(tr);
    });
  } catch {}
}

// ------- Sesión -------
// ------- Sesión -------
let session = null;

async function checkSession() {
  try {
    session = await api('/session');
    enterApp();
  } catch {
    session = null;
    showLogin();
  }
}

function showLogin() {
  $('login-screen').style.display = 'flex';
  $('app').style.display = 'none';
  $('session-info').style.display = 'none';
}

function enterApp() {
  $('login-screen').style.display = 'none';
  $('app').style.display = 'block';
  $('session-info').style.display = 'block';

  if (session.role === 'admin') {
    $('session-user').textContent = `${session.username} (admin)`;
  } else {
    $('session-user').textContent = `Cuenta ${session.accountNumber}`;
  }

  // Ocultar administración si no es admin
  document.querySelectorAll('[data-role="admin"]').forEach(el => {
    el.style.display = session.role === 'admin' ? '' : 'none';
  });

  // Cargar número de cuenta en inputs (para cliente)
  if (session.role === 'user') {
    ['balance-account', 'withdraw-account', 'deposit-account'].forEach(id => {
      const el = $(id);
      if (el) {
        el.value = session.accountNumber;
        el.readOnly = true;
      }
    });
  } else {
    // Admin puede escribir
    ['balance-account', 'withdraw-account', 'deposit-account'].forEach(id => {
      const el = $(id);
      if (el) {
        el.value = '';
        el.readOnly = false;
      }
    });
  }

  refreshStatus();
  if (session.role === 'admin') {
    cargarInventario();
    cargarOperaciones();
    cargarConciliaciones();
  }
}

// ------- Tabs de login -------
document.querySelectorAll('.login-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.login-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.login-form').forEach(f => f.classList.remove('active'));
    btn.classList.add('active');
    $('login-form-' + btn.dataset.target).classList.add('active');
  });
});

// ------- Login cliente -------
document.getElementById('btn-login-user').addEventListener('click', async () => {
  const accountNumber = $('login-account').value.trim();
  if (!accountNumber) return showResult('login-user-result', 'Ingresa tu número de cuenta', 'error');
  try {
    session = await api('/login', 'POST', { accountNumber });
    showResult('login-user-result', 'Acceso concedido', 'success');
    setTimeout(enterApp, 300);
  } catch (e) {
    showResult('login-user-result', e.message, 'error');
  }
});

// ------- Login admin -------
document.getElementById('btn-login-admin').addEventListener('click', async () => {
  const username = $('login-admin-user').value.trim();
  const password = $('login-admin-pass').value;
  if (!username || !password) return showResult('login-admin-result', 'Completa todos los campos', 'error');
  try {
    session = await api('/login-admin', 'POST', { username, password });
    showResult('login-admin-result', 'Acceso concedido', 'success');
    setTimeout(enterApp, 300);
  } catch (e) {
    showResult('login-admin-result', e.message, 'error');
  }
});

// ------- Logout -------
document.getElementById('btn-logout').addEventListener('click', async () => {
  try { await api('/logout', 'POST'); } catch {}
  session = null;
  showLogin();
});

// ------- Configuración (solo admin) -------
document.getElementById('btn-config').addEventListener('click', async () => {
  try {
    const r = await api('/configure', 'POST', {
      atmCode: $('cfg-atm-code').value.trim(),
      branchCode: $('cfg-branch-code').value.trim(),
      apiKey: $('cfg-api-key').value.trim(),
      centralApiUrl: $('cfg-central-url').value.trim()
    });
    showResult('config-result', r.message, 'success');
    refreshStatus();
  } catch (e) {
    showResult('config-result', e.message, 'error');
  }
});

// ------- Reiniciar Configuración (solo admin) -------
document.getElementById('btn-reset-config').addEventListener('click', async () => {
  if (!confirm('¿Seguro que quieres borrar la configuración actual?')) return;
  try {
    const r = await api('/reset-config', 'POST');
    showResult('config-result', r.message, 'success');
    refreshStatus();
  } catch (e) {
    showResult('config-result', e.message, 'error');
  }
});
//Fin de la sección de Sesión



// Resto de listeners
document.getElementById('btn-consultar').addEventListener('click', consultarSaldo);
document.getElementById('btn-retirar').addEventListener('click', retirar);
document.getElementById('btn-depositar').addEventListener('click', depositar);
document.getElementById('btn-add-denom').addEventListener('click', addDenomRow);
document.getElementById('btn-cargar').addEventListener('click', cargarEfectivo);

// ------- Init -------
renderDenomRows();
checkSession();
setInterval(() => { if (session) refreshStatus(); }, 10000);

// Heartbeat: reportar efectivo al central cada 5 minutos (solo admin)
setInterval(() => {
  if (session && session.role === 'admin') {
    api('/report-cash', 'POST').catch(() => {});
  }
}, 5 * 60 * 1000);