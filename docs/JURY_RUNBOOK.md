# Demo runbook

1. Follow README local demo setup and choose Org1 Administrator.
2. Open Jury Demo, Reset, Golden Journey, Run journey.
3. Ten real API steps onboard a fixture identity/credential, mint/allocate, deny an unauthorized mint, request/approve/accept transfer, verify and inspect audit.
4. Pause/Step runs between requests; playback speed does not change consensus speed.
5. Open Provenance, select demo-asset and inspect recipient ownership/five timeline entries. Open Audit for the denied action.
6. Sign out and choose Auditor for read-only investigation. Mobile Sign out is in the topbar.
7. Reset before switching scenarios. Cross-org demo tests isolation; production supports the separate bilateral certificate workflow.

`python scripts/demo.py golden` exercises the same demo HTTP flow. SQLite, fixtures and unsigned demo commitments are simulation. Production CA, signed credentials, governance, S3 and Fabric require actual dependencies and the production smoke suite.
