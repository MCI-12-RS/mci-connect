import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import { NO_ACCESS, type Access } from "@/lib/access/access";
import { PERMISSION_CATALOG, type PermissionAction } from "@/lib/access/permissions";

// Menu lateral: itens por permissão (E2.02, RN-22 e UX-08), função embaixo do
// nome e "Meus dados" (UX-09), carregando (T1) e item ativo nas sub-rotas
// (E2.01, "Navegação e rotas", UX-18).

interface AuthState {
  access: Access | null;
  permissionsLoaded: boolean;
  accessLoadFailed: boolean;
  member: { id: string; name: string } | null;
}

const auth = vi.hoisted((): AuthState => ({ access: null, permissionsLoaded: true, accessLoadFailed: false, member: null }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signOut: vi.fn(), ...auth }),
}));

// O formulário de "Meus dados" só mostra se veio só para leitura.
vi.mock("@/components/MemberForm", () => ({
  default: ({ readOnly }: { readOnly?: boolean }) => <p>{readOnly ? "formulário só para leitura" : "formulário editável"}</p>,
}));

const ITEMS = ["Dashboard", "Membros", "Células", "Relatórios", "Ministérios", "Funções", "Auditoria"];

function persona(permissions: PermissionAction[], overrides: Partial<Access> = {}): Access {
  return { ...NO_ACCESS, member_id: "m-1", role_id: "r-1", role_name: "Função", permissions, ...overrides };
}

const RITA = persona(
  PERMISSION_CATALOG.map((p) => p.value),
  { role_name: "Administrador", role_is_protected: true, sees_whole_church: true },
);
const PEDRO = persona(
  [
    "view_dashboard",
    "view_own_ministry",
    "edit_own_data",
    "create_member",
    "edit_member",
    "delete_member",
    "create_cell",
    "edit_cell",
    "delete_cell",
    "submit_own_cell_report",
    "edit_cell_report",
    "delete_cell_report",
  ],
  { role_name: "Líder" },
);
const CAIO = persona(["view_dashboard", "view_own_ministry", "edit_own_data", "submit_own_cell_report"], { role_name: "Membro" });
const GABRIEL = persona(["view_own_reports"], { role_name: "Relatórios" });
const HUGO = persona([], { role_id: null, role_name: null });

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppSidebar />
    </MemoryRouter>,
  );
}

/** Os itens do menu que aparecem. */
const shownItems = () => ITEMS.filter((label) => screen.queryByRole("button", { name: label }));

/** Os itens do menu com aria-current="page". */
const currentItems = () =>
  shownItems().filter((label) => screen.getByRole("button", { name: label }).getAttribute("aria-current") === "page");

beforeEach(() => {
  auth.access = RITA;
  auth.permissionsLoaded = true;
  auth.accessLoadFailed = false;
  auth.member = { id: "m-1", name: "Rita Souza" };
});

describe("UX-08: itens do menu por pessoa", () => {
  it("Rita (Administrador) vê os 7 itens", () => {
    renderAt("/");
    expect(shownItems()).toEqual(ITEMS);
  });

  it.each([
    ["Pedro (Líder)", PEDRO],
    ["Caio (Membro)", CAIO],
  ])("%s vê Dashboard, Membros, Células, Relatórios e Ministérios", (_, access) => {
    auth.access = access;
    renderAt("/");
    expect(shownItems()).toEqual(["Dashboard", "Membros", "Células", "Relatórios", "Ministérios"]);
  });

  it("Gabriel (só Visualizar Relatórios do Seu Ministério) vê só Relatórios", () => {
    auth.access = GABRIEL;
    renderAt("/");
    expect(shownItems()).toEqual(["Relatórios"]);
  });

  it("uma função só com Enviar Relatório das Próprias Células vê Relatórios", () => {
    auth.access = persona(["submit_own_cell_report"]);
    renderAt("/");
    expect(shownItems()).toEqual(["Relatórios"]);
  });

  it("uma função só com Visualizar Toda a Igreja vê Ministérios", () => {
    auth.access = persona(["view_all_church"], { sees_whole_church: true });
    renderAt("/");
    expect(shownItems()).toContain("Ministérios");
  });

  it("Hugo (sem função) e a conta X (sem cadastro) não veem nenhum item", () => {
    auth.access = HUGO;
    renderAt("/");
    expect(shownItems()).toEqual([]);
  });

  it("enquanto o acesso carrega, 4 Skeleton no lugar dos itens", () => {
    auth.access = null;
    auth.permissionsLoaded = false;
    renderAt("/");
    expect(shownItems()).toEqual([]);
    expect(screen.getByTestId("menu-loading").children).toHaveLength(4);
  });

  it("se a primeira leitura falhou, nem itens nem Skeleton (o aviso fica na área principal)", () => {
    auth.access = null;
    auth.permissionsLoaded = false;
    auth.accessLoadFailed = true;
    renderAt("/");
    expect(screen.queryByTestId("menu-loading")).not.toBeInTheDocument();
    expect(shownItems()).toEqual([]);
  });
});

