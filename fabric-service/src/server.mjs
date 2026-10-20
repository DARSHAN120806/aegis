import https from "node:https";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  rename,
  cp,
} from "node:fs/promises";
import {
  createHash,
  createPrivateKey,
  timingSafeEqual,
  X509Certificate,
} from "node:crypto";
import { join } from "node:path";
import { connect, signers } from "@hyperledger/fabric-gateway";
import grpc from "@grpc/grpc-js";
import { Certificate } from "@fidm/x509";
import { encryptWallet, decryptWallet } from "./wallet.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
const execute = promisify(execFile);

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const token = required("BRIDGE_TOKEN");
if (token.length < 32) throw new Error("Service token too short");
const encryption = Buffer.from(required("WALLET_KEY"), "hex");
if (encryption.length !== 32)
  throw new Error("WALLET_KEY must be 32 bytes encoded as hex");
const root = required("WALLET_DIR");
const organizations = JSON.parse(
  await readFile(required("FABRIC_ORGANIZATIONS_FILE"), "utf8"),
);
const channel = process.env.FABRIC_CHANNEL || "aegis",
  chaincode = process.env.FABRIC_CHAINCODE || "aegis";
const auditor = required("FABRIC_EVENT_IDENTITY");
const validId = (v) =>
  typeof v === "string" && /^[a-zA-Z0-9:._-]{1,120}$/.test(v);
