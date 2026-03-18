import { Search, User, LogOut, Settings, ChevronDown, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface AppHeaderProps {
  onMenuClick?: () => void;
  showMenuButton?: boolean;
}

const pageMeta: Record<string, { title: string; breadcrumb: string[] }> = {
  "/dashboard": { title: "Dashboard", breadcrumb: [] },
  "/condutores": { title: "Condutores", breadcrumb: ["Operações", "Condutores"] },
  "/veiculos": { title: "Veículos", breadcrumb: ["Operações", "Veículos"] },
  "/checklist": { title: "Checklist", breadcrumb: ["Operações", "Checklist"] },
  "/chamados": { title: "Chamados", breadcrumb: ["Operações", "Chamados"] },
  "/relatorios": { title: "Relatórios", breadcrumb: ["Análises", "Relatórios"] },
  "/perfil": { title: "Meu Perfil", breadcrumb: ["Configurações", "Perfil"] },
};

export function AppHeader({ onMenuClick, showMenuButton }: AppHeaderProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const currentPage = pageMeta[location.pathname] || { title: "Página", breadcrumb: [] };

  const initials = profile?.full_name
    ? profile.full_name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
    : "FD";

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-4 md:px-8">
      {/* Left side */}
      <div className="flex items-center gap-4 min-w-0">
        {showMenuButton && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onMenuClick}
            className="h-9 w-9 flex-shrink-0 -ml-2"
          >
            <Menu className="h-5 w-5" />
          </Button>
        )}

        <div className="min-w-0">
          <h1 className="text-h1 text-foreground truncate">{currentPage.title}</h1>
          {currentPage.breadcrumb.length > 0 && (
            <div className="breadcrumb hidden sm:flex">
              {currentPage.breadcrumb.map((item, index) => (
                <span key={index} className="flex items-center gap-2">
                  {index > 0 && <span className="breadcrumb-separator">›</span>}
                  <span className={index === currentPage.breadcrumb.length - 1 ? "breadcrumb-current" : ""}>
                    {item}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Center: Search */}
      <div className="hidden lg:flex flex-1 max-w-md mx-8">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar condutores, veículos, chamados..."
            className="w-full pl-10 bg-muted border-0 h-10"
          />
        </div>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0">
        <Button variant="ghost" size="icon" className="h-9 w-9 lg:hidden">
          <Search className="h-5 w-5 text-muted-foreground" />
        </Button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 px-2 h-9">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <ChevronDown className="h-4 w-4 text-muted-foreground hidden md:block" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{profile?.full_name || "Usuário"}</span>
                <span className="text-xs text-muted-foreground font-normal">{profile?.cargo || "Gestor"}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/perfil")}>
              <User className="mr-2 h-4 w-4" />
              Meu Perfil
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={signOut}>
              <LogOut className="mr-2 h-4 w-4" />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
