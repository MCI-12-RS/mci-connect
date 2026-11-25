import { Home, Users, Shield, LogOut, Network, LayoutGrid, ClipboardList, Menu, Pencil, History, Eye, type LucideIcon } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import logo from "@/assets/logo.png";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import MemberForm from "@/components/MemberForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isNavItemActive } from "@/lib/navigation";
import { menuItems, ownDataMode, roleDisplayName, type MenuItemKey } from "@/lib/access/access";
import { MENU_TEXTS, OWN_DATA_TEXTS } from "@/lib/access/texts";

const MENU_ICONS: Record<MenuItemKey, LucideIcon> = {
  dashboard: Home,
  members: Users,
  cells: LayoutGrid,
  reports: ClipboardList,
  ministries: Network,
  roles: Shield,
  events: History,
};

/** Quantos `Skeleton` o menu mostra enquanto o acesso carrega (T1). */
const LOADING_ITEMS = 4;

const AppSidebar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, member, access, permissionsLoaded, accessLoadFailed } = useAuth();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [ownDataOpen, setOwnDataOpen] = useState(false);

  // Os itens seguem as permissões (RN-22, UX-08); a função e "Meus dados", o
  // próprio acesso (RN-23, UXD-13, UXD-14). Sem cadastro, nada do rodapé.
  const items = menuItems(access);
  const ownData = ownDataMode(access);
  const ownDataLabel = ownData === "view" ? MENU_TEXTS.viewOwnData : MENU_TEXTS.editOwnData;
  const OwnDataIcon = ownData === "view" ? Eye : Pencil;

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
        {/* Falhou a primeira leitura: nenhum item, e o aviso fica na área principal (T12). */}
        {!permissionsLoaded && !accessLoadFailed ? (
          <div className="space-y-1" aria-busy="true" data-testid="menu-loading">
            {Array.from({ length: LOADING_ITEMS }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full bg-sidebar-accent/50" />
            ))}
          </div>
        ) : (
          items.map((item) => {
            // Também nas sub-rotas: /cell-reports/deleted acende "Relatórios" (UX-18 do E2.01).
            const isActive = isNavItemActive(location.pathname, item.path);
            const Icon = MENU_ICONS[item.key];
            return (
              <button
                key={item.path}
                onClick={() => handleNavigate(item.path)}
                aria-current={isActive ? "page" : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-left transition-colors ${isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                  }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {item.label}
              </button>
            );
          })
        )}
      </nav>

      <div className="p-3 border-t border-sidebar-border">
        {member && (
          <div className="px-3 py-2 mb-1 flex items-center gap-2">
            {/* Nome e função quebram linha, sem corte (UX-31); a função sem opacidade, pelo contraste (T1). */}
            <div className="min-w-0 flex-1 break-words">
              <p className="text-sm text-sidebar-foreground">{member.name}</p>
              {access?.member_id && (
                <p className="text-xs text-sidebar-foreground" data-testid="menu-role">
                  {roleDisplayName(access)}
                </p>
              )}
            </div>
            {ownData && (
              <Button
                variant="ghost"
                size="icon"
                className="h-11 w-11 shrink-0 md:h-9 md:w-9 text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                onClick={() => { setOwnDataOpen(true); setOpen(false); }}
                title={ownDataLabel}
                aria-label={ownDataLabel}
              >
                <OwnDataIcon className="w-4 h-4" aria-hidden="true" />
              </Button>
            )}
          </div>
        )}
        <button
          onClick={() => { signOut(); setOpen(false); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground transition-colors"
        >
          <LogOut className="w-4 h-4" aria-hidden="true" />
          {MENU_TEXTS.signOut}
        </button>
      </div>
    </div>
  );

  const ownDataDialog = member && ownData ? (
    <Dialog open={ownDataOpen} onOpenChange={setOwnDataOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
        <DialogHeader>
          <DialogTitle>{ownData === "view" ? OWN_DATA_TEXTS.title : OWN_DATA_TEXTS.editTitle}</DialogTitle>
        </DialogHeader>
        <MemberForm member={member} readOnly={ownData === "view"} onClose={() => setOwnDataOpen(false)} />
      </DialogContent>
    </Dialog>
  ) : null;

  if (isMobile) {
    return (
      <>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="fixed top-3 left-3 z-50 md:hidden" aria-label={MENU_TEXTS.openMenu}>
              <Menu className="w-5 h-5" aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-64 bg-sidebar border-sidebar-border">
            {sidebarContent}
          </SheetContent>
        </Sheet>
        {ownDataDialog}
      </>
    );
  }

  return (
    <>
      <aside className="w-64 min-h-screen flex flex-col border-r border-sidebar-border hidden md:flex">
        {sidebarContent}
      </aside>
      {ownDataDialog}
    </>
  );
};

export default AppSidebar;
