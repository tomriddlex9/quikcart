import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LandingPage } from "@/components/marketing/landing-page";

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn(), resolvedTheme: "light" }),
}));

vi.mock("next/image", () => ({
  default: (props: { alt?: string }) => <img alt={props.alt ?? ""} />,
}));

describe("LandingPage", () => {
  it("renders hero, sections, and sign-in CTA", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { level: 1, name: /quickcart/i })).toBeInTheDocument();
    expect(screen.getByText(/connect the floor to the lakehouse/i)).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: /the gap we close/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /what you get/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /technical stack/i })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /built for the business side too/i }),
    ).toBeInTheDocument();

    const cta = screen.getByRole("button", { name: /get started today/i });
    expect(cta).toHaveAttribute("href", "/login");
  });
});
