const db = require('../database/db');
const centralBank = require('./centralBank.service');

async function flushQueue() {
  const pending = db.prepare(
    `SELECT * FROM atm_sync_queue
     WHERE status = 'pending' AND attempts < 5
     ORDER BY created_at ASC LIMIT 20`
  ).all();

  for (const item of pending) {
    db.prepare(
      `UPDATE atm_sync_queue SET status = 'processing', attempts = attempts + 1, last_attempt_at = datetime('now') WHERE id = ?`
    ).run(item.id);

    try {
      const payload = JSON.parse(item.payload);
      const config = db.prepare('SELECT * FROM atm_configuration LIMIT 1').get();

      // Enviar al central según el tipo de evento
      if (item.event_type === 'withdrawal_completed') {
        await centralBank.withdraw({
          accountNumber: payload.accountNumber,
          amount: payload.amount,
          idempotencyKey: item.id + '-retry',
          atmCode: config.atm_code
        });
      } else if (item.event_type === 'deposit_completed') {
        await centralBank.deposit({ /* ... */ });
      } else if (item.event_type === 'reversal_pending' || item.event_type === 'deposit_reversal_pending') {
        await centralBank.reverse(payload.centralTransactionId, payload.amount);
      }

      db.prepare(
        `UPDATE atm_sync_queue SET status = 'sent', sent_at = datetime('now') WHERE id = ?`
      ).run(item.id);
    } catch (e) {
      db.prepare(
        `UPDATE atm_sync_queue SET status = 'pending', last_error = ? WHERE id = ?`
      ).run(e.message, item.id);
    }
  }
}

function startWorker(intervalMs = 30000) {
  setInterval(() => {
    flushQueue().catch(err => console.error('Sync worker error:', err.message));
  }, intervalMs);
  console.log('Sync worker started');
}

module.exports = { flushQueue, startWorker };