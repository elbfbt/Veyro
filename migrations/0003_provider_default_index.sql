-- Reconciliation checkpoint for databases that were created manually from
-- 0001 without the partial provider-default index. Fresh databases receive
-- the index in 0001, so this statement is a no-op there.
CREATE UNIQUE INDEX IF NOT EXISTS idx_providers_default
  ON providers(user_id) WHERE is_default = 1;
