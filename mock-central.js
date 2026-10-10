const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Estado en memoria
const accounts = {
  '1234567890': {
    accountNumber: '1234567890',
    holder_name: 'Cliente Demo',
    balance: 5000.00,
    status: 'active'
  }
};
const transactions = [];
const idempotencyCache = {};

// ---------- Saldo ----------
app.get('/api/v1/accounts/:accountNumber/balance', (req, res) => {
  const acc = accounts[req.params.accountNumber];
  if (!acc) return res.status(404).json({ error: 'Cuenta no encontrada' });
  console.log(`MOCK: Consulta saldo ${acc.accountNumber} → $${acc.balance.toFixed(2)}`);
  res.json(acc);
});

// ---------- Retiro ----------
app.post('/api/v1/atm/withdrawals', (req, res) => {
  const { accountNumber, amount, idempotencyKey, atmCode } = req.body;

  if (idempotencyCache[idempotencyKey]) {
    console.log('MOCK: Idempotencia detectada (retiro), devolviendo resultado previo');
    return res.json(idempotencyCache[idempotencyKey]);
  }

  const acc = accounts[accountNumber];
  if (!acc) return res.status(404).json({ error: 'Cuenta no encontrada' });
  if (acc.status !== 'active') return res.status(409).json({ error: 'Cuenta bloqueada' });
  if (amount <= 0) return res.status(400).json({ error: 'Monto inválido' });
  if (acc.balance < amount) return res.status(409).json({ error: 'Saldo insuficiente' });

  acc.balance -= amount;
  const tx = {
    transactionId: 'mock-tx-' + Date.now(),
    status: 'completed',
    newBalance: acc.balance
  };
  transactions.push({ accountNumber, amount, type: 'withdrawal', atmCode, ...tx });
  idempotencyCache[idempotencyKey] = tx;

  console.log(`MOCK: Retiro $${amount} de ${accountNumber} → nuevo saldo $${acc.balance.toFixed(2)}`);
  res.json(tx);
});

// ---------- Depósito ----------
app.post('/api/v1/atm/deposits', (req, res) => {
  const { accountNumber, amount, idempotencyKey, atmCode } = req.body;

  if (idempotencyCache[idempotencyKey]) {
    console.log('MOCK: Idempotencia detectada (depósito), devolviendo resultado previo');
    return res.json(idempotencyCache[idempotencyKey]);
  }

  const acc = accounts[accountNumber];
  if (!acc) return res.status(404).json({ error: 'Cuenta no encontrada' });
  if (acc.status !== 'active') return res.status(409).json({ error: 'Cuenta bloqueada' });
  if (amount <= 0) return res.status(400).json({ error: 'Monto inválido' });

  acc.balance += amount;
  const tx = {
    transactionId: 'mock-tx-' + Date.now(),
    status: 'completed',
    newBalance: acc.balance
  };
  transactions.push({ accountNumber, amount, type: 'deposit', atmCode, ...tx });
  idempotencyCache[idempotencyKey] = tx;

  console.log(`MOCK: Depósito $${amount} a ${accountNumber} → nuevo saldo $${acc.balance.toFixed(2)}`);
  res.json(tx);
});

// ---------- Debug ----------
app.get('/api/v1/admin/transactions', (req, res) => {
  res.json(transactions);
});

app.listen(4000, () => {
  console.log('Mock del Banco Central escuchando en el puerto 4000');
  console.log('Cuenta demo: 1234567890 con saldo inicial $5000.00');
});

// ---------- Login ----------
const MOCK_CREDENTIALS = {
  admin: { password: 'admin123', role: 'admin', userId: 'admin-uuid-1', branchCode: 'SUC-001' },
  '1234567890': { password: '1234', role: 'user', userId: 'user-uuid-1', accounts: ['1234567890', '9876543210'] }
};

app.post('/api/v1/auth/login', (req, res) => {
  const { username, password } = req.body;
  const cred = MOCK_CREDENTIALS[username];
  if (!cred || cred.password !== password) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  const token = 'mock-token-' + Date.now();
  const response = {
    userId: cred.userId,
    username,
    role: cred.role,
    token
  };

  if (cred.role === 'user') {
    response.accounts = cred.accounts.map(num => ({
      accountNumber: num,
      holder_name: accounts[num]?.holder_name || 'Cliente Demo'
    }));
  }

  if (cred.role === 'admin') {
    response.branchCode = cred.branchCode;
  }

  console.log(`MOCK: Login de ${username} como ${cred.role}`);
  res.json(response);
});

// ---------- Registro de ATM ----------
let atmCounter = 1;

app.post('/api/v1/atms/register', (req, res) => {
  const { branchCode, apiKey } = req.body;
  if (!branchCode || !apiKey) {
    return res.status(400).json({ error: 'branchCode y apiKey son obligatorios' });
  }

  const atmId = `mock-atm-uuid-${atmCounter}`;
  const atmCode = `ATM-${String(atmCounter).padStart(3, '0')}`;
  atmCounter++;

  console.log(`MOCK: ATM registrado → ${atmCode} (branch ${branchCode})`);
  res.json({ atmId, atmCode, branchCode });
});