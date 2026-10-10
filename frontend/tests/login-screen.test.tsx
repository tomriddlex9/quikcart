import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "@/components/login-screen";

const push = vi.fn();
const refresh = vi.fn();
const prefetch = vi.fn();
const demoSignIn = vi.fn();
const signIn = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, prefetch }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "black", setTheme: vi.fn(), resolvedTheme: "black" }),
}));

vi.mock("@/app/login/actions", () => ({
  demoSignIn: (...args: unknown[]) => demoSignIn(...args),
  signIn: (...args: unknown[]) => signIn(...args),
}));

const PERSONAS = [
  {
    persona: "business_exec",
    label: "Business Executive",
    experience: "business",
    display_name: "Asha Rao (Business Exec)",
    blurb: "Company-wide KPIs",
    can_approve: false,
    scopes: [{ scope_type: "company", scope_value: "*" }],
  },
  {
    persona: "store_manager",
    label: "Store Manager",
    experience: "business",
    display_name: "Priya Nair (Store 8)",
    blurb: "Runs dark store #8",
    can_approve: false,
    scopes: [{ scope_type: "store", scope_value: "8" }],
  },
  {
    persona: "inventory_manager",
    label: "Inventory Manager",
    experience: "ops",
    display_name: "Ishita Das (Inventory)",
    blurb: "Approves restock",
    can_approve: true,
    scopes: [{ scope_type: "company", scope_value: "*" }],
  },
];

describe("LoginScreen", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    prefetch.mockReset();
    demoSignIn.mockReset();
    signIn.mockReset();
    window.localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("demo-personas")) {
          return { ok: true, json: async () => PERSONAS };
        }
        if (url.includes("kpis")) {
          return { ok: false, json: async () => null };
        }
        return { ok: false, json: async () => null };
      }),
    );
  });

  it("filters personas by side and continues as the selected persona", async () => {
    demoSignIn.mockResolvedValue({ ok: true, persona: "business_exec", experience: "business" });
    render(<LoginScreen />);

    expect(await screen.findByRole("heading", { level: 1, name: /sign in to quickcart/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /business/i }));
    const personaGroup = await screen.findByRole("radiogroup", { name: /demo persona/i });
    expect(within(personaGroup).getByRole("radio", { name: /asha rao/i })).toBeInTheDocument();
    expect(within(personaGroup).queryByRole("radio", { name: /ishita/i })).toBeNull();

    fireEvent.click(within(personaGroup).getByRole("radio", { name: /asha rao/i }));
    fireEvent.click(screen.getByRole("button", { name: /continue as asha rao/i }));

    await waitFor(() => {
      expect(demoSignIn).toHaveBeenCalledWith("business_exec");
      expect(push).toHaveBeenCalledWith("/b/today");
    });
  });

  it("shows ops personas when Operations is selected", async () => {
    render(<LoginScreen />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("radio", { name: /operations/i }));
    const personaGroup = await screen.findByRole("radiogroup", { name: /demo persona/i });
    expect(within(personaGroup).getByRole("radio", { name: /ishita/i })).toBeInTheDocument();
    expect(within(personaGroup).queryByRole("radio", { name: /asha/i })).toBeNull();
  });

  it("exposes email label when the disclosure is opened", async () => {
    render(<LoginScreen />);
    await screen.findByRole("heading", { level: 1 });
    fireEvent.click(screen.getByRole("button", { name: /sign in with email/i }));
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
});
