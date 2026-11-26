import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { RecordAuthorship } from "./RecordAuthorship";
import type { Authorship } from "@/lib/audit/authorship";

// E2.05, T1 e P30/P31 (UX-03, UX-05, UX-06, UX-07, T1 "Carregando" e "Erro ao carregar").

const permissions = new Set<string>();
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ hasPermission: (...perms: string[]) => perms.some((p) => permissions.has(p)) }),
}));

interface HookState {
  data?: Authorship | null;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
}
const hook: { state: HookState; calls: Array<[string, string | null, { enabled?: boolean } | undefined]> } = {
  state: { isPending: false, isError: false, refetch: vi.fn() },
  calls: [],
};
vi.mock("@/hooks/use-record-authorship", () => ({
  useRecordAuthorship: (entity: string, id: string | null, options?: { enabled?: boolean }) => {
    hook.calls.push([entity, id, options]);
    return hook.state;
  },
}));

const IGOR = "11111111-1111-1111-1111-111111111111";
const igor: Authorship = {
  created_at: "2026-11-18T22:40:00Z",
  created_by_kind: "member",
  created_by_name: "Bruno Lima",
  updated_at: "2026-11-20T13:15:00Z",
  updated_by_kind: "member",
  updated_by_name: "Ana Souza",
};

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderBlock(props: Partial<Parameters<typeof RecordAuthorship>[0]> = {}) {
  render(
    <MemoryRouter initialEntries={["/members"]}>
      <Routes>
        <Route
          path="/members"
          element={<RecordAuthorship entity="member" recordId={IGOR} recordName="Igor Nunes" {...props} />}
        />
        <Route path="/events" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  permissions.clear();
  hook.calls = [];
  hook.state = { data: igor, isPending: false, isError: false, refetch: vi.fn() };
});

describe("T1: o bloco de autoria", () => {
  it("as frases de cadastro e de alteração, com o autor só como texto (UX-05)", () => {
    renderBlock();
    const block = screen.getByTestId("record-authorship");
    expect(block).toHaveTextContent("Cadastrado por Bruno Lima em 18/11/2026 às 19:40");
    expect(block).toHaveTextContent("Alterado por Ana Souza em 20/11/2026 às 10:15");
    // Sem "Visualizar Auditoria", nenhum link nem botão no bloco.
    expect(within(block).queryAllByRole("link")).toHaveLength(0);
    expect(within(block).queryAllByRole("button")).toHaveLength(0);
    expect(hook.calls[0]).toEqual(["member", IGOR, { enabled: true }]);
  });

  it("com a autoria lida junto com o registro, não lê de novo", () => {
    hook.state = { isPending: true, isError: false, refetch: vi.fn() };
    renderBlock({ entity: "cell_report", recordName: "25/11/2026", authorship: { ...igor, updated_at: null, updated_by_kind: null } });
    expect(screen.getByTestId("record-authorship")).toHaveTextContent("Enviado por Bruno Lima em 18/11/2026 às 19:40");
    expect(screen.getByTestId("record-authorship")).not.toHaveTextContent("Alterado");
    expect(hook.calls[0][2]).toEqual({ enabled: false });
  });

  it("carregando: 2 linhas de Skeleton, sem texto", () => {
    hook.state = { isPending: true, isError: false, refetch: vi.fn() };
    renderBlock();
    expect(screen.getByTestId("authorship-loading").children).toHaveLength(2);
  });

  it("erro ao carregar: a mensagem e 'Tentar de novo', que lê de novo", () => {
    const refetch = vi.fn();
    hook.state = { isPending: false, isError: true, refetch };
    renderBlock();
    expect(screen.getByText("Não foi possível carregar quem cadastrou e quem alterou.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("o registro não veio (excluído ou fora do escopo): nada aparece", () => {
    hook.state = { data: null, isPending: false, isError: false, refetch: vi.fn() };
    renderBlock();
    expect(screen.queryByTestId("record-authorship")).not.toBeInTheDocument();
  });
});

describe("UX-06: 'Ver histórico'", () => {
  it("só com 'Visualizar Auditoria': um link para o histórico, com o nome no aria-label e 44 px no celular", () => {
    permissions.add("view_audit_log");
    renderBlock();
    const link = screen.getByRole("link", { name: "Ver histórico de Igor Nunes" });
    expect(link).toHaveAttribute("href", `/events?record_type=member&record_id=${IGOR}`);
    expect(link).toHaveTextContent("Ver histórico");
    expect(link.className).toContain("h-11");
  });

  it("os rótulos da célula e do relatório", () => {
    permissions.add("view_audit_log");
    renderBlock({ entity: "cell", recordName: "Carla Dias" });
    expect(screen.getByRole("link", { name: "Ver histórico da célula de Carla Dias" })).toBeInTheDocument();
  });

  it("sem alteração, abre o histórico direto", () => {
    permissions.add("view_audit_log");
    renderBlock({ isDirty: () => false });
    fireEvent.click(screen.getByRole("link", { name: "Ver histórico de Igor Nunes" }));
    expect(screen.getByTestId("where")).toHaveTextContent(`/events?record_type=member&record_id=${IGOR}`);
  });
});

describe("UX-07: com alterações, 'Descartar as alterações?' antes do histórico", () => {
  it("'Continuar editando' mantém; 'Descartar' abre o histórico", async () => {
    permissions.add("view_audit_log");
    renderBlock({ isDirty: () => true });
    fireEvent.click(screen.getByRole("link", { name: "Ver histórico de Igor Nunes" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Descartar as alterações?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continuar editando" }));
    expect(screen.queryByTestId("where")).not.toBeInTheDocument();
    expect(screen.getByTestId("record-authorship")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "Ver histórico de Igor Nunes" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar" }));
    expect(await screen.findByTestId("where")).toHaveTextContent(`/events?record_type=member&record_id=${IGOR}`);
  });
});
