import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { PERMISSION_CATALOG, PERMISSION_GROUPS, RETIRED_PERMISSIONS } from "@/lib/access/permissions";
import { ROLE_TEXTS } from "@/lib/access/texts";
import type { Role } from "@/lib/roles/roles";
import Roles from "@/pages/Roles";
import RoleForm from "./RoleForm";

// Critérios de UX da tela de Funções (E2.02, PR 3, tarefa 11): UX-01, UX-02,
// UX-03 e UX-29 (parte do badge) no que o jsdom mede. Os de layout e de medida
// real (UX-04, 06, 07) ficam em e2e/funcoes.spec.ts. UX-05 já está em RoleFlows.test.tsx.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterAll(() => vi.unstubAllGlobals());

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
beforeEach(() => resetFakeSupabase());
afterEach(() => setWidth(originalWidth));

const ALL_ACTIVE = PERMISSION_CATALOG.map((p) => p.value);
const TECHNICAL = /\b(view|create|edit|delete|manage|assign|submit|change)_[a-z_]+\b|row-level|42501/;

const role = (overrides: Partial<Role>): Role => ({
  id: "r",
  name: "Função",
  description: null,
  isProtected: false,
  isDefault: false,
  permissions: [],
  membersCount: 0,
  updatedAt: "2026-11-25T12:00:00+00:00",
  ...overrides,
});

function renderForm(target: Role | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RoleForm role={target} roles={[target ?? role({})]} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("UX-01: as 22 permissões, nos 5 grupos, com os rótulos novos", () => {
  it("Dado o formulário, então há 22 checkboxes em 5 fieldsets, na ordem da T3", () => {
    setWidth(1280);
    renderForm(role({ id: "x", name: "X" }));
    const dialog = screen.getByRole("dialog");
    const groups = within(dialog).getAllByRole("group").filter((g) => g.tagName === "FIELDSET");
    expect(groups.map((g) => within(g).getByText(/./, { selector: "legend" }).textContent)).toEqual(
      PERMISSION_GROUPS.map((g) => g.label),
    );
    expect(PERMISSION_GROUPS.map((g) => g.label)).toEqual([
      "O que a pessoa vê",
      "Membros",
      "Células",
      "Relatórios",
      "Funções e auditoria",
    ]);
    const boxes = within(dialog).getAllByRole("checkbox");
    expect(boxes).toHaveLength(22);
    expect(ALL_ACTIVE).toHaveLength(22);
    // A ordem do DOM é a do catálogo.
    const labels = boxes.map((box) => (box.id ? dialog.querySelector(`label[for="${box.id}"]`)?.textContent : null));
    expect(labels).toEqual(PERMISSION_CATALOG.map((p) => p.label));
  });

  it("não mostra o rótulo do legado, a permissão aposentada nem identificador técnico", () => {
    setWidth(1280);
    renderForm(role({ id: "x", name: "X" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).not.toHaveTextContent("(legado)");
    expect(dialog).not.toHaveTextContent("Visualizar Dashboard do seu ministério");
    expect(dialog.textContent ?? "").not.toMatch(TECHNICAL);
    for (const retired of RETIRED_PERMISSIONS) expect(dialog.innerHTML).not.toContain(retired);
  });

  it("na lista, os badges de permissão não mostram identificador técnico, nem as aposentadas", async () => {
    setWidth(360);
    respondWith({
      data: [
        {
          id: "lid",
          name: "Líder",
          description: null,
          is_protected: false,
          is_default: false,
          permissions: ["view_members", "view_own_ministry_dashboard", ...ALL_ACTIVE],
          members_count: 1,
          updated_at: "2026-11-25T12:00:00+00:00",
        },
      ],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Roles />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("Líder");
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.showPermissions }));
    expect(container.textContent ?? "").not.toMatch(TECHNICAL);
    expect(container).not.toHaveTextContent("(legado)");
    expect(container).toHaveTextContent("22 permissões");
  });
});

describe("UX-02: Administrador sem ações, com cadeado decorativo", () => {
  const rows = [
    { id: "adm", name: "Administrador", description: "x", is_protected: true, is_default: false, permissions: [], members_count: 1, updated_at: "2026-11-25T12:00:00+00:00" },
  ];
  for (const width of [360, 1280]) {
    it(`a ${width}px: sem Editar, Excluir nem ⋯, com a frase e o cadeado aria-hidden`, async () => {
      setWidth(width);
      respondWith({ data: rows });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { container } = render(
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <Roles />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await screen.findByText("Administrador");
      expect(screen.queryByRole("button", { name: /Editar a função|Ações da função|Excluir a função/ })).not.toBeInTheDocument();
      expect(screen.getByText(ROLE_TEXTS.adminDescription)).toBeInTheDocument();
      const lock = container.querySelector("svg.lucide-lock");
      expect(lock).not.toBeNull();
      expect(lock).toHaveAttribute("aria-hidden", "true");
    });
  }
});

describe("UX-03: a permissão inteira é clicável e a dica é lida com o checkbox", () => {
  it("a linha tem 44 px no celular, o rótulo cobre a linha e a dica liga ao checkbox", () => {
    setWidth(360);
    renderForm(role({ id: "x", name: "X" }));
    const withHint = PERMISSION_CATALOG.filter((p) => p.hint);
    expect(withHint.length).toBeGreaterThan(0);
    for (const info of PERMISSION_CATALOG) {
      const label = screen.getByText(info.label, { selector: "label" });
      expect(label.className, info.label).toContain("after:absolute");
      expect(label.className).toContain("after:inset-0");
      const row = label.closest("div.relative") as HTMLElement;
      expect(row.className, info.label).toContain("min-h-11");
      const box = screen.getByLabelText(info.label);
      if (info.hint) {
        const hintId = box.getAttribute("aria-describedby");
        expect(hintId, info.label).toBeTruthy();
        expect(document.getElementById(hintId as string)).toHaveTextContent(info.hint);
      }
    }
  });

  it("tocar no rótulo marca e desmarca a permissão", () => {
    setWidth(360);
    renderForm(role({ id: "x", name: "X" }));
    const box = screen.getByLabelText(PERMISSION_CATALOG[0].label);
    expect(box).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByText(PERMISSION_CATALOG[0].label, { selector: "label" }));
    expect(box).toHaveAttribute("aria-checked", "true");
  });
});

describe("UX-29: o badge Padrão tem ícone e texto", () => {
  it("mostra o texto 'Padrão' junto de um ícone decorativo", async () => {
    setWidth(360);
    respondWith({
      data: [{ id: "mem", name: "Membro", description: null, is_protected: false, is_default: true, permissions: [], members_count: 0, updated_at: "2026-11-25T12:00:00+00:00" }],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <Roles />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const badge = await screen.findByText(ROLE_TEXTS.defaultBadge);
    const svg = (badge.closest("div,span") as HTMLElement).querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});
