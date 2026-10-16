const crypto = require('crypto');
const db = require('../database/db');
const centralBank = require('./centralBank.service');
const cash = require('./cash.service');

async function processWithdrawal({ accountNumber, cuentaId, amount, idempotencyKey }) {
  // 1. Idempotencia
  const existing = db.prepare(
    'SELECT * FROM atm_operations WHERE idempotency_key = ?'
  ).get(idempotencyKey);
  if (existing) {
    return { replayed: true, operation: existing };
  }

  // 2. Verificar efectivo local
  if (!cash.hasEnoughCash(amount)) {
    const op = createOperation({
      accountNumber, amount, idempotencyKey,
      type: 'withdrawal', status: 'rejected',
      failureReason: 'Efectivo insuficiente en el cajero'
    });
    return { operation: op };
  }

  // 3. Crear operación pendiente
  const op = createOperation({
    accountNumber, amount, idempotencyKey,
    type: 'withdrawal', status: 'pending'
  });

  const config = db.prepare('SELECT atm_code FROM atm_configuration LIMIT 1').get();

  // 4. Llamar al Banco Central
  let centralRes;
  try {
    centralRes = await centralBank.withdraw({
      cuentaId,
      montoCentavos: Math.round(amount * 100),
      idempotencyKey,
      descripcion: `Retiro en ${config?.atm_code || 'ATM'}`
    });
  } catch (err) {
    db.prepare(
      `UPDATE atm_operations SET status = 'rejected', failure_reason = ?, completed_at = datetime('now') WHERE id = ?`
    ).run(`Central rechazó: ${err.message}`, op.id);
    enqueueSync(op.id, 'withdrawal_rejected', { error: err.message });
    throw new Error(`Banco Central rechazó: ${err.message}`);
  }

  // 5. Central autorizó → dispensar efectivo
  try {
    cash.dispenseCash(op.id, amount);
  } catch (dispenseErr) {
    db.prepare(
      `UPDATE atm_operations
       SET status = 'reconciliation_required',
           central_transaction_id = ?,
           failure_reason = ?,
           completed_at = datetime('now')
       WHERE id = ?`
    ).run(centralRes.movimiento.id, `Fallo de dispensación: ${dispenseErr.message}`, op.id);
    enqueueSync(op.id, 'reversal_pending', {
      centralTransactionId: centralRes.movimiento.id,
      accountNumber, amount
    });
    const updated = db.prepare('SELECT * FROM atm_operations WHERE id = ?').get(op.id);
    return { operation: updated, central: centralRes, reconciliationRequired: true };
  }

  // 6. Todo OK
  db.prepare(
    `UPDATE atm_operations SET status = 'completed', central_transaction_id = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(centralRes.movimiento.id, op.id);

  enqueueSync(op.id, 'withdrawal_completed', {
    centralTransactionId: centralRes.movimiento.id,
    amount
  });

  return {
    operation: db.prepare('SELECT * FROM atm_operations WHERE id = ?').get(op.id),
    central: centralRes
  };
}

async function processDeposit({ accountNumber, cuentaId, amount, idempotencyKey }) {
  // 1. Idempotencia
  const existing = db.prepare(
    'SELECT * FROM atm_operations WHERE idempotency_key = ?'
  ).get(idempotencyKey);
  if (existing) {
    return { replayed: true, operation: existing };
  }

  // 2. Crear operación local
  const op = createOperation({
    accountNumber, amount, idempotencyKey,
    type: 'deposit', status: 'pending'
  });

  // 3. Recibir efectivo primero (el cliente ya lo entregó físicamente)
  try {
    cash.addCash(op.id, amount);
  } catch (e) {
    db.prepare(
      `UPDATE atm_operations SET status = 'rejected', failure_reason = ?, completed_at = datetime('now') WHERE id = ?`
    ).run(`Fallo al recibir efectivo: ${e.message}`, op.id);
    throw new Error(`No se pudo recibir el efectivo: ${e.message}`);
  }

  // 4. Llamar al Banco Central
  const config = db.prepare('SELECT atm_code FROM atm_configuration LIMIT 1').get();

  let centralRes;
  try {
    centralRes = await centralBank.deposit({
      cuentaId,
      montoCentavos: Math.round(amount * 100),
      idempotencyKey,
      descripcion: `Depósito en ${config?.atm_code || 'ATM'}`
    });
  } catch (err) {
    // Efectivo ya está físicamente aquí pero el central rechazó → conciliación
    db.prepare(
      `UPDATE atm_operations SET status = 'reconciliation_required', failure_reason = ?, completed_at = datetime('now') WHERE id = ?`
    ).run(`Efectivo recibido pero central rechazó: ${err.message}`, op.id);
    enqueueSync(op.id, 'deposit_reversal_pending', { accountNumber, amount, reason: err.message });
    const updated = db.prepare('SELECT * FROM atm_operations WHERE id = ?').get(op.id);
    return { operation: updated, reconciliationRequired: true };
  }

  // 5. Todo OK
  db.prepare(
    `UPDATE atm_operations SET status = 'completed', central_transaction_id = ?, completed_at = datetime('now') WHERE id = ?`
  ).run(centralRes.movimiento.id, op.id);

  enqueueSync(op.id, 'deposit_completed', {
    centralTransactionId: centralRes.movimiento.id,
    amount
  });

  return {
    operation: db.prepare('SELECT * FROM atm_operations WHERE id = ?').get(op.id),
    central: centralRes
  };
}

function createOperation({ accountNumber, amount, idempotencyKey, type, status, failureReason }) {
  const id = crypto.randomUUID();
  const operationCode = `ATM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

  db.prepare(
    `INSERT INTO atm_operations
     (id, operation_code, account_number, operation_type, amount, status, idempotency_key, failure_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, operationCode, accountNumber, type, amount, status, idempotencyKey, failureReason || null);

  return db.prepare('SELECT * FROM atm_operations WHERE id = ?').get(id);
}

function enqueueSync(operationId, eventType, payload) {
  db.prepare(
    `INSERT OR IGNORE INTO atm_sync_queue
     (id, operation_id, event_type, payload, status)
     VALUES (?, ?, ?, ?, 'pending')`
  ).run(crypto.randomUUID(), operationId, eventType, JSON.stringify(payload));
}

module.exports = { processWithdrawal, processDeposit };