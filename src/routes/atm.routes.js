const express = require('express');
const router = express.Router();
const atmController = require('../controllers/atm.controller');
const { requireAtmConfig } = require('../middleware/apiKey.middleware');
const { requireLogin, requireAdmin, requireOwnAccount } = require('../middleware/role.middleware');

// Públicas
router.get('/status', atmController.getStatus);
router.post('/login', atmController.login);
router.post('/logout', atmController.logout);
router.get('/session', atmController.getSession);

// Configuración (solo admin)
router.post('/configure', requireAdmin, atmController.configure);

// Inventario (visible para todos, modificación solo admin)
router.get('/cash', atmController.getCashStatus);
router.post('/cash/load', requireAdmin, atmController.loadCash);

// Operaciones
router.get('/balance/:accountNumber',
  requireAtmConfig, requireLogin, requireOwnAccount,
  atmController.getBalance);

router.post('/withdraw',
  requireAtmConfig, requireLogin, requireOwnAccount,
  atmController.withdraw);

router.post('/deposit',
  requireAtmConfig, requireLogin, requireOwnAccount,
  atmController.deposit);

// Historial (admin ve todo, usuario solo lo suyo)
router.get('/operations', requireLogin, atmController.getOperations);

module.exports = router;