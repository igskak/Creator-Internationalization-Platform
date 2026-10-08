import { expect, test } from "@playwright/test";
import { E2E_SECRET } from "../playwright.config";
import { E2E_EDITOR_EMAIL, E2E_EMAIL, ensureE2eUser, removeProductsByCodePrefix } from "./support";

// E2E (plan 13 §13.4, M2-02): an editor adds a product and an offer with the https and currency
// checks, edits it, and a chef sees the screen read-only. Removes what it created.

const CODE = `E2E-${Date.now()}`;
const PRODUCT = `E2E product ${CODE}`;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await ensureE2eUser(E2E_EDITOR_EMAIL, "editor");
  await ensureE2eUser();
});
test.afterAll(async () => {
  await removeProductsByCodePrefix("E2E-");
});

const signIn = async (page: import("@playwright/test").Page, email: string) => {
  await page
    .context()
    .addCookies([{ name: "rc-locale", value: "en", url: "http://localhost:3100" }]);
  const login = await page.request.post("/auth/test-login", {
    headers: { "x-e2e-secret": E2E_SECRET },
    data: { email },
  });
  expect(login.ok()).toBe(true);
};

test("an editor adds a product and an offer, a chef only reads", async ({ page }, info) => {
  await signIn(page, E2E_EDITOR_EMAIL);
  await page.goto("/knowledge/offers");
  await expect(
    page.getByRole("heading", { name: "Products and offers", exact: true }),
  ).toBeVisible();

  // --- product ------------------------------------------------------------------------------
  await page.getByRole("button", { name: "Add product" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Code").fill("bad code");
  await dialog.getByLabel("Name").fill(PRODUCT);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText(/Use letters, digits/)).toBeVisible();
  await dialog.getByLabel("Code").fill(CODE);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const card = page.locator("[data-slot=card]", { hasText: PRODUCT });
  await expect(card).toBeVisible();
  await expect(card.getByText("No offers yet")).toBeVisible();

  // --- offer: https is required, a currency other than the market's saves with a warning ---------
  await card.getByRole("button", { name: "Add offer" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Guía de pasta");
  await dialog.getByLabel("Price", { exact: true }).fill("19,5");
  await dialog.getByLabel("Landing page").fill("http://example.com/guia");
  await dialog.getByLabel("ManyChat keyword").fill("PASTA");
  await dialog.getByLabel("Status").selectOption("ACTIVE");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByText("Use a full https:// address.")).toBeVisible();
  await dialog.getByLabel("Landing page").fill("https://example.com/guia");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Offer added.")).toBeVisible();
  const row = card.getByRole("row", { name: /Guía de pasta/ });
  await expect(row).toContainText("19.50 EUR");
  await expect(row).toContainText("PASTA");
  await expect(row).toContainText("example.com");

  await row.getByRole("button", { name: "Edit" }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Currency").fill("USD");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/The currency is USD, but es-ES uses EUR\./)).toBeVisible();
  await expect(row).toContainText("19.50 USD");
  await page.screenshot({ path: info.outputPath("offers.png"), fullPage: true });

  // --- a chef reads only ----------------------------------------------------------------------
  await page.context().clearCookies();
  await signIn(page, E2E_EMAIL);
  await page.goto("/knowledge/offers");
  await expect(page.getByText(PRODUCT)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add product" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit product" })).toHaveCount(0);
  await expect(page.getByText(/Read-only: owners and editors/)).toBeVisible();
});
