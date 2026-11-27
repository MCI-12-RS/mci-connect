import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteAccess } from "@/components/NoAccess";
import { NO_ACCESS, type Access } from "@/lib/access/access";
import { supabase } from "@/integrations/supabase/client";

// UX-26 e RN-18: sem "Visualizar Auditoria", a rota /events não monta a página e nenhuma
// requisição de eventos sai (a `events_view` responderia 42501).

const auth = vi.hoisted(() => ({ access: null as Access | null, permissionsLoaded: true, accessLoadFailed: false }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ signOut: vi.fn(), member: null, retryAccess: vi.fn(), ...auth }) }));
vi.mock("@/components/AppSidebar", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } } }));

const mounted = vi.fn();
function Page() {
  mounted();
  return <p>Eventos</p>;
}

const render_ = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <RouteAccess path="/events" title="Auditoria">
        <Page />
      </RouteAccess>
    </MemoryRouter>,
  );

const BRUNO: Access = { ...NO_ACCESS, member_id: "m-bruno", role_name: "Líder", permissions: ["view_own_ministry", "edit_member", "view_all_reports"] };

describe("UX-26: Auditoria sem permissão", () => {
  beforeEach(() => {
    mounted.mockClear();
    vi.clearAllMocks();
    auth.access = BRUNO;
    auth.permissionsLoaded = true;
  });

  it.each(["/events", "/events?record_type=member&record_id=aaaaaaaa-0000-4000-8000-000000000001"])(
    "Dado Bruno sem 'view_audit_log' abrindo %s, então a tela sem acesso, sem montar a página e sem nenhuma requisição",
    (url) => {
      render_(url);
      expect(screen.getByTestId("no-access")).toBeInTheDocument();
      expect(mounted).not.toHaveBeenCalled();
      expect(supabase.from).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it("Dado 'view_audit_log', então monta a página", () => {
    auth.access = { ...BRUNO, permissions: ["view_audit_log"] };
    render_("/events");
    expect(mounted).toHaveBeenCalled();
  });
});
