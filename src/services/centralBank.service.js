const CENTRAL_API_URL = process.env.CENTRAL_API_URL;
const ATM_API_KEY = process.env.ATM_API_KEY;

async function callCentral(endpoint, method = 'GET', body = null) {
  const res = await fetch(`${CENTRAL_API_URL}${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': ATM_API_KEY
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

  if (!res.ok) {
    throw new Error(data.error || `Central error: ${res.status}`);
  }
  return data;
}

// -------- Funciones exportadas --------

function getBalance(accountNumber) {
  return callCentral(`/api/v1/accounts/${accountNumber}/balance`);
}

function withdraw(payload) {
  return callCentral('/api/v1/atm/withdrawals', 'POST', payload);
}

function deposit(payload) {
  return callCentral('/api/v1/atm/deposits', 'POST', payload);
}

function reverse(centralTransactionId, amount) {
  return callCentral(
    `/api/v1/atm/transactions/${centralTransactionId}/reverse`,
    'POST',
    { amount }
  );
}

function reportCash(atmId, cashTotal) {
  return callCentral(`/api/v1/atms/${atmId}/cash`, 'PATCH', {
    reported_cash_available: cashTotal
  });
}

module.exports = { getBalance, withdraw, deposit, reverse, reportCash };