import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encryptWallet(value, key, did) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(did));
  const data = Buffer.concat([c.update(JSON.stringify(value)), c.final()]);
  return {
    iv: iv.toString("hex"),
    tag: c.getAuthTag().toString("hex"),
    data: data.toString("base64"),
  };
}
export function decryptWallet(envelope, key, did) {
  const d = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(envelope.iv, "hex"),
  );
  d.setAAD(Buffer.from(did));
  d.setAuthTag(Buffer.from(envelope.tag, "hex"));
  return JSON.parse(
    Buffer.concat([
      d.update(Buffer.from(envelope.data, "base64")),
      d.final(),
    ]).toString(),
  );
}
