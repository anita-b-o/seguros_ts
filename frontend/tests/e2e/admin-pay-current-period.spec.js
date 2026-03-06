import { test, expect } from "@playwright/test";

const PAYMENTS_PENDING_ENDPOINT = "/payments/pending";

const USER_PROFILE = {
  id: 99,
  email: "user@seguros.local",
  first_name: "User",
  last_name: "Tester",
  is_admin: false,
};

async function seedStorage(page, { access, refresh, user }) {
  await page.addInitScript((payload) => {
    window.localStorage.setItem("sc_access", JSON.stringify(payload.access));
    if (payload.refresh) {
      window.localStorage.setItem("sc_refresh", JSON.stringify(payload.refresh));
    } else {
      window.localStorage.removeItem("sc_refresh");
    }
    window.localStorage.setItem("sc_user", JSON.stringify(payload.user));
  }, { access, refresh, user });
}

async function interceptProfile(page) {
  await page.route("**/api/accounts/users/me", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(USER_PROFILE),
    });
  });
}

test.describe("Payments", () => {
  test("pays current billing period", async ({ page }) => {
    await interceptProfile(page);

    const auth = {
      access: "user-access-token",
      refresh: "user-refresh-token",
      user: USER_PROFILE,
    };

    const policy = {
      id: 456,
      number: "SC-456",
      product: "Plan Total",
      plate: "AA123BB",
      status: "active",
      start_date: "2024-01-01",
      end_date: "2024-12-31",
      payment_start_date: "2024-09-01",
      payment_end_date: "2024-09-10",
      billing_status: "UNPAID",
      billing_period_current: {
        id: 777,
        period: "202409",
        amount: "15000.00",
        currency: "ARS",
        due_soft: "2024-09-05",
        due_hard: "2024-09-10",
        status: "UNPAID",
      },
    };

    // Mock the payments contract: pending returns a period object and create_preference returns init_point.
    await page.route("**/api/policies/my**", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([policy]),
      });
    });

    await page.route(`**/api/policies/${policy.id}**`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(policy),
      });
    });

    await page.route(`**/api${PAYMENTS_PENDING_ENDPOINT}**`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ period: policy.billing_period_current }),
      });
    });

    await page.route(`**/api/policies/${policy.id}/receipts**`, (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    });

    let preferenceRequest = null;
    await page.route("**/api/payments/policies/*/create_preference**", async (route, request) => {
      preferenceRequest = request;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          payment_id: 1,
          preference_id: "pref-1",
          init_point: "http://example.com/pay",
        }),
      });
    });

    await seedStorage(page, auth);
    await page.goto("/dashboard/pagos");

    const payButton = page.locator('[data-testid="pay-current-period"]').first();
    await expect(page.locator('[data-testid="payments-table"]')).toBeVisible();
    await expect(page.locator('[data-testid="billing-status"]').first()).toContainText("Pendiente");
    await expect(payButton).toBeVisible();
    await expect(payButton).toBeEnabled();

    const [popup] = await Promise.all([
      page.waitForEvent("popup"),
      payButton.click(),
    ]);

    expect(preferenceRequest).not.toBeNull();
    await expect(popup).toHaveURL("http://example.com/pay");
  });
});
