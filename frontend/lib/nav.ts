import {
  Activity,
  Bot,
  Box,
  Brain,
  Database,
  FolderTree,
  Gauge,
  GitPullRequestArrow,
  HardDrive,
  Layers,
  LayoutList,
  ListTree,
  MapPin,
  MonitorCog,
  Package,
  Play,
  Radio,
  Route,
  Search,
  Shield,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  hint?: string;
};

export const OPS: NavItem[] = [
  { href: "/", label: "Overview", icon: Gauge },
  { href: "/live", label: "Live", icon: Radio, hint: "Realtime orders · pipeline" },
  { href: "/sim", label: "Simulator", icon: Play, hint: "Start/stop · rate dials" },
  { href: "/ml", label: "ML", icon: Brain },
  { href: "/data", label: "Gold", icon: Database },
  { href: "/database", label: "Database", icon: HardDrive, hint: "Raw · bronze · silver · gold" },
  { href: "/layers", label: "Layers", icon: Layers, hint: "Bronze · silver · gold ops" },
  { href: "/cube", label: "Cube", icon: Box, hint: "OLAP · Three.js" },
  { href: "/query", label: "Query", icon: Search, hint: "SQL + natural language" },
  { href: "/map", label: "Map", icon: MapPin, hint: "Store geo · OSM · feeds" },
  { href: "/agent", label: "Agent", icon: Bot },
  { href: "/proposals", label: "Proposals", icon: GitPullRequestArrow },
  { href: "/logs", label: "Logs", icon: Activity, hint: "Pipeline status" },
  { href: "/streamlit", label: "Streamlit", icon: MonitorCog },
];

export const LEARN: NavItem[] = [
  { href: "/architecture", label: "Architecture", icon: Workflow },
  { href: "/lineage", label: "Lineage", icon: Route },
  { href: "/system", label: "System", icon: ListTree },
  { href: "/tech", label: "Stack", icon: Package },
  { href: "/tooling", label: "Tooling", icon: Wrench },
  { href: "/layout", label: "Repo", icon: FolderTree },
  { href: "/roadmap", label: "Roadmap", icon: LayoutList },
  { href: "/trust", label: "Trust", icon: Shield },
];

export const ALL_PAGES: NavItem[] = [...OPS, ...LEARN];

/** Active match that does not light up `/data` when the path is `/database`. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
