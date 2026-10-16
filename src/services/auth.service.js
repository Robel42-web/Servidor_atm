const crypto = require('crypto');
const db = require('../database/db');
const centralBank = require('./centralBank.service');

function timingSafeEqualStr(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Login de CLIENTE: valida el número de cuenta contra el Banco Central
async function loginUser(numero) {
  if (!numero) throw new Error('Número de cuenta obligatorio');

  const res = await centralBank.getAccountByNumber(numero);
  const cuenta = res.cuenta; // ← la respuesta viene envuelta en { cuenta: {...} }

  if (!cuenta) throw new Error('Cuenta no encontrada');
  if (cuenta.estado !== 'active') {
    throw new Error(`Cuenta en estado ${cuenta.estado}`);
  }

  db.prepare('DELETE FROM atm_sessions').run();
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO atm_sessions (id, role, account_number, central_account_id, expires_at)
     VALUES (?, 'user', ?, ?, datetime('now', '+8 hours'))`
  ).run(id, numero, cuenta.id);

  return {
    role: 'user',
    accountNumber: numero,
    centralAccountId: cuenta.id
  };
}
/*async function loginUser(accountNumber) {
  if (!accountNumber) throw new Error('Número de cuenta obligatorio');

  // Valida contra el Banco Central
  const account = await centralBank.getBalance(accountNumber);
  if (!account || !account.numero) {
    throw new Error('Cuenta no encontrada');
  }
  if (account.status !== 'active') {
    throw new Error(`Cuenta en estado ${account.status}`);
  }

  // Limpiar sesiones anteriores
  db.prepare('DELETE FROM atm_sessions').run();

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO atm_sessions (id, role, account_number, expires_at)
     VALUES (?, 'user', ?, datetime('now', '+8 hours'))`
  ).run(id, accountNumber);

  return { role: 'user', accountNumber };
}*/

// Login de ADMIN: validación local contra variables de entorno
function loginAdmin(username, password) {
  const expectedUser = process.env.ATM_ADMIN_USER;
  const expectedPass = process.env.ATM_ADMIN_PASSWORD;

  if (!expectedUser || !expectedPass) {
    throw new Error('Credenciales de administrador no configuradas');
  }

  const userOk = timingSafeEqualStr(username, expectedUser);
  const passOk = timingSafeEqualStr(password, expectedPass);

  if (!userOk || !passOk) {
    throw new Error('Credenciales de administrador inválidas');
  }

  db.prepare('DELETE FROM atm_sessions').run();

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO atm_sessions (id, role, username, expires_at)
     VALUES (?, 'admin', ?, datetime('now', '+8 hours'))`
  ).run(id, username);

  return { role: 'admin', username };
}

function getSession() {
  const row = db.prepare(
    `SELECT * FROM atm_sessions
     WHERE expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`
  ).get();
  if (!row) return null;
  return {
    id: row.id,
    role: row.role,
    accountNumber: row.account_number,
    centralAccountId: row.central_account_id,
    username: row.username
  };
}

function logout() {
  db.prepare('DELETE FROM atm_sessions').run();
}

module.exports = { loginUser, loginAdmin, getSession, logout };