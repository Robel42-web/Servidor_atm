const db = require('../database/db');

function requireAtmConfig(req, res, next) {
  const config = db.prepare(
    'SELECT * FROM atm_configuration LIMIT 1'
  ).get();

  if (!config || !config.api_key) {
    return res.status(503).json({
      error: 'ATM no configurado. Configure el API Key del Banco Central.'
    });
  }

  if (config.status !== 'active') {
    return res.status(403).json({
      error: `ATM en estado ${config.status}. No puede operar.`
    });
  }

  req.atmConfig = config;
  next();
}

module.exports = { requireAtmConfig };