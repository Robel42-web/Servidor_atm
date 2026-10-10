const crypto = require('crypto');
const db = require('../database/db');
const centralBank = require('./centralBank.service');
const cash = require('./cash.service');

async function processWithdrawal({ accountNumber, amount, idempotencyKey }) {
  // 1. Verificar idempotencia: si ya se procesó, devolver el resultado anterior
  const existing = db.prepare(
    'SELECT * FROM atm_operations WHERE idempotency_key = ?'
  ).get(idempotencyKey);

  if (existing) {
    return {
      replayed: true,
      operation: existing
    };
  }

  // 2. Verificar efectivo local ANTES de llamar al Central
  if (!cash.hasEnoughCash(amount)) {
    const op = createOperation({
      accountNumber, amount, idempotencyKey,
      type: 'withdrawal',
      status: 'rejected',
      failureReason: 'Efectivo insuficiente en el cajero'
    });
    return { operation: op };
  }

  // 3. Crear registro local en estado "pending"
  const op = createOperation({
    accountNumber, amount, idempotencyKey,
    type: 'withdrawal',
    status: 'pending'
  });

  try {
    // 4. Llamar al Banco Central
    const centralRes = await centralBank.withdraw({
      accountNumber,
      amount,
      idempotencyKey,
      atmCode: db.prepare('SELECT atm_code FROM atm_configuration LIMIT 1').get()?.atm_code
    });

    // 5. Central autorizó → dispensar efectivo físicamente
    cash.dispenseCash(op.id, amount);

    // 6. Actualizar operación local
    db.prepare(
      `UPDATE atm_operations
       SET status = 'completed',
           central_transaction_id = ?,
           completed_at = datetime('now')
       WHERE id = ?`
    ).run(centralRes.transactionId, op.id);

    // 7. Encolar evento de sincronización
    enqueueSync(op.id, 'withdrawal_completed', {
      centralTransactionId: centralRes.transactionId,
      amount
    });

    return {
      operation: db.prepare('SELECT * FROM atm_operations WHERE id = ?').get(op.id),
      central: centralRes
    };
  } catch (err) {
    // 8. Fallo → marcar como rechazada
    db.prepare(
      `UPDATE atm_operations
       SET status = 'rejected',
           failure_reason = ?,
           completed_at = datetime('now')
       WHERE id = ?`
    ).run(err.message, op.id);

    enqueueSync(op.id, 'withdrawal_failed', { error: err.message });

    throw err;
  }
}

async function processDeposit({ accountNumber, amount, idempotencyKey }) {
  // 1. Idempotencia
  const existing = db.prepare(
    'SELECT * FROM atm_operations WHERE idempotency_key = ?'
  ).get(idempotencyKey);

  if (existing) {
    return { replayed: true, operation: existing };
  }

  // 2. Crear operación local "pending"
  const op = createOperation({
    accountNumber, amount, idempotencyKey,
    type: 'deposit',
    status: 'pending'
  });

  try {
    // 3. Llamar al Banco Central
    const centralRes = await centralBank.deposit({
      accountNumber,
      amount,
      idempotencyKey,
      atmCode: db.prepare('SELECT atm_code FROM atm_configuration LIMIT 1').get()?.atm_code
    });

    // 4. Actualizar inventario físico local (el ATM recibió efectivo)
    cash.addCash(op.id, amount);

    // 5. Marcar operación como completada
    db.prepare(
      `UPDATE atm_operations
       SET status = 'completed',
           central_transaction_id = ?,
           completed_at = datetime('now')
       WHERE id = ?`
    ).run(centralRes.transactionId, op.id);

    // 6. Encolar sync
    enqueueSync(op.id, 'deposit_completed', {
      centralTransactionId: centralRes.transactionId,
      amount
    });

    return {
      operation: db.prepare('SELECT * FROM atm_operations WHERE id = ?').get(op.id),
      central: centralRes
    };
  } catch (err) {
    db.prepare(
      `UPDATE atm_operations
       SET status = 'rejected',
           failure_reason = ?,
           completed_at = datetime('now')
       WHERE id = ?`
    ).run(err.message, op.id);

    enqueueSync(op.id, 'deposit_failed', { error: err.message });

    throw err;
  }
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