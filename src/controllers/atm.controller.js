const db = require('../database/db');
const centralBank = require('../services/centralBank.service');
const cash = require('../services/cash.service');
const operations = require('../services/operation.service');
const authService = require('../services/auth.service');

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

// ---------- Estado del ATM ----------

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

// ---------- Sesiones ----------

exports.login = async (req, res) => {
  const { accountNumber } = req.body;
  if (!accountNumber) {
    return res.status(400).json({ error: 'accountNumber es obligatorio' });
  }
  try {
    const session = await authService.loginUser(accountNumber);
    res.json(session);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
};

exports.loginAdmin = (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username y password son obligatorios' });
  }
  try {
    const session = authService.loginAdmin(username, password);
    res.json(session);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
};

exports.logout = (req, res) => {
  authService.logout();
  res.json({ message: 'Sesión cerrada' });
};

exports.getSession = (req, res) => {
  const session = authService.getSession();
  if (!session) return res.status(401).json({ error: 'No autenticado' });
  res.json(session);
};

// ---------- Configuración ----------

exports.configure = (req, res) => {
  const { branchCode, apiKey, centralApiUrl, atmCode } = req.body;
  if (!apiKey || !centralApiUrl) {
    return res.status(400).json({ error: 'apiKey y centralApiUrl son obligatorios' });
  }

  db.prepare('DELETE FROM atm_configuration').run();
  db.prepare(
    `INSERT INTO atm_configuration
     (id, atm_code, branch_code, api_key, central_api_url, status)
     VALUES (?, ?, ?, ?, ?, 'active')`
  ).run(
    require('crypto').randomUUID(),
    atmCode || 'ATM-001',
    branchCode || null,
    apiKey,
    centralApiUrl
  );

  res.json({ message: 'ATM configurado', atmCode: atmCode || 'ATM-001' });
};

// ---------- Saldo ----------

exports.getBalance = async (req, res) => {
  let cuentaRef;
  if (req.session.role === 'admin') {
    cuentaRef = req.params.accountNumber;
  } else {
    cuentaRef = req.session.centralAccountId;
  }

  if (!cuentaRef) {
    return res.status(400).json({ error: 'Cuenta no especificada' });
  }

  try {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cuentaRef);
    const raw = isUuid
      ? await centralBank.getBalance(cuentaRef)
      : await centralBank.getAccountByNumber(cuentaRef);

    // El mock/central devuelve { cuenta: {...} } o un objeto plano según el endpoint
    const cuenta = raw.cuenta || raw;

    // Normalizar para el frontend
    const balanceCentavos = cuenta.saldo_centavos ?? raw.saldo_centavos;
    const estado = cuenta.estado ?? raw.estado ?? 'unknown';

    res.json({
      accountNumber: cuenta.numero_cuenta || cuentaRef,
      holderName: cuenta.titular || null,
      balance: balanceCentavos / 100,
      status: estado
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};

// ---------- Retiro ----------

exports.withdraw = async (req, res) => {
  const { amount, idempotencyKey } = req.body;

  // Para admin: puede especificar la cuenta. Para cliente: siempre la suya.
  const accountNumber = req.session.role === 'admin'
    ? req.body.accountNumber
    : req.session.accountNumber;
  const cuentaId = req.session.role === 'admin'
    ? req.body.cuentaId
    : req.session.centralAccountId;

  if (!accountNumber || !cuentaId || !amount || !idempotencyKey) {
    return res.status(400).json({
      error: 'Faltan datos: amount, idempotencyKey y (para admin) accountNumber y cuentaId'
    });
  }

  if (!isValidAmount(amount)) {
    return res.status(400).json({
      error: `El monto debe ser múltiplo de $${AMOUNT_STEP}, mínimo $${MIN_AMOUNT}, excepto $30`
    });
  }

  try {
    const result = await operations.processWithdrawal({
      accountNumber,
      cuentaId,
      amount,
      idempotencyKey
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
};

// ---------- Depósito ----------

exports.deposit = async (req, res) => {
  const { amount, idempotencyKey } = req.body;

  const accountNumber = req.session.role === 'admin'
    ? req.body.accountNumber
    : req.session.accountNumber;
  const cuentaId = req.session.role === 'admin'
    ? req.body.cuentaId
    : req.session.centralAccountId;

  if (!accountNumber || !cuentaId || !amount || !idempotencyKey) {
    return res.status(400).json({
      error: 'Faltan datos: amount, idempotencyKey y (para admin) accountNumber y cuentaId'
    });
  }

  if (!isValidAmount(amount)) {
    return res.status(400).json({
      error: `El monto debe ser múltiplo de $${AMOUNT_STEP}, mínimo $${MIN_AMOUNT}, excepto $30`
    });
  }

  try {
    const result = await operations.processDeposit({
      accountNumber,
      cuentaId,
      amount,
      idempotencyKey
    });
    res.status(result.replayed ? 200 : 201).json(result);
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
};

// ---------- Operaciones e inventario ----------

exports.getOperations = (req, res) => {
  const ops = db.prepare(
    'SELECT * FROM atm_operations ORDER BY created_at DESC LIMIT 50'
  ).all();
  res.json(ops);
};

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

// ---------- Reportar efectivo (opcional, depende del central) ----------

exports.reportCash = async (req, res) => {
  const config = db.prepare('SELECT * FROM atm_configuration LIMIT 1').get();
  if (!config?.atm_code) {
    return res.status(400).json({ error: 'ATM no configurado' });
  }
  try {
    const total = cash.getTotalCash();
    // Si tu compañero aún no implementa este endpoint en el central, esto fallará.
    // Puedes dejarlo comentado hasta que exista.
    await centralBank.reportCash(config.atm_code, total);
    res.json({ reported: total });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};

// ---------- Conciliación ----------

exports.listReconciliation = (req, res) => {
  const ops = db.prepare(
    `SELECT * FROM atm_operations
     WHERE status = 'reconciliation_required'
     ORDER BY created_at DESC`
  ).all();
  res.json(ops);
};

exports.resolveReconciliation = async (req, res) => {
  const { operationId, action } = req.body;
  const op = db.prepare('SELECT * FROM atm_operations WHERE id = ?').get(operationId);
  if (!op) return res.status(404).json({ error: 'Operación no encontrada' });
  if (op.status !== 'reconciliation_required') {
    return res.status(409).json({ error: `Operación en estado ${op.status}, no requiere conciliación` });
  }

  if (action === 'reversed') {
    try {
      await centralBank.reverse(op.central_transaction_id, op.amount);
    } catch (e) {
      return res.status(502).json({ error: `Fallo al revertir en el central: ${e.message}` });
    }
    db.prepare(
      `UPDATE atm_operations SET status = 'rejected', failure_reason = 'Revertido por admin', completed_at = datetime('now') WHERE id = ?`
    ).run(op.id);
  } else if (action === 'completed') {
    db.prepare(
      `UPDATE atm_operations SET status = 'completed', failure_reason = 'Confirmado manualmente por admin', completed_at = datetime('now') WHERE id = ?`
    ).run(op.id);
  } else {
    return res.status(400).json({ error: 'action debe ser "reversed" o "completed"' });
  }

  res.json({ message: 'Conciliación resuelta', operationId, action });
};

//Borrar la configuracion:
exports.resetConfiguration = (req, res) => {
  db.prepare('DELETE FROM atm_configuration').run();
  res.json({ message: 'Configuración eliminada' });
};