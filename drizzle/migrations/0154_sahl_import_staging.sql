-- 0154: staging for the go-live import of the 2026 files from the old program «سهل» (owner 2026-11-05 «نفذها بالكامل
-- وارفع الكل»). The owner drops the .xlsx files into the private bucket `sahl-import` (Supabase dashboard → Storage);
-- the edge function `sahl-import` reads each file, recognises it by its SHA-256 (the files analysed with the owner) and
-- stores its rows here, record by record, exactly as the file has them. Nothing in the business tables changes here.
-- The schema is not exposed to the API (no grants to anon / authenticated).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sahl-import', 'sahl-import', false, 52428800)
ON CONFLICT (id) DO NOTHING;

CREATE SCHEMA IF NOT EXISTS sahl_import;
REVOKE ALL ON SCHEMA sahl_import FROM PUBLIC;
REVOKE ALL ON SCHEMA sahl_import FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS sahl_import.files (
  sha256      text PRIMARY KEY,
  name        text NOT NULL,
  branch      text NOT NULL CHECK (branch IN ('shalaby', 'abdelmonem', 'sekka')),
  kind        text NOT NULL,               -- the report title in the file's first cell, e.g. «بيع», «قبض»
  period      text,                        -- the file's second line, e.g. «التاريخ :   1/1/2026 - 10/28/2026»
  n_records   int NOT NULL DEFAULT 0,
  staged_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sahl_import.records (
  id      bigserial PRIMARY KEY,
  sha256  text NOT NULL REFERENCES sahl_import.files(sha256) ON DELETE CASCADE,
  branch  text NOT NULL,
  kind    text NOT NULL,
  seq     int NOT NULL,                      -- order in the file
  rec     jsonb NOT NULL,                    -- the record with the file's own column names; documents keep «items»
  UNIQUE (sha256, seq)
);
CREATE INDEX IF NOT EXISTS sahl_import_records_branch_kind ON sahl_import.records (branch, kind);
