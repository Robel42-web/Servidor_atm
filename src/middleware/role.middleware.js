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

// Verifica que un número de cuenta pertenezca al usuario autenticado
function requireOwnAccount(req, res, next) {
  if (req.session.role === 'admin') return next(); // admin opera cualquier cuenta

  const accountNumber = req.params.accountNumber || req.body.accountNumber;
  const owned = req.session.accounts.some(a => a.accountNumber === accountNumber);
  if (!owned) {
    return res.status(403).json({ error: 'No tiene acceso a esta cuenta' });
  }
  next();
}

module.exports = { requireLogin, requireAdmin, requireUser, requireOwnAccount };