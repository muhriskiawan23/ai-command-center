-- UNAPPLIED BOR AI Stage 3 operator review anti-replay ledger.
-- DRAFT ONLY. No production migrations or operator mutation routes authorized.
-- Stores only salted/contextual SHA-256 digests, not signatures, tokens,
-- prompts, customer balance, receipts, names, emails or provider statements.
CREATE TABLE stage3_operator_review_nonces (
  principal_key_digest TEXT NOT NULL
    CHECK (length(principal_key_digest)=64
      AND principal_key_digest NOT GLOB '*[^0-9a-f]*'),
  nonce_digest TEXT NOT NULL
    CHECK (length(nonce_digest)=64
      AND nonce_digest NOT GLOB '*[^0-9a-f]*'),
  proposal_digest TEXT NOT NULL
    CHECK (length(proposal_digest)=64
      AND proposal_digest NOT GLOB '*[^0-9a-f]*'),
  consumed_at INTEGER NOT NULL CHECK (consumed_at>=0),
  PRIMARY KEY (principal_key_digest,nonce_digest)
);
CREATE TRIGGER stage3_review_nonces_no_update
BEFORE UPDATE ON stage3_operator_review_nonces
BEGIN
  SELECT RAISE(ABORT,'stage3_review_nonce_append_only');
END;
CREATE TRIGGER stage3_review_nonces_no_delete
BEFORE DELETE ON stage3_operator_review_nonces
BEGIN
  SELECT RAISE(ABORT,'stage3_review_nonce_append_only');
END;
