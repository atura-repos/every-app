import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps admin navigation while excluding help links from the user profile menu", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./Sidebar.tsx", import.meta.url)),
    "utf8",
  );
  const menu = source
    .split('<DropdownMenuContent side="top"')[1]
    ?.split("</DropdownMenuContent>")[0];
  expect(menu).toBeDefined();
  expect(menu).not.toContain("Documentation");
  expect(menu).not.toContain("Discord");
  expect(source).toContain('label="Manage workspace"');
});
