import { test, expect } from "@playwright/test";

test("unauthenticated visitors are redirected to /login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: /sign in to proverbs 21:5/i })).toBeVisible();
});

test("login page offers Google sign-in and states the trial terms", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
  await expect(page.getByText(/7-day free trial/i)).toBeVisible();
});

test("direct navigation to a gated route also redirects to /login", async ({ page }) => {
  await page.goto("/rankings");
  await expect(page).toHaveURL(/\/login$/);
});
