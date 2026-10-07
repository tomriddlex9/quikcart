import { describe, expect, it } from "vitest";
import { askHref } from "@/components/business/ask-about-button";

describe("askHref", () => {
  it("encodes the question", () => {
    expect(askHref("Why is sales down?")).toBe("/b/ask?q=Why+is+sales+down%3F");
  });

  it("adds structured context as ctx_* params", () => {
    const href = askHref("Explain late rate", { metric: "late_rate", store: "8" });
    expect(href).toContain("q=Explain+late+rate");
    expect(href).toContain("ctx_metric=late_rate");
    expect(href).toContain("ctx_store=8");
  });
});
