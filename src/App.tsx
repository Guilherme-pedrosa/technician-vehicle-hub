import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/layout/AppLayout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Condutores from "./pages/Condutores";
import Veiculos from "./pages/Veiculos";
import Checklist from "./pages/Checklist";
import ChecklistDetail from "./pages/ChecklistDetail";
import Chamados from "./pages/Chamados";
import Relatorios from "./pages/Relatorios";
import Perfil from "./pages/Perfil";
import Configuracoes from "./pages/Configuracoes";
import EmailLogs from "./pages/EmailLogs";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route
              element={
                <ProtectedRoute>
                  <AppLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/condutores" element={<Condutores />} />
              <Route path="/veiculos" element={<Veiculos />} />
              <Route path="/checklist" element={<Checklist />} />
              <Route path="/checklist/:id" element={<ChecklistDetail />} />
              <Route path="/chamados" element={<Chamados />} />
              <Route path="/relatorios" element={<Relatorios />} />
              <Route path="/configuracoes" element={<Configuracoes />} />
              <Route path="/emails" element={<EmailLogs />} />
              <Route path="/perfil" element={<Perfil />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
