CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,            -- telegram | whatsapp | app
  chat_id TEXT NOT NULL,
  sender TEXT,
  direction TEXT NOT NULL,          -- in | out
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(channel, chat_id, created_at);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,               -- calc_price | send_message | calendar_create | ...
  title TEXT NOT NULL,
  detail TEXT,
  status TEXT NOT NULL,             -- done | pending | rejected | failed
  risk TEXT NOT NULL DEFAULT 'low',
  payload TEXT,                     -- JSON {tool, args}
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity(created_at);
CREATE INDEX IF NOT EXISTS idx_activity_status ON activity(status);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
