const db = require('../database/db');
const centralBank = require('../services/centralBank.service');
const cash = require('../services/cash.service');
const operations = require('../services/operation.service');

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

exports.getStatus = (req, res) => {
  const config = db.prepare('SELECT * FROM atm_configuration LIMIT 1').get();
  res.json({
    configured: !!config?.api_key,
    atmCode: config?.atm_code || null,
    status: config?.status || 'not_configured',
    localCash: cash.getTotalCash()
  });
};

exports.getCashStatus = (req, res) => {
  const inventory = db.prepare('SELECT * FROM atm_cash_inventory').all();
  res.json({
    total: cash.getTotalCash(),
    inventory
  });
};

exports.getBalance = async (req, res) => {
  try {
    const result = await centralBank.getBalance(req.params.accountNumber);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};

exports.withdraw = async (req, res) => {
  const { accountNumber, amount, idempotencyKey } = req.body;

  if (!accountNumber || !amount || !idempotencyKey) {
  return res.status(400).json({
    error: 'accountNumber, amount e idempotencyKey son obligatorios'
  });
    }

  if (!isValidAmount(amount)) {
    return res.status(400).json({
        error: `El monto debe ser múltiplo de $${AMOUNT_STEP}, mínimo $${MIN_AMOUNT}, excepto $30 (ej: 20, 40, 50, 100, 200...)`
    });
  }

  try {
    const result = await operations.processWithdrawal({
      accountNumber,
      amount,
      idempotencyKey
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
};

exports.deposit = async (req, res) => {
  const { accountNumber, amount, idempotencyKey } = req.body;

  if (!accountNumber || !amount || !idempotencyKey) {
    return res.status(400).json({
        error: 'accountNumber, amount e idempotencyKey son obligatorios'
    });
    }

  if (!isValidAmount(amount)) {
  return res.status(400).json({
    error: `El monto debe ser múltiplo de $${AMOUNT_STEP}, mínimo $${MIN_AMOUNT}, excepto $30 (ej: 20, 40, 50, 100, 200...)`
  });
}

  try {
    const result = await operations.processDeposit({
      accountNumber,
      amount,
      idempotencyKey
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
};

exports.configure = async (req, res) => {
  const { branchCode, apiKey, centralApiUrl } = req.body;
  if (!branchCode || !apiKey || !centralApiUrl) {
    return res.status(400).json({ error: 'branchCode, apiKey y centralApiUrl son obligatorios' });
  }

  try {
    // Registrar el ATM en el Banco Central
    const reg = await fetch(`${centralApiUrl}/api/v1/atms/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branchCode, apiKey })
    });
    const data = await reg.json().catch(() => ({}));
    if (!reg.ok) throw new Error(data.error || 'Error al registrar el ATM en el central');

    // Guardar configuración local
    db.prepare('DELETE FROM atm_configuration').run();
    db.prepare(
      `INSERT INTO atm_configuration
       (id, atm_code, central_atm_id, branch_code, api_key, central_api_url, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`
    ).run(
      require('crypto').randomUUID(),
      data.atmCode,
      data.atmId,
      branchCode,
      apiKey,
      centralApiUrl
    );

    res.json({
      message: 'ATM registrado correctamente',
      atmCode: data.atmCode,
      centralAtmId: data.atmId
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};

exports.getOperations = (req, res) => {
  const ops = db.prepare(
    'SELECT * FROM atm_operations ORDER BY created_at DESC LIMIT 50'
  ).all();
  res.json(ops);
};

// Endpoint termporal para pruebas, eliminar al final
exports.loadCash = (req, res) => {
  const { denominations } = req.body;
  if (!Array.isArray(denominations) || !denominations.length) {
    return res.status(400).json({ error: 'denominations debe ser un array no vacío' });
  }
  for (const d of denominations) {
    if (!VALID_DENOMS.includes(d.denomination)) {
        return res.status(400).json({
        error: `Denominación inválida: $${d.denomination}. Permitidas: ${VALID_DENOMS.join(', ')}`
        });
    }
    if (!Number.isInteger(d.quantity) || d.quantity <= 0) {
        return res.status(400).json({ error: `Cantidad inválida para $${d.denomination}` });
    }
    }
  const crypto = require('crypto');
  const upsert = db.prepare(
    `INSERT INTO atm_cash_inventory (id, denomination, quantity)
     VALUES (?, ?, ?)
     ON CONFLICT(denomination) DO UPDATE SET
       quantity = quantity + excluded.quantity,
       updated_at = datetime('now')`
  );
  const tx = db.transaction(() => {
    for (const d of denominations) {
      upsert.run(crypto.randomUUID(), d.denomination, d.quantity);
    }
  });
  tx();
  res.json({ message: 'Efectivo cargado', total: cash.getTotalCash() });
};

const authService = require('../services/auth.service');

exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username y password son obligatorios' });
  }
  try {
    const session = await authService.login(username, password);
    res.json({
      role: session.role,
      username: session.username,
      accounts: session.accounts
    });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
};

//logout
exports.logout = (req, res) => {
  authService.logout();
  res.json({ message: 'Sesión cerrada' });
};

//obtener sesión.
exports.getSession = (req, res) => {
  const session = authService.getSession();
  if (!session) return res.status(401).json({ error: 'No autenticado' });
  res.json({
    role: session.role,
    username: session.username,
    accounts: session.accounts
  });
};

//Reportar dinero actual en el cajero
exports.reportCash = async (req, res) => {
  const config = db.prepare('SELECT * FROM atm_configuration LIMIT 1').get();
  if (!config?.central_atm_id) {
    return res.status(400).json({ error: 'ATM no configurado' });
  }
  try {
    const total = cash.getTotalCash();
    await centralBank.reportCash(config.central_atm_id, total);
    res.json({ reported: total });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};