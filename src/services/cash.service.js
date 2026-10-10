const db = require('../database/db');
const crypto = require('crypto');

function getTotalCash() {
  const rows = db.prepare(
    'SELECT denomination, quantity FROM atm_cash_inventory'
  ).all();
  return rows.reduce((sum, r) => sum + r.denomination * r.quantity, 0);
}

function hasEnoughCash(amount) {
  return getTotalCash() >= amount;
}

function dispenseCash(operationId, amount) {
  // Descomposición greedy simple: de mayor a menor denominación
  const denominations = db.prepare(
    'SELECT * FROM atm_cash_inventory WHERE quantity > 0 ORDER BY denomination DESC'
  ).all();

  let remaining = amount;
  const movements = [];

  const tx = db.transaction(() => {
    for (const d of denominations) {
      if (remaining <= 0) break;
      const needed = Math.floor(remaining / d.denomination);
      const available = Math.min(needed, d.quantity);
      if (available > 0) {
        db.prepare(
          'UPDATE atm_cash_inventory SET quantity = quantity - ?, updated_at = datetime(\'now\') WHERE id = ?'
        ).run(available, d.id);

        movements.push({ denomination: d.denomination, quantity: available });
        remaining -= d.denomination * available;
      }
    }

    if (remaining > 0) {
      throw new Error('No se pudo dispensar el monto exacto');
    }

    for (const m of movements) {
      db.prepare(
        `INSERT INTO atm_cash_movements (id, operation_id, movement_type, denomination, quantity, description)
         VALUES (?, ?, 'dispense', ?, ?, ?)`
      ).run(
        crypto.randomUUID(),
        operationId,
        m.denomination,
        m.quantity,
        `Dispensación para operación ${operationId}`
      );
    }

    return movements;
  });

  return tx();
}

function addCash(operationId, amount) {
  const denominations = [1000, 500, 200, 100, 50, 20];
  const upsertInv = db.prepare(
    `INSERT INTO atm_cash_inventory (id, denomination, quantity)
     VALUES (?, ?, ?)
     ON CONFLICT(denomination) DO UPDATE SET
       quantity = quantity + excluded.quantity,
       updated_at = datetime('now')`
  );

  const tx = db.transaction(() => {
    let remaining = amount;
    const movements = [];

    for (const d of denominations) {
      if (remaining <= 0) break;
      const count = Math.floor(remaining / d);
      if (count > 0) {
        upsertInv.run(crypto.randomUUID(), d, count);
        movements.push({ denomination: d, quantity: count });
        remaining -= d * count;
      }
    }

    if (remaining > 0) {
      upsertInv.run(crypto.randomUUID(), remaining, 1);
      movements.push({ denomination: remaining, quantity: 1 });
    }

    const insertMove = db.prepare(
      `INSERT INTO atm_cash_movements
       (id, operation_id, movement_type, denomination, quantity, description)
       VALUES (?, ?, 'deposit', ?, ?, ?)`
    );
    for (const m of movements) {
      insertMove.run(
        crypto.randomUUID(),
        operationId,
        m.denomination,
        m.quantity,
        `Depósito recibido - ${m.quantity} × $${m.denomination}`
      );
    }
  });

  tx();
}

module.exports = { getTotalCash, hasEnoughCash, dispenseCash, addCash };