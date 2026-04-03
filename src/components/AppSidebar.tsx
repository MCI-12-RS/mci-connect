import { Home, Users, Shield, LogOut, Network, LayoutGrid, ClipboardList, Menu, X } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/logo.png";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const AppSidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, hasPermission, member } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const menuItems = [
    { icon: Home, label: "Dashboard", path: "/", permission: ["view_dashboard"] },
    { icon: Users, label: "Membros", path: "/members", permission: ["view_members", "view_all_church", "view_own_ministry"] },
    { icon: LayoutGrid, label: "Células", path: "/cells", permission: ["view_members", "view_all_church", "view_own_ministry"] },
    { icon: ClipboardList, label: "Relatórios", path: "/cell-reports", permission: ["view_all_reports", "view_own_reports", "view_members", "view_all_church", "view_own_ministry"] },
    { icon: Network, label: "Ministérios", path: "/ministries", permission: ["view_members", "view_own_ministry"] },
    { icon: Shield, label: "Funções", path: "/roles", permission: ["view_roles"] },
  ].filter((item) => hasPermission(...item.permission));

  const handleNavigate = (path: string) => {
    navigate(path);
    setOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      <div className="p-4 flex items-center gap-3">
        <img src={logo} alt="MCI" className="w-10 h-10 rounded-full" />
        <h2 className="text-sidebar-primary-foreground font-bold text-lg leading-tight">MCI Connect</h2>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => handleNavigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors ${isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                }`}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        <div className="px-3 py-2 text-xs text-sidebar-foreground opacity-70 truncate mb-1">
          {member?.name}
        </div>
        <button
          onClick={() => { signOut(); setOpen(false); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="fixed top-3 left-3 z-50 md:hidden">
            <Menu className="w-5 h-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="p-0 w-64 bg-sidebar border-sidebar-border">
          {sidebarContent}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside className="w-64 min-h-screen flex flex-col border-r border-sidebar-border hidden md:flex">
      {sidebarContent}
    </aside>
  );
};

export default AppSidebar;
