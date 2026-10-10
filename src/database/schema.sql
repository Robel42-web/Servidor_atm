-- 1. Identidad y configuración del cajero
CREATE TABLE IF NOT EXISTS atm_configuration (
  id TEXT PRIMARY KEY,
  atm_code TEXT UNIQUE NOT NULL,
  central_atm_id TEXT,
  branch_code TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'maintenance', 'suspended')),
  api_key TEXT,
  central_api_url TEXT,
  last_central_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 2. Efectivo físico disponible
CREATE TABLE IF NOT EXISTS atm_cash_inventory (
  id TEXT PRIMARY KEY,
  denomination NUMERIC(10,2) NOT NULL CHECK (denomination > 0),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (denomination)
);

-- 3. Registro local de operaciones
CREATE TABLE IF NOT EXISTS atm_operations (
  id TEXT PRIMARY KEY,
  operation_code TEXT UNIQUE NOT NULL,
  central_transaction_id TEXT,
  account_number TEXT NOT NULL,
  operation_type TEXT NOT NULL
    CHECK (operation_type IN ('withdrawal','deposit','balance_inquiry')),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','authorized','completed','rejected','failed','reconciliation_required')),
  idempotency_key TEXT UNIQUE NOT NULL,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- 4. Movimientos del inventario
CREATE TABLE IF NOT EXISTS atm_cash_movements (
  id TEXT PRIMARY KEY,
  operation_id TEXT REFERENCES atm_operations(id),
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('dispense','replenishment','deposit','adjustment')),
  denomination NUMERIC(10,2) NOT NULL CHECK (denomination > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 5. Cola de sincronización con Central
CREATE TABLE IF NOT EXISTS atm_sync_queue (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES atm_operations(id),
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','sent','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_attempt_at TEXT,
  sent_at TEXT,
  UNIQUE (operation_id, event_type)
);

-- 6. Logs de eventos
CREATE TABLE IF NOT EXISTS atm_event_logs (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','warning','error','critical')),
  description TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_atm_operations_created
  ON atm_operations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atm_operations_status
  ON atm_operations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atm_sync_pending
  ON atm_sync_queue(status, created_at);
CREATE INDEX IF NOT EXISTS idx_atm_events_created
  ON atm_event_logs(created_at DESC);


  CREATE TABLE IF NOT EXISTS atm_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
  token TEXT,
  accounts_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT
);