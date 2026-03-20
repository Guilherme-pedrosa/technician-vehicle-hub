import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Truck,
  ClipboardCheck,
  Wrench,
  BarChart3,
  Settings,
  User,
  LogOut,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useEffect, useState } from "react";

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

interface MenuItem {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  badge?: number;
}

interface MenuGroup {
  label: string;
  items: MenuItem[];
  defaultOpen?: boolean;
}

const allMenuGroups: (MenuGroup & { adminOnly?: boolean; items: (MenuItem & { adminOnly?: boolean })[] })[] = [
  {
    label: "",
    items: [
      { title: "Dashboard", icon: LayoutDashboard, href: "/dashboard" },
    ],
    defaultOpen: true,
  },
  {
    label: "Operações",
    items: [
      { title: "Condutores", icon: Users, href: "/condutores", adminOnly: true },
      { title: "Veículos", icon: Truck, href: "/veiculos" },
      { title: "Checklist", icon: ClipboardCheck, href: "/checklist" },
      { title: "Chamados", icon: Wrench, href: "/chamados" },
    ],
    defaultOpen: true,
  },
  {
    label: "Análises",
    items: [
      { title: "Relatórios", icon: BarChart3, href: "/relatorios" },
    ],
    adminOnly: true,
  },
  {
    label: "Sistema",
    items: [
      { title: "Configurações", icon: Settings, href: "/configuracoes" },
    ],
    adminOnly: true,
  },
];

export function AppSidebar({ collapsed, onToggle, mobileOpen, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const { profile, signOut, isAdmin } = useAuth();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Filter menu groups based on role
  const menuGroups = allMenuGroups
    .filter((g) => !g.adminOnly || isAdmin)
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => !item.adminOnly || isAdmin),
    }))
    .filter((g) => g.items.length > 0);

  useEffect(() => {
    const newOpenGroups: Record<string, boolean> = {};
    menuGroups.forEach((group) => {
      if (group.defaultOpen) {
        newOpenGroups[group.label] = true;
      }
      if (group.items.some(item => location.pathname.startsWith(item.href))) {
        newOpenGroups[group.label] = true;
      }
    });
    setOpenGroups(newOpenGroups);
  }, [location.pathname, isAdmin]);

  useEffect(() => {
    onMobileClose?.();
  }, [location.pathname]);

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }));
  };

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
    : "FD";

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Header with Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-4">
        {(!collapsed || mobileOpen) ? (
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center">
              <Truck className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-sidebar-foreground tracking-tight">FleetDesk</h1>
              <p className="text-[11px] text-sidebar-foreground/60">Gestão de Frota</p>
            </div>
          </div>
        ) : (
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center mx-auto">
            <Truck className="w-5 h-5 text-primary-foreground" />
          </div>
        )}
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 py-4">
        <nav className="space-y-1 px-3">
          {menuGroups.map((group, groupIndex) => {
            const isOpen = openGroups[group.label] ?? false;

            return (
              <div key={groupIndex} className={cn(group.label && "mt-4")}>
                {/* Group label (collapsible) */}
                {group.label && (!collapsed || mobileOpen) && (
                  <button
                    onClick={() => toggleGroup(group.label)}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wider",
                      "text-sidebar-foreground/50 hover:text-sidebar-foreground/70 transition-colors"
                    )}
                  >
                    <span>{group.label}</span>
                    <ChevronDown
                      className={cn(
                        "h-3 w-3 transition-transform duration-200",
                        isOpen && "rotate-180"
                      )}
                    />
                  </button>
                )}

                {/* Menu items */}
                <ul
                  className={cn(
                    "space-y-0.5 overflow-hidden transition-all duration-200",
                    !group.label && "space-y-0.5",
                    group.label && (!collapsed || mobileOpen) && !isOpen && "max-h-0 opacity-0",
                    group.label && (!collapsed || mobileOpen) && isOpen && "max-h-[500px] opacity-100"
                  )}
                >
                  {group.items.map((item) => {
                    const isActive = location.pathname.startsWith(item.href);

                    return (
                      <li key={item.href}>
                        <NavLink
                          to={item.href}
                          className={cn(
                            "sidebar-item",
                            collapsed && !mobileOpen && "justify-center px-2",
                            isActive && "sidebar-item-active"
                          )}
                          title={collapsed && !mobileOpen ? item.title : undefined}
                        >
                          <item.icon className="h-4 w-4 flex-shrink-0" />
                          {(!collapsed || mobileOpen) && (
                            <>
                              <span className="flex-1 truncate text-[13px]">{item.title}</span>
                              {item.badge && item.badge > 0 && (
                                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                                  {item.badge}
                                </span>
                              )}
                            </>
                          )}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </ScrollArea>

      {/* Footer - User section */}
      <div className="border-t border-sidebar-border p-3">
        <NavLink
          to="/perfil"
          className={cn(
            "flex items-center gap-3",
            collapsed && !mobileOpen && "justify-center"
          )}
        >
          <Avatar className="h-9 w-9 flex-shrink-0">
            <AvatarFallback className="bg-sidebar-accent text-sidebar-foreground text-sm font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          {(!collapsed || mobileOpen) && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{profile?.full_name || "Meu Perfil"}</p>
              <p className="text-[11px] text-sidebar-foreground/60 truncate">{profile?.cargo || "Gestor"}</p>
            </div>
          )}
          {(!collapsed || mobileOpen) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent flex-shrink-0"
              onClick={(e) => { e.preventDefault(); signOut(); }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          )}
        </NavLink>
      </div>

      {/* Collapse toggle button */}
      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={mobileOpen ? onMobileClose : onToggle}
          className={cn(
            "w-full text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent",
            collapsed && !mobileOpen && "px-2"
          )}
        >
          {mobileOpen ? (
            <>
              <X className="h-4 w-4 mr-2" />
              <span>Fechar</span>
            </>
          ) : collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronLeft className="h-4 w-4 mr-2" />
              <span className="text-xs">Recolher menu</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 hidden md:flex h-screen flex-col bg-sidebar transition-all duration-200",
          collapsed ? "w-16" : "w-60"
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile sidebar (drawer) */}
      <aside
        className={cn(
          "fixed left-0 top-0 z-50 flex md:hidden h-screen w-72 flex-col bg-sidebar transition-transform duration-300 shadow-2xl",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
