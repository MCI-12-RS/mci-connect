import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteAccess } from "./NoAccess";
import { NO_ACCESS, type Access } from "@/lib/access/access";
import { supabase } from "@/integrations/supabase/client";

// Tela sem acesso (E2.02, T12, P13, UX-11): o título da rota, o aviso e "Ir
// para o início", sem redirecionar e sem montar a página (nenhuma consulta).

interface AuthState {
  access: Access | null;
  permissionsLoaded: boolean;
  accessLoadFailed: boolean;
}

const auth = vi.hoisted((): AuthState => ({ access: null, permissionsLoaded: true, accessLoadFailed: false }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signOut: vi.fn(), member: null, retryAccess: vi.fn(), ...auth }),
}));
vi.mock("@/components/AppSidebar", () => ({ default: () => null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));

const pageMounted = vi.fn();
function Page() {
  pageMounted();
  return <p>Lista de funções</p>;
}

function renderRoles() {
  render(
    <MemoryRouter initialEntries={["/roles"]}>
      <RouteAccess path="/roles" title="Funções">
        <Page />
      </RouteAccess>
    </MemoryRouter>,
  );
}

const PEDRO: Access = { ...NO_ACCESS, member_id: "m-pedro", role_id: "r-lider", role_name: "Líder", permissions: ["view_own_ministry"] };
const RITA: Access = { ...PEDRO, permissions: ["view_roles", "manage_roles"] };

describe("RouteAccess e NoAccess (T12)", () => {
  beforeEach(() => {
    pageMounted.mockClear();
    auth.access = PEDRO;
    auth.permissionsLoaded = true;
    auth.accessLoadFailed = false;
  });

  it("Pedro abre /roles: título, aviso e 'Ir para o início', sem montar a página", () => {
    renderRoles();

    expect(screen.getByRole("heading", { level: 1, name: "Funções" })).toBeInTheDocument();
    expect(screen.getByText("Você não tem acesso a esta tela.")).toBeInTheDocument();
    const home = screen.getByRole("link", { name: "Ir para o início" });
    expect(home).toHaveAttribute("href", "/");
    expect(home).toHaveClass("h-11");
    expect(pageMounted).not.toHaveBeenCalled();
    expect(screen.queryByText("Lista de funções")).not.toBeInTheDocument();
  });

  it("com permissão, monta a página", () => {
    auth.access = RITA;
    renderRoles();
    expect(screen.getByText("Lista de funções")).toBeInTheDocument();
    expect(screen.queryByTestId("no-access")).not.toBeInTheDocument();
  });

  it("enquanto o acesso não foi lido, não monta a página nem diz que não há acesso", () => {
    auth.access = null;
    auth.permissionsLoaded = false;
    renderRoles();
    expect(pageMounted).not.toHaveBeenCalled();
    expect(screen.queryByText("Você não tem acesso a esta tela.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Funções" })).toBeInTheDocument();
  });

  it("se a primeira leitura falhou, o aviso com 'Tentar de novo' fica no topo, sem a página", () => {
    auth.access = null;
    auth.permissionsLoaded = false;
    auth.accessLoadFailed = true;
    renderRoles();
    expect(
      screen.getByText("Não foi possível carregar o seu acesso. Verifique a conexão e tente de novo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(pageMounted).not.toHaveBeenCalled();
  });

  it("UX-11 e UX-30: sem permissão, nenhuma requisição de dados e nada técnico no DOM", () => {
    renderRoles();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    const text = screen.getByTestId("no-access").textContent ?? "";
    expect(text).not.toMatch(/view_|manage_|edit_|42501|row-level security|Líder|Administrador/i);
  });
});
