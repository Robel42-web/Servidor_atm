const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Estado en memoria
const accounts = {
  '6bbac642-d148-4a60-b28b-13833cb28cc5': {
    id: '6bbac642-d148-4a60-b28b-13833cb28cc5',
    numero_cuenta: '1000000001',
    titular: 'Cliente Demo',
    saldo_centavos: 500000, // $5000.00
    estado: 'active',
    moneda: 'MXN'
  }
};

const transactions = [];
const idempotencyCache = {};

const VALID_API_KEY = 'atm_4d089f101df37f5ed520911a7cb8f8ab42faba011819e549b47097c9b9b2c09d';

// Middleware de autenticación
function checkBearer(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ mensaje: 'Token de autorización requerido' });
  }
  const token = auth.replace('Bearer ', '');
  if (token !== VALID_API_KEY) {
    return res.status(401).json({ mensaje: 'API Key inválida' });
  }
  req.apiKey = token;
  next();
}

// --- CONSULTAS ---

app.get('/api/cuentas/numero/:numero', checkBearer, (req, res) => {
  const cuenta = Object.values(accounts).find(
    c => c.numero_cuenta === req.params.numero
  );
  if (!cuenta) {
    return res.status(404).json({ mensaje: 'Cuenta no encontrada' });
  }
  console.log(`MOCK: Consulta cuenta por número ${req.params.numero}`);
  res.json({ cuenta });
});

app.get('/api/cuentas/:id/saldo', checkBearer, (req, res) => {
  const cuenta = accounts[req.params.id];
  if (!cuenta) {
    return res.status(404).json({ mensaje: 'Cuenta no encontrada' });
  }
  console.log(`MOCK: Consulta saldo de ${cuenta.numero_cuenta}`);
  res.json({
    cuenta_id: cuenta.id,
    numero_cuenta: cuenta.numero_cuenta,
    saldo_centavos: cuenta.saldo_centavos,
    saldo: cuenta.saldo_centavos / 100,
    moneda: 'MXN',
    estado: cuenta.estado
  });
});

// --- OPERACIONES ---

function procesarOperacion(req, res, tipo) {
  const { cuenta_id, monto_centavos, idempotency_key, descripcion } = req.body;

  if (!cuenta_id || !monto_centavos || !idempotency_key) {
    return res.status(422).json({
      mensaje: 'Los campos cuenta_id, monto_centavos e idempotency_key son obligatorios'
    });
  }

  // Idempotencia
  if (idempotencyCache[idempotency_key]) {
    console.log(`MOCK: Idempotencia detectada para ${idempotency_key}`);
    return res.json({
      movimiento: idempotencyCache[idempotency_key],
      repetida: true
    });
  }

  const cuenta = accounts[cuenta_id];
  if (!cuenta) {
    return res.status(404).json({ mensaje: 'Cuenta no encontrada' });
  }
  if (cuenta.estado !== 'active') {
    return res.status(422).json({ mensaje: `Cuenta en estado ${cuenta.estado}` });
  }

  const montoCentavos = parseInt(monto_centavos);

  if (tipo === 'withdrawal' && cuenta.saldo_centavos < montoCentavos) {
    return res.status(422).json({ mensaje: 'Saldo insuficiente' });
  }

  // Aplicar operación
  if (tipo === 'withdrawal') {
    cuenta.saldo_centavos -= montoCentavos;
  } else {
    cuenta.saldo_centavos += montoCentavos;
  }

  const movimiento = {
    id: 'mov-' + Date.now(),
    account_origin_id: tipo === 'withdrawal' ? cuenta.id : null,
    account_destination_id: tipo === 'deposit' ? cuenta.id : null,
    amount: montoCentavos,
    type: tipo,
    status: 'completed',
    idempotency_key,
    description: descripcion || `Operación desde ATM`,
    created_at: new Date().toISOString()
  };

  transactions.push(movimiento);
  idempotencyCache[idempotency_key] = movimiento;

  console.log(
    `MOCK: ${tipo === 'withdrawal' ? 'Retiro' : 'Depósito'} de $${(montoCentavos / 100).toFixed(2)} ` +
    `en cuenta ${cuenta.numero_cuenta}. Nuevo saldo: $${(cuenta.saldo_centavos / 100).toFixed(2)}`
  );

  res.status(201).json({ movimiento, repetida: false });
}

app.post('/api/operaciones/depositos', checkBearer, (req, res) => {
  procesarOperacion(req, res, 'deposit');
});

app.post('/api/operaciones/retiros', checkBearer, (req, res) => {
  procesarOperacion(req, res, 'withdrawal');
});

// --- HEALTH ---

app.get('/api', (req, res) => {
  res.json({ servicio: 'Banco Central (MOCK)', estado: 'OK' });
});

const PORT = 8001;
app.listen(PORT, () => {
  console.log(`Mock del Banco Central escuchando en el puerto ${PORT}`);
  console.log(`Cuenta demo: 1000000001 (UUID: 6bbac642-...) con saldo $5000.00`);
  console.log(`API Key válida: ${VALID_API_KEY.slice(0, 20)}...`);
});