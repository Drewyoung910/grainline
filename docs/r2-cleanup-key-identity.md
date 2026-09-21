# Protected cleanup credential identity

The manual `r2-cleanup-key-identity.yml` workflow fingerprints the existing
credentials in `Production DirectUpload Cleanup`. It makes no S3 or database
requests and never runs the cleanup worker or repeats its object lifecycle proof.
It uses the existing proof concurrency group and preserves the environment's
protection rules. No shared application or database credentials are supplied.

The artifact binds a reviewed main commit, unique operation UUID, native run ID
and first run attempt to account/bucket, access-key-ID and credential-pair hashes.
Raw values never enter console output or the artifact. A fingerprint is sensitive
operational evidence; execution and artifact disclosure need their concrete scope.

The receiver must authenticate the workflow/run/source/artifact provenance and
match the original dispatch UUID. It must bracket the run with unchanged protected
secret/variable metadata and match the reviewed account and two bucket identities.
It must compare the access-key-ID fingerprint with the old application token ID
and both replacement IDs. A different pair hash alone is insufficient: a rotated
secret on the same token ID could still be revoked by deleting that token.

This identity check does not establish current object access, provider token policy,
drain, old-key rejection, or rotation acceptance. Preserve the separately accepted
object proof and its exact source. Never interpret artifact creation or metadata
timestamps as authorization to revoke a token or alter the cleanup credential.

Run `node --test tests/r2-cleanup-key-identity.test.mjs` for scoped identity and
redaction checks. The pure extractor's synthetic tests do not prove hosted runs.
