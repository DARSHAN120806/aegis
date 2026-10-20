import { test, expect } from "@playwright/test";
test("Golden Journey and ownership investigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page.getByRole("button", { name: "Jury Demo", exact: true }).click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Demo reset");
  await page.getByLabel("Playback speed").selectOption("2");
  await page.getByRole("button", { name: "Run journey" }).click();
  await expect(page.getByText("10 / 10 steps completed")).toBeVisible({
    timeout: 45000,
  });
  await page.getByRole("button", { name: "Provenance", exact: true }).click();
  await page.getByRole("listitem").filter({ hasText: "demo-asset" }).click();
  await expect(
    page.getByRole("definition").filter({ hasText: "did:aegis:recipient" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "QR link to authenticated verification for demo-asset",
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/provenance-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Audit", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "denied", exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/workspace-desktop.png",
    fullPage: true,
  });
});
test("mobile login is usable and unauthorized mint rejected by API", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByLabel("Demo identity")).toBeVisible();
  await page.getByLabel("Demo identity").selectOption("user");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Digital assets" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  const response = await request.post(
    "http://127.0.0.1:8000/api/demo/session",
    { data: { persona: "user" } },
  );
  const { access_token } = await response.json();
  const denied = await request.post("http://127.0.0.1:8000/api/commands", {
    headers: {
      Authorization: `Bearer ${access_token}`,
      "Idempotency-Key": "e2e-unauthorized",
    },
    data: {
      action: "asset.mint",
      subject: "e2e-forbidden",
      metadata_hash: "b".repeat(64),
    },
  });
  expect(denied.status()).toBe(403);
  await page.screenshot({
    path: "test-results/workspace-mobile.png",
    fullPage: true,
  });
});

test("destructive identity action requires confirmation and persists only after acceptance", async ({
  page,
  request,
}) => {
  const session = await request.post("http://127.0.0.1:8000/api/demo/session", {
    data: { persona: "admin" },
  });
  const { access_token } = await session.json();
  const headers = {
    Authorization: `Bearer ${access_token}`,
    "Idempotency-Key": "e2e-confirmation-onboard",
  };
  const created = await request.post("http://127.0.0.1:8000/api/commands", {
    headers,
    data: { action: "identity.create", subject: "did:aegis:e2e-confirmation" },
  });
  expect(created.status()).toBe(200);
  await page.goto("/");
  await page.getByRole("button", { name: "Open workspace" }).click();
  await page
    .getByLabel("Operation", { exact: true })
    .selectOption("identity.revoke");
  await page
    .getByLabel("Record ID", { exact: true })
    .fill("did:aegis:e2e-confirmation");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Submit operation" }).click();
  const records = await request.get(
    "http://127.0.0.1:8000/api/records/identity?q=e2e-confirmation",
    { headers },
  );
  expect((await records.json())[0].body.status).toBe("active");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Submit operation" }).click();
  await expect(page.getByRole("status")).toContainText("Operation completed");
  const after = await request.get(
    "http://127.0.0.1:8000/api/records/identity?q=e2e-confirmation",
    { headers },
  );
  expect((await after.json())[0].body.status).toBe("revoked");
});
