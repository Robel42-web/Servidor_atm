const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'atm.db');
const db = new Database(DB_PATH);

// Habilitar WAL para mejor concurrencia
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Ejecutar schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

module.exports = db;