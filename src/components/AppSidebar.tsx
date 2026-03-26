import { Home, Users, Shield, LogOut, Network, LayoutGrid, ClipboardList } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/logo.png";

const AppSidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, hasPermission, member } = useAuth();

  const menuItems = [
    { icon: Home, label: "Dashboard", path: "/", permission: "view_dashboard" },
    { icon: Users, label: "Membros", path: "/members", permission: "view_members" },
    { icon: LayoutGrid, label: "Células", path: "/cells", permission: "view_members" },
    { icon: ClipboardList, label: "Relatórios de Células", path: "/cell-reports", permission: "view_members" },
    { icon: Network, label: "Ministérios", path: "/ministries", permission: "view_members" },
    { icon: Shield, label: "Funções", path: "/roles", permission: "view_roles" },
  ].filter((item) => hasPermission(item.permission));

  return (
    <aside className="w-64 min-h-screen bg-sidebar flex flex-col border-r border-sidebar-border">
      <div className="p-6 flex items-center gap-3">
        <img src={logo} alt="MCI" className="w-10 h-10 rounded-full" />
        <div>
          <h2 className="text-sidebar-primary-foreground font-bold text-lg leading-tight">MCI Connect</h2>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
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
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