const walletPath = (did) => {
  if (!validId(did)) throw new Error("Invalid identity");
  return join(root, createHash("sha256").update(did).digest("hex") + ".json");
};
async function wallet(did, pending = false) {
  const envelope = JSON.parse(
    await readFile(walletPath(did) + (pending ? ".pending" : ""), "utf8"),
  );
  return decryptWallet(envelope, encryption, did);
}
async function saveWallet(did, value) {
  let pending = false;
  try {
    await readFile(walletPath(did));
    pending = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(
    walletPath(did) + (pending ? ".pending" : ""),
    JSON.stringify(encryptWallet(value, encryption, did)),
    { mode: 0o600, flag: "wx" },
  );
}
async function gateway(actor, fn, pending = false) {
  const w = await wallet(actor, pending),
    org = organizations[w.mspId];
  if (!org) throw new Error("Untrusted MSP");
  const cert = new X509Certificate(w.certificate);
  if (Date.parse(cert.validTo) <= Date.now())
    throw new Error("Expired certificate");
  const client = new grpc.Client(
    org.peer,
    grpc.credentials.createSsl(await readFile(org.tlsRoot)),
    {
      "grpc.ssl_target_name_override": org.peerHost,
      "grpc.max_receive_message_length": 8 * 1024 * 1024,
    },
  );
  const gw = connect({
    client,
    identity: { mspId: w.mspId, credentials: Buffer.from(w.certificate) },
    signer: signers.newPrivateKeySigner(createPrivateKey(w.privateKey)),
    evaluateOptions: () => ({ deadline: Date.now() + 10000 }),
    endorseOptions: () => ({ deadline: Date.now() + 15000 }),
    submitOptions: () => ({ deadline: Date.now() + 10000 }),
    commitStatusOptions: () => ({ deadline: Date.now() + 15000 }),
  });
  try {
    return await fn(gw, gw.getNetwork(channel));
  } finally {
    gw.close();
    client.close();
  }
}
const parse = (bytes) =>
  bytes.length ? JSON.parse(Buffer.from(bytes).toString()) : null;
async function dispatch(path, b) {
  if (path === "/certificate") {
    const w = await wallet(b.actor, !!b.pending);
    return { certificate: w.certificate, mspId: w.mspId };
  }
  if (path === "/revoke") {
    const admin = await gateway(b.actor, async (g, n) =>
      parse(
        await n
          .getContract(chaincode, "Operations")
          .evaluateTransaction("WhoAmI"),
      ),
    );
    const target = await wallet(b.target);
    if (!admin.roles.includes("Admin") || admin.org !== target.mspId)
      throw new Error("Revoker not authorized");
    const org = organizations[target.mspId];
    const dir = await mkdtemp(join(tmpdir(), "aegis-revoke-"));
    try {
      await cp(org.registrarMsp, join(dir, "msp"), { recursive: true });
      await execute(
        "fabric-ca-client",
        [
          "revoke",
          "--caname",
          org.caName,
          "--url",
          org.caUrl,
          "--mspdir",
          join(dir, "msp"),
          "--tls.certfiles",
          org.caTlsRoot,
          "--revoke.name",
          target.enrollmentId,
          "--revoke.reason",
          "cessationofoperation",
          "--gencrl",
        ],
        {
          env: { ...process.env, FABRIC_CA_CLIENT_HOME: dir },
          timeout: 20000,
          maxBuffer: 1024 * 1024,
        },
      );
      const crl = await readFile(join(dir, "msp", "crls", "crl.pem"));
      await mkdir(join(root, "crls"), { recursive: true, mode: 0o700 });
      await writeFile(join(root, "crls", target.mspId + ".pem"), crl, {
        mode: 0o600,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    return { revoked: true, channelMspCrlUpdateRequired: true };
  }
  if (path === "/activate") {
    await gateway(
      b.actor,
      async (g, n) => {
        const who = parse(
          await n
            .getContract(chaincode, "Operations")
            .evaluateTransaction("WhoAmI"),
        );
        if (who.id !== b.actor) throw new Error("DID mismatch");
      },
      true,
    );
    await rename(walletPath(b.actor) + ".pending", walletPath(b.actor));
    return { activated: true };
  }
  if (path === "/enroll") {
    if (
      !validId(b.actor) ||
      !validId(b.enrollmentId) ||
      typeof b.secret !== "string" ||
      b.secret.length > 256
    )
      throw new Error("Invalid enrollment");
    const org = organizations[b.mspId];
    if (!org) throw new Error("Unknown organization");
    if (!org.caUrl.startsWith("https://")) throw new Error("CA TLS required");
    const dir = await mkdtemp(join(tmpdir(), "aegis-enroll-"));
    let certificate, privateKey;
    try {
      const url = new URL(org.caUrl);
      url.username = b.enrollmentId;
      url.password = b.secret;
      // Secret is passed in the child environment, never argv or logs. CLI output is captured and discarded.
      await execute(
        "fabric-ca-client",
        [
          "enroll",
          "--caname",
          org.caName,
          "--tls.certfiles",
          org.caTlsRoot,
          "--mspdir",
          join(dir, "msp"),
          "--enrollment.attrs",
          "aegis.did,aegis.bootstrap:opt",
        ],
        {
          env: {
            ...process.env,
            FABRIC_CA_CLIENT_HOME: dir,
            FABRIC_CA_CLIENT_URL: url.toString(),
          },
          timeout: 20000,
          maxBuffer: 1024 * 1024,
        },
      );
      certificate = await readFile(
        join(dir, "msp", "signcerts", "cert.pem"),
        "utf8",
      );
      const keys = await readdir(join(dir, "msp", "keystore"));
      if (keys.length !== 1)
        throw new Error("Expected exactly one enrollment key");
      const key = createPrivateKey(
        await readFile(join(dir, "msp", "keystore", keys[0])),
      );
      privateKey = key.export({ type: "pkcs8", format: "pem" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const attribute = Certificate.fromPEM(
      Buffer.from(certificate),
    ).extensions.find((e) => e.oid === "1.2.3.4.5.6.7.8.1");
    if (
      !attribute ||
      JSON.parse(attribute.value.toString()).attrs["aegis.did"] !== b.actor
    )
      throw new Error("CA DID attribute mismatch");
    await saveWallet(b.actor, {
      mspId: b.mspId,
      enrollmentId: b.enrollmentId,
      certificate,
      privateKey,
    });
    return {
      certificate,
      privateKey,
      certificate_hash: createHash("sha256").update(certificate).digest("hex"),
    };
  }
  if (path === "/health")
    return gateway(auditor, async (g, n) => ({
      ready: !!parse(
        await n
          .getContract(chaincode, "Operations")
          .evaluateTransaction("WhoAmI"),
      ),
    }));
  if (path === "/events")
    return gateway(auditor, async (g, n) => {
      if (!/^\d{1,20}$/.test(String(b.block)))
        throw new Error("Invalid checkpoint");
      const request = n.newChaincodeEventsRequest(chaincode, {
        checkpoint: {
          getBlockNumber: () => BigInt(b.block),
          getTransactionId: () => b.afterTx || undefined,
        },
      });
      const events = await request.getEvents({ deadline: Date.now() + 2500 });
      const batch = [];
      try {
        for await (const e of events) {
          if (e.eventName === "aegis.domain")
            batch.push({
              block: e.blockNumber.toString(),
              tx: e.transactionId,
              body: parse(e.payload),
            });
          if (batch.length >= 100) break;
        }
      } catch (error) {
        if (error.code !== grpc.status.DEADLINE_EXCEEDED) throw error;
      } finally {
        events.close();
      }
      return { events: batch };
    });
  return gateway(b.actor, async (g, n) => {
    const contract = n.getContract(chaincode, "Operations");
    if (path === "/evaluate") {
      if (
        ![
          "Operations",
          "AssetRegistry",
          "CredentialRegistry",
          "IdentityRegistry",
          "AuditRegistry",
        ].includes(b.contract)
      )
        throw new Error("Invalid contract");
      if (
        !["WhoAmI", "Get", "Verify", "Provenance", "Claim"].includes(
          b.transaction,
        )
      )
        throw new Error("Invalid evaluation");
      return {
        result: parse(
          await n
            .getContract(chaincode, b.contract)
            .evaluateTransaction(b.transaction, ...(b.arguments || [])),
        ),
      };
    }
    if (path === "/prepare") {
      const p = contract.newProposal("Execute", {
        arguments: [b.operation, JSON.stringify(b.command)],
      });
      const tx = await p.endorse();
      return {
        tx: tx.getTransactionId(),
        bytes: Buffer.from(tx.getBytes()).toString("base64"),
        result: parse(tx.getResult()),
      };
    }
    if (path === "/submit") {
      const tx = g.newTransaction(Buffer.from(b.prepared.bytes, "base64"));
      // Persisted transaction bytes preserve the transaction ID across all retries and ambiguous submissions.
      const commit = await tx.submit();
      return {
        commit: Buffer.from(commit.getBytes()).toString("base64"),
        tx: tx.getTransactionId(),
      };
    }
    if (path === "/status") {
      const s = await g.newCommit(Buffer.from(b.commit, "base64")).getStatus();
      return {
        successful: s.successful,
        code: s.code,
        tx: s.transactionId,
        block: s.blockNumber.toString(),
      };
    }
    if (path === "/bootstrap") {
      const tx = await contract.submitAsync("Bootstrap", {
        arguments: [b.actor],
      });
      const s = await tx.getStatus();
      if (!s.successful) throw new Error("Bootstrap invalid");
      return { result: parse(tx.getResult()), tx: s.transactionId };
    }
    throw new Error("Unknown route");
  });
}
const server = https.createServer(
  {
    key: await readFile(required("BRIDGE_TLS_KEY")),
    cert: await readFile(required("BRIDGE_TLS_CERT")),
  },
  async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    const auth = Buffer.from(req.headers.authorization || ""),
      expected = Buffer.from("Bearer " + token);
    if (
      req.method !== "POST" ||
      auth.length !== expected.length ||
      !timingSafeEqual(auth, expected)
    ) {
      res.writeHead(401);
      return res.end('{"error":"Unauthorized"}');
    }
    try {
      const parts = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 2 * 1024 * 1024) {
          res.writeHead(413);
          res.end();
          return;
        }
        parts.push(chunk);
      }
      const result = await dispatch(
        req.url,
        JSON.parse(Buffer.concat(parts).toString() || "{}"),
      );
      res.end(JSON.stringify(result));
    } catch (error) {
      // Deliberately omit SDK details: errors may contain identities, enrollment secrets, endpoints and gRPC metadata.
      console.error(
        JSON.stringify({
          event: "bridge.failure",
          route: req.url,
          type: error.name,
        }),
      );
      res.writeHead(error.name === "EndorseError" ? 409 : 503);
      res.end('{"error":"Fabric dependency or transaction unavailable"}');
    }
  },
);
server.requestTimeout = 45000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 8443), "0.0.0.0");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => server.close(() => process.exit(0)));
