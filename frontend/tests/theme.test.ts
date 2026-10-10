import { describe, expect, it } from "vitest";
import {
  isDarkLike,
  nextTheme,
  sonnerTheme,
  THEME_CYCLE,
  THEME_OPTIONS,
  themeLabel,
} from "@/lib/theme";
import { isNavActive } from "@/lib/nav";

describe("theme helpers", () => {
  it("includes black in the cycle and options", () => {
    expect(THEME_CYCLE).toContain("black");
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual(["light", "dark", "black", "system"]);
  });

  it("cycles through all themes", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("black");
    expect(nextTheme("black")).toBe("system");
    expect(nextTheme("system")).toBe("light");
  });

  it("treats black as dark-like", () => {
    expect(isDarkLike("black")).toBe(true);
    expect(isDarkLike("dark")).toBe(true);
    expect(isDarkLike("light")).toBe(false);
  });

  it("maps black to sonner dark", () => {
    expect(sonnerTheme("black")).toBe("dark");
    expect(sonnerTheme("system")).toBe("system");
  });

  it("labels themes", () => {
    expect(themeLabel("black")).toBe("Black");
  });
});

describe("isNavActive", () => {
  it("does not mark Gold active on Database", () => {
    expect(isNavActive("/data", "/database")).toBe(false);
    expect(isNavActive("/data", "/data")).toBe(true);
    expect(isNavActive("/data", "/data/foo")).toBe(true);
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/", "/live")).toBe(false);
  });
});
