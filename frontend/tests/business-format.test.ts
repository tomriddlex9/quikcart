import { describe, expect, it } from "vitest";
import {
  deltaIsGood,
  deltaSentence,
  firstName,
  formatBusinessINR,
  formatShare,
} from "@/lib/business/format";

describe("formatBusinessINR", () => {
  it("shows full rupees with Indian grouping under a lakh", () => {
    expect(formatBusinessINR(86400)).toBe("₹86,400");
    expect(formatBusinessINR(0)).toBe("₹0");
    expect(formatBusinessINR(99999)).toBe("₹99,999");
  });

  it("uses lakh and crore above their thresholds", () => {
    expect(formatBusinessINR(100_000)).toBe("₹1L");
    expect(formatBusinessINR(420_000)).toBe("₹4.2L");
    expect(formatBusinessINR(13_000_000)).toBe("₹1.3Cr");
  });

  it("handles negatives and missing values", () => {
    expect(formatBusinessINR(-420_000)).toBe("-₹4.2L");
    expect(formatBusinessINR(null)).toBe("—");
    expect(formatBusinessINR(Number.NaN)).toBe("—");
  });
});

describe("delta helpers", () => {
  it("writes plain sentences", () => {
    expect(deltaSentence(12.4)).toBe("Up 12% on the same day last week");
    expect(deltaSentence(-8, "yesterday")).toBe("Down 8% on yesterday");
    expect(deltaSentence(0.1)).toBe("About the same as the same day last week");
    expect(deltaSentence(null)).toBe("No comparison yet");
  });

  it("knows whether a change is good news", () => {
    expect(deltaIsGood(10, "higher_better")).toBe(true);
    expect(deltaIsGood(10, "lower_better")).toBe(false);
    expect(deltaIsGood(-10, "lower_better")).toBe(true);
    expect(deltaIsGood(0, "higher_better")).toBeNull();
  });
});

describe("misc", () => {
  it("formats shares from fractions", () => {
    expect(formatShare(0.941)).toBe("94.1%");
    expect(formatShare(0.5)).toBe("50%");
  });

  it("takes the first name without the role suffix", () => {
    expect(firstName("Asha Rao (Business Exec)")).toBe("Asha");
    expect(firstName(null)).toBe("there");
  });
});
