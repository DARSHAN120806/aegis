# Validation result index

Final feasible matrix and targeted reruns: [checks.json](checks.json). Backend 29, chaincode 12, bridge 2 and browser 3 tests passed (46 total). Ruff, Prettier, frontend/chaincode builds, bridge syntax, metadata generation and four dependency audits passed. Python audit reports no known vulnerabilities; Node audit JSON files and command logs are retained here.

The initial environment blocked Windows asyncio loopback creation; tests were rerun with loopback permission. Browser installation subsequently succeeded. A nested JSON approval persistence defect and Fabric read-your-writes snapshot defect were fixed and regression-tested. A late formatting check failed, was formatted and passed on the recorded targeted rerun.

See [TESTING.md](../TESTING.md) for the exact commands and proof limits. YAML parsing and mocked contract tests do not prove Docker, PostgreSQL, Redis, S3/KMS, ClamAV, Fabric/CA or Kubernetes operation. Those services were unavailable; the real validation scripts are supplied but unexecuted in this environment. Older checkpoint results are superseded by this record.
