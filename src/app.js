require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const atmRoutes = require('./routes/atm.routes');
const syncService = require('./services/sync.service');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares globales
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

//Servir el frontend para que Vercel lo vea.
app.use(express.static('public'));

// Rutas
app.use('/api/atm', atmRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', node: 'atm', timestamp: new Date().toISOString() });
});

// Manejo centralizado de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message
  });
});

app.listen(PORT, () => {
  console.log(`ATM Server running on port ${PORT}`);
});

syncService.startWorker(30000);  // cada 30 segundos

module.exports = app;