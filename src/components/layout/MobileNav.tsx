import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Truck,
  ClipboardCheck,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

const mobileItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Home" },
  { to: "/condutores", icon: Users, label: "Condutores" },
  { to: "/veiculos", icon: Truck, label: "Veículos" },
  { to: "/checklist", icon: ClipboardCheck, label: "Checklist" },
  { to: "/chamados", icon: Wrench, label: "Chamados" },
];

export function MobileNav() {
  const location = useLocation();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border">
      <div className="flex items-center justify-around py-2">
        {mobileItems.map((item) => {
          const isActive = location.pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              <item.icon className="w-5 h-5" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
