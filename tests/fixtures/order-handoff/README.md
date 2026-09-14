# Order handoff fixtures

`historical-production-migrations.yml.txt` preserves the exact generic production
operator from accepted commit 4a3c17caa95865823837f9890060105ed3f4653c. Its existing
seal/order assertions remain historical regression evidence. It is outside the
Actions workflow directory and is never installed or executed by these tests.
`order-handoff-workflow.test.mjs` checks its digest and separately checks the
current replacement workflow. Historical fixture assertions do not establish
current production wiring or acceptance.

`github-fetch.mjs.txt` installs only the modeled fetch implementation inside the
private process fixture checkout. It is not imported by any production module.
Process fixtures create fake npm/engine/database adapters, use real child
processes and private Unix sockets, and cannot establish native release scope.
The process suite extracts inline Node programs directly from the candidate
workflow; it does not read a generated workflow copy or checkpoint directory.
