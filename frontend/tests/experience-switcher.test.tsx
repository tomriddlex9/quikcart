import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExperienceSwitcher } from "@/components/experience-switcher";

vi.mock("next/navigation", () => ({
  usePathname: () => "/b/today",
}));

describe("ExperienceSwitcher", () => {
  it("marks business current and links to ops", () => {
    render(<ExperienceSwitcher current="business" />);
    expect(screen.getByText("Business")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Operations" })).toBeInTheDocument();
  });

  it("marks ops current and links to business", () => {
    render(<ExperienceSwitcher current="ops" />);
    expect(screen.getByText("Operations")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Business" })).toBeInTheDocument();
  });
});
