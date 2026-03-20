import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

// Routes that técnicos can access
const TECNICO_ROUTES = ["/dashboard", "/veiculos", "/checklist", "/chamados", "/perfil"];

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading, isAdmin, roles } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // Role-based route restriction for técnicos
  const isTecnico = roles.includes("tecnico") && !isAdmin;
  if (isTecnico) {
    const allowed = TECNICO_ROUTES.some((r) => location.pathname.startsWith(r));
    if (!allowed) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <>{children}</>;
}
