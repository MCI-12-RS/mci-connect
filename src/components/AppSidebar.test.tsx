import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AppSidebar from "./AppSidebar";

// Menu lateral nas sub-rotas (E2.01, "Navegação e rotas", UX-18): o item da
// lista fica ativo, com aria-current="page", também na lista de excluídos; a
// raiz só na raiz; e um prefixo que não é sub-rota não acende outro item.

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signOut: vi.fn(), hasPermission: () => true, member: null }),
}));

// O formulário de "Editar meus dados" não entra neste teste.
vi.mock("@/components/MemberForm", () => ({ default: () => null }));

const ITEMS = ["Dashboard", "Membros", "Células", "Relatórios", "Ministérios", "Funções", "Auditoria"];

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppSidebar />
    </MemoryRouter>,
  );
}

/** Os itens do menu com aria-current="page". */
const currentItems = () =>
  ITEMS.filter((label) => screen.getByRole("button", { name: label }).getAttribute("aria-current") === "page");

describe("UX-18: item ativo do menu nas sub-rotas", () => {
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
