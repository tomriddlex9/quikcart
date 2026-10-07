import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("business accessibility basics", () => {
  it("globals.css respects prefers-reduced-motion for all animated elements", () => {
    const css = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
    expect(css).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });

  it("business shell exposes a skip link to main content", () => {
    const shell = readFileSync(
      resolve(__dirname, "../components/business/business-shell.tsx"),
      "utf8",
    );
    expect(shell).toMatch(/Skip to content/);
    expect(shell).toMatch(/href="#main"/);
    expect(shell).toMatch(/id="main"/);
    expect(shell).toMatch(/aria-label="Business"/);
  });
});
