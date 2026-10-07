import {
  Bot,
  Boxes,
  BarChart3,
  CircleHelp,
  CreditCard,
  Home,
  ListChecks,
  MoreHorizontal,
  Settings,
  Store,
  Target,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

export type BusinessNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
};

/** Everything in the left rail (desktop) and the More sheet (mobile). */
export const BUSINESS_NAV: BusinessNavItem[] = [
  { href: "/b/today", label: "Today", icon: Home, hint: "How the day is going" },
  { href: "/b/stores", label: "Stores", icon: Store, hint: "Every store, worst first" },
  { href: "/b/products", label: "Products", icon: Boxes, hint: "Running low, bestsellers, slow" },
  { href: "/b/delivery", label: "Delivery", icon: Truck, hint: "On-time and delivery time" },
  { href: "/b/money", label: "Money", icon: CreditCard, hint: "Sales, discounts, refunds" },
  { href: "/b/targets", label: "Targets", icon: Target, hint: "Month-to-date vs plan" },
  { href: "/b/customers", label: "Customers", icon: Users, hint: "Who is ordering" },
  { href: "/b/ask", label: "Ask center", icon: Bot, hint: "Ask in plain English" },
  { href: "/b/actions", label: "Actions", icon: ListChecks, hint: "Things waiting for a decision" },
  { href: "/b/reports", label: "Reports", icon: BarChart3, hint: "Saved reports" },
  { href: "/b/learn", label: "Learn", icon: CircleHelp, hint: "Guided tours and glossary" },
  { href: "/b/settings", label: "Settings", icon: Settings, hint: "Your preferences" },
];

/** Mobile bottom tabs. "More" opens a sheet with the remaining pages. */
export const BUSINESS_TABS: BusinessNavItem[] = [
  BUSINESS_NAV.find((i) => i.href === "/b/today")!,
  BUSINESS_NAV.find((i) => i.href === "/b/stores")!,
  BUSINESS_NAV.find((i) => i.href === "/b/ask")!,
  BUSINESS_NAV.find((i) => i.href === "/b/actions")!,
  { href: "#more", label: "More", icon: MoreHorizontal },
];

export const BUSINESS_MORE: BusinessNavItem[] = BUSINESS_NAV.filter(
  (item) => !BUSINESS_TABS.some((tab) => tab.href === item.href),
);

export function isBusinessActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Business route → closest Operations route. */
export const BUSINESS_TO_OPS: Record<string, string> = {
  "/b/today": "/",
  "/b/stores": "/map",
  "/b/products": "/data",
  "/b/delivery": "/live",
  "/b/money": "/layers",
  "/b/targets": "/",
  "/b/customers": "/data",
  "/b/ask": "/agent",
  "/b/actions": "/proposals",
  "/b/learn": "/roadmap",
  "/b/settings": "/",
};

/** Operations route → closest business route (inverse of the table above, plus a few extras). */
export const OPS_TO_BUSINESS: Record<string, string> = {
  "/": "/b/today",
  "/map": "/b/stores",
  "/live": "/b/delivery",
  "/data": "/b/products",
  "/agent": "/b/ask",
  "/proposals": "/b/actions",
  "/roadmap": "/b/learn",
};

function matchPrefix(table: Record<string, string>, pathname: string, fallback: string): string {
  if (table[pathname]) return table[pathname];
  const keys = Object.keys(table)
    .filter((key) => key !== "/" && pathname.startsWith(`${key}/`))
    .sort((a, b) => b.length - a.length);
  return keys.length > 0 ? table[keys[0]] : fallback;
}

export function opsRouteFor(businessPath: string): string {
  return matchPrefix(BUSINESS_TO_OPS, businessPath, "/");
}

export function businessRouteFor(opsPath: string): string {
  return matchPrefix(OPS_TO_BUSINESS, opsPath, "/b/today");
}
