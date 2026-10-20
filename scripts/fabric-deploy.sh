#!/usr/bin/env bash
# Uses official Fabric samples supplied by operator; no hidden download/bootstrap credentials.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
: "${FABRIC_SAMPLES_DIR:?Set FABRIC_SAMPLES_DIR to an installed official fabric-samples directory}"
command -v docker >/dev/null || { echo 'Docker unavailable; cannot deploy Fabric'; exit 1; }
[[ -x "$FABRIC_SAMPLES_DIR/test-network/network.sh" ]] || { echo 'Missing official Fabric test-network'; exit 1; }
(cd "$root/chaincode" && npm ci && npm run build)
cd "$FABRIC_SAMPLES_DIR/test-network"
./network.sh up createChannel -ca -c aegis -s couchdb
./network.sh deployCC -c aegis -ccn aegis -ccp "$root/chaincode" -ccl typescript -ccv "${CHAINCODE_VERSION:-1.0}" -ccs "${CHAINCODE_SEQUENCE:-1}" -cccg "$root/chaincode/collections.json" -ccep "AND('Org1MSP.peer','Org2MSP.peer')"
echo 'Development deployment requested. Enroll DID-bound identities before invoking contracts.'
