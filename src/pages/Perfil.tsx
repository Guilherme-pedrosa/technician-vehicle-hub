import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { User } from "lucide-react";

export default function Perfil() {
  const { user, profile, roles } = useAuth();

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Meu Perfil</h1>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center">
              <User className="w-8 h-8 text-muted-foreground" />
            </div>
            <div>
              <CardTitle>{profile?.full_name || "Usuário"}</CardTitle>
              <p className="text-sm text-muted-foreground">{user?.email}</p>
              <div className="flex gap-2 mt-1">
                {roles.map((role) => (
                  <Badge key={role} variant="secondary">{role}</Badge>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div>
              <p className="text-sm text-muted-foreground">Cargo</p>
              <p className="font-medium">{profile?.cargo || "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
