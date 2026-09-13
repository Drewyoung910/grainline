# Evidence delivery acceptance contract

The successor inactive workflow emits `steps.evidence.outputs.manifest_sha256`
from the exact bounded manifest after collection, including a failed/incomplete
bundle. This digest is separate from the uploaded files. Execution, collection
and upload still all have to succeed for a successful workflow; publishing a
failure receipt never changes that result. The job remains disabled, with
privately proposed immutable action pins. No actual upload/delivery was performed here.

Before accepting a delivered bundle, the authorized receiver must independently
bind the repository, reviewed final main SHA/source catalog, exact manual run,
attempt/job, artifact id, upload archive digest, and this sender manifest digest.
The API/run/artifact evidence must come from the authorized provider record,
not metadata claimed only by the downloaded archive. Treat those values as a
delivery receipt. Protected environment/concurrency and trusted-host assumptions
still apply; neither an artifact's existence nor local hashes prove them.

Extract into a new exclusively owned private directory with bounded archive
size/file count. Reject links, absolute/parent paths, duplicate members and
unknown files; never unpack onto the source, channel, home or an earlier attempt.
Set private directory/file modes0700/0600 before verification. Archive or copy
tools can otherwise create0755 directories. The fixture exposed this behavior:
the strict verifier correctly refused the initial local copy until its receiver
established private staging modes. No verifier requirement was weakened.

`scripts/verify-retrieved-evidence.mjs` implements the OFFLINE portion. Its caller
supplies a canonical directory and independently obtained expected manifest
SHA256, run id/attempt, release SHA and source catalog. It bounds the tree,
rejects unexpected files/directories/links/traversal, requires exact inventory,
checks every length/hash plus binding, and rechecks identities before returning.
It does not download, extract, contact GitHub, change permissions or approve a
release. A matching failed bundle remains failed; a matching incomplete bundle
remains incomplete. All production/off-host authority flags remainfalse.

The actual workflow failure bundle passed this receiver after private local
staging; a subsequent byte change was rejected. This is a local delivery model,
not off-host or host-loss acceptance. Unit fixtures also reject swapped
manifests, wrong attempts, missing/extra members, links, traversal and broad
directory permissions. A digest recovered only from the received bundle is
not an independent expected digest and must not be passed as one.

Operational acceptance still requires an authorized run proving artifact
retrieval from another process/host before the ephemeral runner disappears,
the desired access/retention behavior, and reporting when upload fails or the
host dies before upload. Sudden host loss before publication can still lose
local evidence. No GitHub upload step or fsync can eliminate that gap by itself.
There is no automatic migration replay when the receipt is absent or invalid.