describe("UX-09: função embaixo do nome e Meus dados", () => {
  it("mostra a função e 'Editar meus dados' para quem edita o próprio cadastro", async () => {
    auth.access = CAIO;
    auth.member = { id: "m-1", name: "Caio Lima" };
    renderAt("/");
    expect(screen.getByText("Caio Lima")).toBeInTheDocument();
    expect(screen.getByTestId("menu-role")).toHaveTextContent("Membro");
    const button = screen.getByRole("button", { name: "Editar meus dados" });
    expect(button).toHaveClass("h-11", "w-11", "md:h-9", "md:w-9");
    fireEvent.click(button);
    expect(await screen.findByText("formulário editável")).toBeInTheDocument();
  });

  it("Hugo vê 'Sem função' e 'Ver meus dados', que abre Meus dados só para leitura", async () => {
    auth.access = HUGO;
    auth.member = { id: "m-1", name: "Hugo Melo" };
    renderAt("/");
    expect(screen.getByTestId("menu-role")).toHaveTextContent("Sem função");
    expect(screen.queryByRole("button", { name: "Editar meus dados" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ver meus dados" }));
    expect(await screen.findByRole("dialog", { name: "Meus dados" })).toBeInTheDocument();
    expect(screen.getByText("formulário só para leitura")).toBeInTheDocument();
  });

  it("a conta X (sem cadastro) não vê o bloco nem o botão", () => {
    auth.access = NO_ACCESS;
    auth.member = null;
    renderAt("/");
    expect(screen.queryByTestId("menu-role")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /meus dados/ })).not.toBeInTheDocument();
  });

  it("a função não usa opacidade nem corte (contraste e zoom, T1)", () => {
    renderAt("/");
    const role = screen.getByTestId("menu-role");
    expect(role).toHaveClass("text-xs", "text-sidebar-foreground");
    expect(role.className).not.toMatch(/opacity|truncate/);
  });
});

describe("UX-18 (E2.01): item ativo do menu nas sub-rotas", () => {
  it("Dado /members/deleted, então só 'Membros' fica ativo, com aria-current='page'", () => {
    renderAt("/members/deleted");
    expect(screen.getByRole("button", { name: "Membros" })).toHaveAttribute("aria-current", "page");
    expect(currentItems()).toEqual(["Membros"]);
  });

  it("Dado /cell-reports/deleted, então 'Relatórios' fica ativo, e 'Células' não", () => {
    renderAt("/cell-reports/deleted");
    expect(screen.getByRole("button", { name: "Relatórios" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Células" })).not.toHaveAttribute("aria-current");
    expect(currentItems()).toEqual(["Relatórios"]);
  });

  it("Dado /cells/deleted, então só 'Células' fica ativo, e o Dashboard (raiz) não", () => {
    renderAt("/cells/deleted");
    expect(currentItems()).toEqual(["Células"]);
    expect(screen.getByRole("button", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
  });

  it("Dado a própria lista (/members), então 'Membros' continua ativo", () => {
    renderAt("/members?q=Bruno&page=2");
    expect(currentItems()).toEqual(["Membros"]);
  });

  it("Dado a raiz, então só o Dashboard fica ativo", () => {
    renderAt("/");
    expect(currentItems()).toEqual(["Dashboard"]);
  });

  it("Dado uma rota que só começa com o mesmo texto (/membersx), então nenhum item acende", () => {
    renderAt("/membersx");
    expect(currentItems()).toEqual([]);
  });
});
