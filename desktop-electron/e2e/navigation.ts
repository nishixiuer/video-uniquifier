import { expect, type Page } from "@playwright/test";

export async function navigate(page: Page, name: string) {
  const link = page.getByRole("link", {
    name,
    exact: true,
    includeHidden: true,
  });
  if (!(await link.isVisible())) {
    const group = page.locator(".nav-group").filter({ has: link });
    await group.getByRole("button").click();
  }
  await link.click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
