-- Websites the Engineering team builds, kept per version so people can try each one live in the sandbox.
CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INT NOT NULL,
  token TEXT NOT NULL UNIQUE,               -- unguessable part of the sandbox link, safe to share with the client
  files JSONB NOT NULL DEFAULT '{}',        -- {"index.html": "...", "styles.css": "..."}
  guide JSONB,                              -- plain-English tour: summary, sections, things to try, changes
  feedback TEXT,                            -- what was asked for in this version
  status TEXT NOT NULL DEFAULT 'building',  -- building | ready | failed
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);
