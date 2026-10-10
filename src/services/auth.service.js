const crypto = require('crypto');
const db = require('../database/db');

const CENTRAL_API_URL = () => process.env.CENTRAL_API_URL;
const ATM_API_KEY = () => process.env.ATM_API_KEY;

async function login(username, password) {
  const res = await fetch(`${CENTRAL_API_URL()}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de autenticación');

  // Limpiar sesiones anteriores
  db.prepare('DELETE FROM atm_sessions').run();

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO atm_sessions (id, user_id, username, role, token, accounts_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))`
  ).run(
    id,
    data.userId,
    username,
    data.role,
    data.token,
    JSON.stringify(data.accounts || [])
  );

  return getSession();
}

function getSession() {
  const row = db.prepare(
    `SELECT * FROM atm_sessions
     WHERE expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`
  ).get();
  if (!row) return null;
  return {
    ...row,
    accounts: JSON.parse(row.accounts_json || '[]')
  };
}

function logout() {
  db.prepare('DELETE FROM atm_sessions').run();
}

module.exports = { login, getSession, logout };