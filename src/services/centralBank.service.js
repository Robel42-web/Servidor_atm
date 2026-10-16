const CENTRAL_API_URL = process.env.CENTRAL_API_URL;
const ATM_API_KEY = process.env.ATM_API_KEY;

async function callCentral(endpoint, method = 'GET', body = null) {
  const res = await fetch(`${process.env.CENTRAL_API_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.ATM_API_KEY}`
    },
    body: body ? JSON.stringify(body) : null
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Banco Central devolvió respuesta no JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(data.error || `Central error: ${res.status}`);
  return data;
}

function getAccountByNumber(numero) {
  return callCentral(`/api/cuentas/numero/${numero}`);
}

function getBalance(cuentaId) {
  return callCentral(`/api/cuentas/${cuentaId}/saldo`);
}

function withdraw({ cuentaId, montoCentavos, idempotencyKey, descripcion }) {
  return callCentral('/api/operaciones/retiros', 'POST', {
    cuenta_id: cuentaId,
    monto_centavos: montoCentavos,
    idempotency_key: idempotencyKey,
    descripcion: descripcion || 'Retiro desde ATM'
  });
}

function deposit({ cuentaId, montoCentavos, idempotencyKey, descripcion }) {
  return callCentral('/api/operaciones/depositos', 'POST', {
    cuenta_id: cuentaId,
    monto_centavos: montoCentavos,
    idempotency_key: idempotencyKey,
    descripcion: descripcion || 'Depósito desde ATM'
  });
}

function reverse(centralTransactionId, amount) {
  return callCentral(`/api/atm/transacciones/${centralTransactionId}/reverso`, 'POST', { amount });
}
function reportCash(atmId, cashTotal) {
  return callCentral(`/api/atm/cajeros/${atmId}/efectivo`, 'PATCH', {
    reported_cash_available: cashTotal
  });
}

module.exports = { getAccountByNumber, getBalance, withdraw, deposit };
