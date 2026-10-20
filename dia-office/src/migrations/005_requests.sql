-- Requests: you tell Dia what you need, she splits it into department tasks and each team delivers.
CREATE TABLE IF NOT EXISTS requests (
  id SERIAL PRIMARY KEY,
  brief TEXT NOT NULL,                      -- what you asked for, in your words
  title TEXT,                               -- Dia's short name for it
  summary TEXT,                             -- Dia's understanding of the requirement
  questions JSONB NOT NULL DEFAULT '[]',    -- what Dia still needs to know
  source TEXT NOT NULL DEFAULT 'office',    -- office | app | api
  status TEXT NOT NULL DEFAULT 'planning',  -- planning | working | done | failed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  kind TEXT NOT NULL,                       -- research | image | video | build | content
  dept TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',    -- queued | working | done | failed
  output JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tasks_request ON tasks (request_id, seq);

-- Generated images (and later video) live in the database so the office runs the same on a laptop or on AWS.
CREATE TABLE IF NOT EXISTS media (
  id SERIAL PRIMARY KEY,
  task_id INT REFERENCES tasks(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BYTEA NOT NULL,
  prompt TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keys for the phone and desktop apps. Only a hash is stored; the key itself is shown once.
CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
