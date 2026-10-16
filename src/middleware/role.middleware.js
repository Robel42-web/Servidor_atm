const authService = require('../services/auth.service');

function requireLogin(req, res, next) {
  const session = authService.getSession();
  if (!session) {
    return res.status(401).json({ error: 'No hay sesión activa. Inicie sesión.' });
  }
  req.session = session;
  next();
}

function requireAdmin(req, res, next) {
  // Cargar sesión si no fue cargada por un middleware previo
  if (!req.session) {
    req.session = authService.getSession();
  }
  if (!req.session || req.session.role !== 'admin') {
    return res.status(403).json({ error: 'Se requiere rol de administrador' });
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.session) {
    return res.status(401).json({ error: 'No hay sesión activa' });
  }
  next();
}

// Verifica que el cliente solo opere su propia cuenta.
// El admin pasa sin restricción.
function requireOwnAccount(req, res, next) {
  if (req.session.role === 'admin') return next();

  if (!req.session.centralAccountId) {
    return res.status(403).json({ error: 'Sesión sin cuenta asociada' });
  }

  // Protección contra req.body undefined (Express 5 en peticiones GET)
  const body = req.body || {};
  const incomingNumber = req.params.accountNumber || body.accountNumber;
  const incomingId = body.cuenta_id;

  if (incomingNumber && incomingNumber !== req.session.accountNumber) {
    return res.status(403).json({ error: 'No tiene acceso a esta cuenta' });
  }
  if (incomingId && incomingId !== req.session.centralAccountId) {
    return res.status(403).json({ error: 'No tiene acceso a esta cuenta' });
  }

  next();
}

module.exports = { requireLogin, requireAdmin, requireUser, requireOwnAccount };