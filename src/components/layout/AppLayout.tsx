import { Outlet } from "react-router-dom";
import { AppSidebar } from "./AppSidebar";
import { MobileNav } from "./MobileNav";

export function AppLayout() {
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="flex-1 overflow-auto pb-20 md:pb-0">
        <Outlet />
      </main>
      <MobileNav />
    </div>
  );
}
