import { describe, it, expect } from "vitest";
import { isNavItemActive, returnPathFrom, toReturnToState, withSearchParam } from "./navigation";

// Item ativo do menu lateral (UX-18) e o "← {Lista}" das listas de excluídos (UX-19).

describe("isNavItemActive", () => {
  it("a raiz fica ativa só na raiz", () => {
    expect(isNavItemActive("/", "/")).toBe(true);
    expect(isNavItemActive("/members", "/")).toBe(false);
    expect(isNavItemActive("/members/deleted", "/")).toBe(false);
  });

  it("os demais itens ficam ativos na rota e nas sub-rotas (UX-18)", () => {
    expect(isNavItemActive("/members", "/members")).toBe(true);
    expect(isNavItemActive("/members/deleted", "/members")).toBe(true);
    expect(isNavItemActive("/cell-reports/deleted", "/cell-reports")).toBe(true);
  });

  it("um prefixo que não é sub-rota não acende o item: /cell-reports não acende Células", () => {
    expect(isNavItemActive("/cell-reports", "/cells")).toBe(false);
    expect(isNavItemActive("/cell-reports/deleted", "/cells")).toBe(false);
    expect(isNavItemActive("/cells/deleted", "/cell-reports")).toBe(false);
  });
});

describe("returnPathFrom", () => {
  it("volta para a lista com a busca e a página de antes (UX-19)", () => {
    const state = toReturnToState("/members", "?q=ana&page=2");
    expect(returnPathFrom(state, "/members")).toBe("/members?q=ana&page=2");
    expect(returnPathFrom(toReturnToState("/members", ""), "/members")).toBe("/members");
  });

  it("por link direto, sem estado, vai para a lista sem parâmetros", () => {
    expect(returnPathFrom(null, "/members")).toBe("/members");
    expect(returnPathFrom(undefined, "/cells")).toBe("/cells");
    expect(returnPathFrom({ outro: 1 }, "/cells")).toBe("/cells");
    expect(returnPathFrom({ returnTo: 42 }, "/cells")).toBe("/cells");
  });

  it("ignora um endereço que não é o da própria lista", () => {
    expect(returnPathFrom({ returnTo: "/roles" }, "/members")).toBe("/members");
    expect(returnPathFrom({ returnTo: "/members/deleted?q=a" }, "/members")).toBe("/members");
    expect(returnPathFrom({ returnTo: "/cells?q=a" }, "/cell-reports")).toBe("/cell-reports");
    expect(returnPathFrom({ returnTo: "https://exemplo.com/members" }, "/members")).toBe("/members");
  });
});

describe("withSearchParam", () => {
  it("põe a busca na URL, com os caracteres codificados", () => {
    expect(withSearchParam("/members/deleted", "Quintino Reis")).toBe("/members/deleted?q=Quintino+Reis");
    expect(withSearchParam("/cell-reports", "Ana & Bia")).toBe("/cell-reports?q=Ana+%26+Bia");
  });
});
