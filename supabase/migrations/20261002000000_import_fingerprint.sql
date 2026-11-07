-- Phase 2: imported transactions carry a fingerprint (source_hash). Making it
-- unique per account means re-uploading the same file can never create
-- duplicates, even if two people import at the same moment. Rows without a
-- fingerprint (null) are unaffected.

drop index public.transactions_source_hash_idx;

create unique index transactions_account_source_hash_key
  on public.transactions (account_id, source_hash);
