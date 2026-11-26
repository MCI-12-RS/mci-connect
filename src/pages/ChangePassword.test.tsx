import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ChangePassword from "./ChangePassword";

// Troca obrigatória (E2.03, T2): UX-04 a UX-09 e UX-35, com a `change-own-password`
// simulada pelo `fetch`. O AuthContext e a sessão do Supabase são dublês.

const auth = vi.hoisted(() => ({
  completeForcedChange: vi.fn(async () => {}),
  recheckPasswordStatus: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } },
}));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

const fetchMock = vi.fn();

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/change-password"]}>
      <Routes>
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/" element={<p>Início</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const newPassword = () => screen.getByLabelText("Nova senha", { exact: true });
const confirmation = () => screen.getByLabelText("Confirmar nova senha", { exact: true });
const save = () => screen.getByRole("button", { name: /Salvar nova senha|Salvando…/ });

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

async function submitWith(next: string, confirm = next) {
  fireEvent.change(newPassword(), { target: { value: next } });
  fireEvent.change(confirmation(), { target: { value: confirm } });
  await act(async () => {
    fireEvent.click(save());
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  toastMock.mockReset();
  Object.values(auth).forEach((fn) => fn.mockClear());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UX-04, UX-05: a tela", () => {
  it("título com o foco, texto, campos, botões e nada de 'Senha atual'", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Crie uma nova senha" })).toHaveFocus();
    expect(screen.getByText(/Para continuar, crie uma nova senha\. Ela substitui/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Senha atual", { exact: true })).toBeNull();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(newPassword()).toHaveAttribute("autocomplete", "new-password");
    expect(newPassword()).toHaveAttribute("enterkeyhint", "next");
    expect(confirmation()).toHaveAttribute("autocomplete", "new-password");
    expect(confirmation()).toHaveAttribute("enterkeyhint", "done");
    expect(newPassword()).toHaveAttribute("passwordrules", "minlength: 8; maxlength: 72;");
  });
});

describe("UX-07: a regra ao vivo", () => {
  it("círculo vazio com 7, com check e '(regra atendida)' com 8; sem aria-live; ligada ao campo", () => {
    renderPage();
    const rules = screen.getByTestId("password-rules");
    expect(newPassword().getAttribute("aria-describedby")).toContain(rules.id);
    expect(rules.closest("[aria-live]")).toBeNull();
    fireEvent.change(newPassword(), { target: { value: "Abc1234" } });
    expect(rules.querySelector("[data-rule-met='false']")).not.toBeNull();
    expect(rules).not.toHaveTextContent("(regra atendida)");
    fireEvent.change(newPassword(), { target: { value: "Abc12345" } });
    expect(rules.querySelector("[data-rule-met='true']")).not.toBeNull();
    expect(rules).toHaveTextContent("(regra atendida)");
    // A regra fica entre o rótulo e o campo.
    expect(rules.compareDocumentPosition(newPassword()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("UX-06, UX-08: a conferência da tela", () => {
  it("Enter na nova senha com a confirmação vazia leva o foco à confirmação, sem mensagem nem requisição", () => {
    renderPage();
    fireEvent.change(newPassword(), { target: { value: "Abacate7" } });
    const event = fireEvent.keyDown(newPassword(), { key: "Enter" });
    expect(event).toBe(false);
    expect(confirmation()).toHaveFocus();
    expect(screen.queryByText(/Confirme a nova senha/)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("vazios: as mensagens de cada campo e o foco no primeiro", async () => {
    renderPage();
    await submitWith("", "");
    expect(screen.getByText("Informe a nova senha.")).toBeInTheDocument();
    expect(screen.getByText("Confirme a nova senha.")).toBeInTheDocument();
    expect(newPassword()).toHaveFocus();
    expect(newPassword()).toHaveAttribute("aria-invalid", "true");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["Abc1234", "A senha precisa ter pelo menos 8 caracteres."],
    ["A fé move montanhas e a paz acalma o coração no meio da tempestade!!!x", "A senha é longa demais."],
    ["11111111", "Esta senha é fácil de adivinhar. Escolha outra."],
    ["12345678", "Esta senha é fácil de adivinhar. Escolha outra."],
    ["87654321", "Esta senha é fácil de adivinhar. Escolha outra."],
    ["abcdefgh", "Esta senha é fácil de adivinhar. Escolha outra."],
    ["Senha123", "Esta senha é fácil de adivinhar. Escolha outra."],
    ["igreja@2024", "Esta senha é fácil de adivinhar. Escolha outra."],
  ])("%s: a mensagem embaixo da nova senha, os dois campos limpos e o foco na nova", async (value, text) => {
    renderPage();
    await submitWith(value);
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(newPassword()).toHaveValue("");
    expect(confirmation()).toHaveValue("");
    expect(newPassword()).toHaveFocus();
    expect(newPassword().getAttribute("aria-describedby")).toMatch(/error/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("confirmação diferente: só a confirmação é limpa e recebe o foco", async () => {
    renderPage();
    await submitWith("Abacate7", "Abacate8");
    expect(screen.getByText("As senhas não conferem.")).toBeInTheDocument();
    expect(newPassword()).toHaveValue("Abacate7");
    expect(confirmation()).toHaveValue("");
    expect(confirmation()).toHaveFocus();
  });

  it("nenhuma mensagem a cada tecla; a política aparece ao sair do campo", () => {
    renderPage();
    fireEvent.change(newPassword(), { target: { value: "1111111" } });
    fireEvent.change(newPassword(), { target: { value: "11111111" } });
    expect(screen.queryByText(/fácil de adivinhar/)).toBeNull();
    fireEvent.blur(newPassword());
    expect(screen.getByText("Esta senha é fácil de adivinhar. Escolha outra.")).toBeInTheDocument();
  });
});

describe("UX-09, UX-10: as respostas do servidor", () => {
  it("sucesso: tira a marca, vai para o início e mostra o toast", async () => {
    reply(200, { result: "ok" });
    renderPage();
    await submitWith("Abacate7");
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ mode: "forced", new_password: "Abacate7", confirmation: "Abacate7" });
    expect(body).not.toHaveProperty("current_password");
    expect(auth.completeForcedChange).toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith({ title: "Senha alterada. Use a nova senha da próxima vez que entrar." });
    expect(screen.getByText("Início")).toBeInTheDocument();
  });

  it("a política do servidor vai para a nova senha (a lista de senhas comuns é só dele)", async () => {
    reply(400, { result: "invalid", code: "password_weak", field: "new_password" });
    renderPage();
    await submitWith("Trustno1x");
    expect(screen.getByText("Esta senha é fácil de adivinhar. Escolha outra.")).toBeInTheDocument();
    expect(newPassword()).toHaveFocus();
  });

  it.each([
    [500, { result: "server_error" }],
    [502, null],
    [200, { result: "estranho", message: "texto técnico" }],
  ])("%s: o Alert de conexão, os campos mantidos, sem texto do servidor", async (status, body) => {
    reply(status, body);
    renderPage();
    await submitWith("Abacate7");
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível salvar a nova senha. Verifique a conexão e tente de novo.");
    expect(newPassword()).toHaveValue("Abacate7");
    expect(confirmation()).toHaveValue("Abacate7");
    expect(screen.queryByText("texto técnico")).toBeNull();
  });

  it("queda de conexão: o mesmo Alert", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage();
    await submitWith("Abacate7");
    expect(screen.getByRole("alert")).toHaveTextContent("Verifique a conexão");
  });

  it("DA-14: not_flagged relê a marca, sem toast", async () => {
    reply(403, { result: "not_flagged" });
    renderPage();
    await submitWith("Abacate7");
    expect(auth.recheckPasswordStatus).toHaveBeenCalled();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("o reenvio repete a mesma chave (AQ-5)", async () => {
    reply(500, { result: "server_error" });
    reply(200, { result: "ok", replayed: true });
    renderPage();
    await submitWith("Abacate7");
    await act(async () => {
      fireEvent.click(save());
    });
    const keys = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)).request_id);
    expect(keys[0]).toBe(keys[1]);
    expect(screen.getByText("Início")).toBeInTheDocument();
  });
});

describe("UX-35: Mostrar senha", () => {
  it("botão de 44 px, type=button, aria-label por campo, aria-pressed; devolve o foco e volta a ocultar no envio", async () => {
    reply(500, { result: "server_error" });
    renderPage();
    const show = screen.getByRole("button", { name: "Mostrar nova senha" });
    expect(show).toHaveAttribute("type", "button");
    expect(show).toHaveClass("h-11", "w-11");
    fireEvent.click(show);
    expect(newPassword()).toHaveAttribute("type", "text");
    expect(newPassword()).toHaveFocus();
    expect(screen.getByRole("button", { name: "Ocultar nova senha" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Mostrar confirmação da nova senha" })).toBeInTheDocument();
    await submitWith("Abacate7");
    expect(newPassword()).toHaveAttribute("type", "password");
  });
});

describe("Sair", () => {
  it("encerra a sessão sem perguntar", async () => {
    renderPage();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    });
    expect(auth.signOut).toHaveBeenCalled();
  });
});
