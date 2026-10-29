import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Brain,
  Cpu,
  Dna,
  Eye,
  Gauge,
  LayoutGrid,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  Syringe,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import { MODULES, type ModuleKey } from "@/lib/company";
import { endSession, isDemo } from "@/lib/session";
import { ThemeToggle } from "@/components/brand/ThemeToggle";
import { Logo } from "@/components/site/Logo";

export const MODULE_ICON: Record<ModuleKey, LucideIcon> = {
  home: LayoutGrid,
  vision: Dna,
  therapy: Syringe,
  eye: Eye,
  simulation: Workflow,
  research: Brain,
  viewer: ScanLine,
  neuro: Activity,
  nimble: Cpu,
  benchmarks: Gauge,
};

const GROUPS = ["Genome & Vision", "Brain", "Platform"] as const;
const COLLAPSE_KEY = "cognivance-sidebar";

/** Which nav item a path belongs to: the longest module path that prefixes it. */
export function activeModule(path: string): ModuleKey {
  if (path === "/app") return "home";
  const hit = [...MODULES]
    .sort((a, b) => b.to.length - a.to.length)
    .find((m) => path === m.to || path.startsWith(m.to + "/"));
  return hit?.key ?? "home";
}

function NavItem({
  to,
  icon: Icon,
  label,
  active,
  collapsed,
  onClick,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick?: (() => void) | undefined;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 rounded-lg px-2.5 py-2 text-[13.5px] transition-colors ${
        active
          ? "bg-foreground/[0.07] font-medium text-foreground"
          : "text-foreground/65 hover:bg-foreground/[0.04] hover:text-foreground"
      } ${collapsed ? "justify-center" : ""}`}
    >
      <Icon
        className={`h-[17px] w-[17px] shrink-0 ${active ? "text-primary" : ""}`}
        aria-hidden
        strokeWidth={1.75}
      />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
}

function SidebarBody({
  path,
  collapsed,
  onNavigate,
}: {
  path: string;
  collapsed: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const active = activeModule(path);
  const [demo, setDemo] = useState<boolean | null>(null);
  useEffect(() => setDemo(isDemo()), []);

  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4" aria-label="Workspace">
        <div>
          <NavItem
            to="/app"
            icon={MODULE_ICON.home}
            label="Workspace"
            active={active === "home"}
            collapsed={collapsed}
            onClick={onNavigate}
          />
        </div>
        {GROUPS.map((g) => (
          <div key={g}>
            {collapsed ? (
              <div className="mx-auto mb-2 h-px w-6 bg-border" />
            ) : (
              <p className="t-marker mb-2 px-2.5 text-[10px] text-ash">{g}</p>
            )}
            <div className="space-y-0.5">
              {MODULES.filter((m) => m.group === g).map((m) => (
                <NavItem
                  key={m.key}
                  to={m.to}
                  icon={MODULE_ICON[m.key]}
                  label={m.name}
                  active={active === m.key}
                  collapsed={collapsed}
                  onClick={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-border p-3">
        {!collapsed && demo !== null && (
          <div className="rounded-lg bg-foreground/[0.04] px-3 py-2.5">
            <p className="text-[12.5px] font-medium">{demo ? "Demo workspace" : "Workspace"}</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-ash">
              {demo
                ? "Read-only. Nothing is saved; it ends with this tab."
                : "Signed in on this device."}
            </p>
          </div>
        )}
        <div className={`flex items-center gap-2 ${collapsed ? "flex-col" : ""}`}>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              endSession();
              navigate({ to: "/" });
            }}
            title="Sign out"
            className={`flex h-9 items-center gap-2 rounded-full border border-border px-3 text-[12.5px] text-foreground/75 transition-colors hover:bg-secondary hover:text-foreground ${
              collapsed ? "w-9 justify-center px-0" : "flex-1"
            }`}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            {!collapsed && "Sign out"}
          </button>
        </div>
        {!collapsed && (
          <Link
            to="/"
            className="flex items-center gap-1 px-1 pt-1 text-[11.5px] text-ash hover:text-foreground"
          >
            Back to the website <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}

/**
 * The one frame every feature opens in: a sidebar with every tool, the theme
 * switch and the session, and the feature on the right. On phones the sidebar
 * becomes a drawer behind a top bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // Storage blocked: start expanded.
    }
  }, []);
  useEffect(() => setDrawer(false), [path]);

  const toggleCollapsed = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        // Not remembered.
      }
      return !c;
    });

  return (
    <div className="min-h-screen bg-background text-foreground lg:flex">
      {/* desktop sidebar */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 lg:flex ${
          collapsed ? "w-[68px]" : "w-[248px]"
        }`}
      >
        <div
          className={`flex h-14 items-center ${collapsed ? "justify-center" : "justify-between px-4"}`}
        >
          {!collapsed && <Logo to="/app" />}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid h-8 w-8 place-items-center rounded-md text-foreground/55 hover:bg-secondary hover:text-foreground"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </button>
        </div>
        <SidebarBody path={path} collapsed={collapsed} />
      </aside>

      {/* phone / tablet top bar and drawer */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur-xl lg:hidden">
        <Logo to="/app" />
        <button
          type="button"
          onClick={() => setDrawer(true)}
          aria-label="Open navigation"
          className="grid h-9 w-9 place-items-center rounded-full border border-border"
        >
          <Menu className="h-4 w-4" />
        </button>
      </div>
      {drawer && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawer(false)}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          />
          <div className="absolute inset-y-0 left-0 flex w-[min(300px,86vw)] flex-col border-r border-border bg-background">
            <div className="flex h-14 items-center justify-between px-4">
              <Logo to="/app" />
              <button
                type="button"
                onClick={() => setDrawer(false)}
                aria-label="Close navigation"
                className="grid h-8 w-8 place-items-center rounded-md hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <SidebarBody path={path} collapsed={false} onNavigate={() => setDrawer(false)} />
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
