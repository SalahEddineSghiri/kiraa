-- Infrastructure only: enable extensions required by the project on first initialization.
-- Business tables, migrations and CSV imports are managed separately.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
