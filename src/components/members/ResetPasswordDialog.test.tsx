import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResetPasswordDialog, type ResetPasswordOutcome } from "./ResetPasswordDialog";

// "Redefinir senha" (E2.03, T6, P17): UX-22 a UX-29, com a RPC simulada.

type RpcResult = { data: unknown; error: unknown };
const rpc = vi.hoisted(() => ({ next: vi.fn<() => Promise<RpcResult>>(), calls: 0 }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => ({
      abortSignal: () => {
        rpc.calls += 1;
        return rpc.next();
      },
    }),
  },
}));

const CAIO = { id: "m-caio", name: "Caio Lima", gender: "M" };
const OK = { result: "ok", password: "k7m2x9pa", expires_at: "2026-12-06T02:50:00+00:00", reset_at: "2026-11-29T02:50:00+00:00" };

let client: QueryClient;
const onClose = vi.fn<(outcome: ResetPasswordOutcome) => void>();

function renderDialog() {
  return render(
    <QueryClientProvider client={client}>
      <ResetPasswordDialog member={CAIO} onClose={onClose} />
    </QueryClientProvider>,
  );
}

async function confirm() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Redefinir senha" }));
  });
}

beforeEach(() => {
  client = new QueryClient();
  rpc.next.mockReset();
  rpc.calls = 0;
  onClose.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("UX-22: a confirmação", () => {
  it("título, os quatro tópicos numa lista, os botões e o foco em Cancelar", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Redefinir a senha de Caio Lima?" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual([
      "A senha atual de Caio deixa de funcionar agora.",
      "Se Caio estiver conectado, terá que entrar de novo.",
      "Você vai receber uma senha temporária, válida por 7 dias, para passar a Caio.",
      "No próximo acesso, Caio cria uma nova senha.",
    ]);
    expect(screen.getByRole("button", { name: "Cancelar" })).toHaveFocus();
  });

  it("enquanto envia: 'Redefinindo…', os dois desabilitados, Esc não fecha, um pedido só", async () => {
    let resolve: (value: RpcResult) => void = () => {};
    rpc.next.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderDialog();
    const button = screen.getByRole("button", { name: "Redefinir senha" });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    // O TanStack Query avisa a mudança de estado no próximo ciclo.
    expect(await screen.findByRole("button", { name: "Redefinindo…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(rpc.calls).toBe(1);
    await act(async () => resolve({ data: OK, error: null }));
  });
});

describe("UX-23 a UX-26, UX-29: a senha temporária", () => {
  it("o foco no título, fora de input, em dois grupos, soletrada, com a validade de Brasília", async () => {
    rpc.next.mockResolvedValueOnce({ data: OK, error: null });
    renderDialog();
    await confirm();
    expect(screen.getByRole("heading", { name: "Senha temporária de Caio Lima" })).toHaveFocus();
    const visual = screen.getByTestId("temporary-password");
    expect(visual.tagName).toBe("P");
    expect(visual).toHaveAttribute("translate", "no");
    expect(visual).toHaveAttribute("aria-hidden", "true");
    expect(visual.textContent).toBe("k7m2x9pa");
    expect(Array.from(visual.children, (child) => child.textContent)).toEqual(["k7m2", "x9pa"]);
    expect(screen.getByText("Senha: k, 7, m, 2, x, 9, p, a.")).toHaveClass("sr-only");
    expect(screen.getByText("Válida até 05/12/2026 às 23:50.")).toBeInTheDocument();
    expect(screen.getByText("Ela não será mostrada de novo.").tagName).toBe("STRONG");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("UX-24: copia só a senha, troca o rótulo e anuncia; a falha seleciona e avisa", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    rpc.next.mockResolvedValueOnce({ data: OK, error: null });
    renderDialog();
    await confirm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copiar senha" }));
    });
    expect(writeText).toHaveBeenCalledWith("k7m2x9pa");
    expect(screen.getByRole("button", { name: "Senha copiada" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Senha copiada.");

    writeText.mockRejectedValueOnce(new Error("negado"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Senha copiada" }));
    });
    expect(screen.getByText("Não foi possível copiar. Selecione a senha para copiá-la.")).toBeInTheDocument();
  });

  it("UX-25: 'Compartilhar senha' só com navigator.share, só os 8 caracteres; desistir não é erro", async () => {
    rpc.next.mockResolvedValueOnce({ data: OK, error: null });
    renderDialog();
    await confirm();
    expect(screen.queryByRole("button", { name: "Compartilhar senha" })).toBeNull();
    cleanup();

    const share = vi.fn(async () => {
      throw new DOMException("cancelado", "AbortError");
    });
    vi.stubGlobal("navigator", { ...navigator, share });
    rpc.next.mockResolvedValueOnce({ data: OK, error: null });
    renderDialog();
    await confirm();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Compartilhar senha" }));
    });
    expect(share).toHaveBeenCalledWith({ text: "k7m2x9pa" });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("UX-26: Esc não fecha; Concluir fecha, devolve o horário e a senha sai do DOM e do cache", async () => {
    rpc.next.mockResolvedValueOnce({ data: OK, error: null });
    renderDialog();
    await confirm();
    fireEvent.keyDown(screen.getByRole("heading", { name: "Senha temporária de Caio Lima" }), { key: "Escape" });
    expect(screen.getByTestId("temporary-password")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Concluir" }));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onClose).toHaveBeenCalledWith({ kind: "reset", resetAt: OK.reset_at });
    expect(document.body.innerHTML).not.toContain("k7m2x9pa");
    expect(JSON.stringify(client.getMutationCache().getAll().map((m) => m.state.data))).not.toContain("k7m2x9pa");
  });
});

describe("UX-27, UX-28: recusas e conexão", () => {
  it.each([
    ["no_permission", {}, "Você não tem permissão para redefinir senhas."],
    ["rate_limited", { retry_after_minutes: 1 }, "Você redefiniu muitas senhas na última hora. Aguarde 1 minuto e tente de novo."],
    ["not_found", {}, "Este cadastro não existe ou já foi excluído."],
    ["self", {}, 'Para trocar a sua senha, use "Alterar minha senha".'],
    ["role_not_covered", {}, "Você não tem permissão para redefinir a senha deste membro."],
    ["no_account", {}, "Este membro não tem acesso ao sistema."],
  ])("%s: o bloqueio com o título, o texto e 'Fechar' com o foco", async (code, extra, text) => {
    rpc.next.mockResolvedValueOnce({ data: { result: "refused", code, message: "texto do servidor", ...extra }, error: null });
    renderDialog();
    await confirm();
    expect(screen.getByRole("heading", { name: "Não foi possível redefinir a senha" })).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByText("texto do servidor")).toBeNull();
    const close = screen.getByRole("button", { name: "Fechar" });
    expect(close).toHaveFocus();
    await act(async () => {
      fireEvent.click(close);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onClose).toHaveBeenCalledWith({ kind: "refused", code });
  });

  it.each([
    ["erro do banco", { data: null, error: { code: "XX000", message: "boom" } }],
    ["fora do contrato", { data: { result: "?" }, error: null }],
  ])("%s: a confirmação continua, com o Alert de conexão e o botão habilitado, sem senha", async (_label, response) => {
    rpc.next.mockResolvedValueOnce(response);
    renderDialog();
    await confirm();
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível redefinir a senha. Verifique a conexão e tente de novo.");
    expect(screen.getByRole("button", { name: "Redefinir senha" })).toBeEnabled();
    expect(screen.queryByTestId("temporary-password")).toBeNull();
  });
});
