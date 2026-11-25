import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ChangeOwnPasswordDialog } from "./ChangeOwnPasswordDialog";

// "Alterar minha senha" (E2.03, T3): UX-08 (dados pessoais), UX-17, UX-18, UX-19 e UX-20.

const CAIO = { cpf: "52998224725", mobile_whatsapp: "51988887777", birth_date: "1990-03-15", email: "caio.lima@exemplo.com" };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ member: CAIO }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "token" } } }) } },
}));
const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

const fetchMock = vi.fn();
const onClose = vi.fn();

const current = () => screen.getByLabelText("Senha atual", { exact: true });
const newPassword = () => screen.getByLabelText("Nova senha", { exact: true });
const confirmation = () => screen.getByLabelText("Confirmar nova senha", { exact: true });
const save = () => screen.getByRole("button", { name: /Salvar nova senha|Salvando…/ });

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

async function submit(values: { current?: string; next?: string; confirm?: string } = {}) {
  const { current: c = "Caminho2024", next = "Abacate7", confirm = next } = values;
  fireEvent.change(current(), { target: { value: c } });
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
  onClose.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("T3", () => {
  it("UX-05, UX-16: ordem dos campos, o foco em 'Senha atual' e os atributos", () => {
    render(<ChangeOwnPasswordDialog onClose={onClose} />);
    expect(current()).toHaveFocus();
    expect(current()).toHaveAttribute("autocomplete", "current-password");
    expect(current()).toHaveAttribute("enterkeyhint", "next");
    const order = [current(), screen.getByTestId("password-rules"), newPassword(), confirmation()];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it("UX-08: os dados pessoais do próprio cadastro, sem ir ao servidor", async () => {
    render(<ChangeOwnPasswordDialog onClose={onClose} />);
    await submit({ next: "cpf529.982.247-25" });
    expect(
      screen.getByText("A senha não pode conter o seu CPF, o seu celular ou a sua data de nascimento, nem ser o seu e-mail."),
    ).toBeInTheDocument();
    await submit({ next: "Caminho2024" });
    expect(screen.getByText("A nova senha precisa ser diferente da atual.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("UX-08: os três vazios", async () => {
    render(<ChangeOwnPasswordDialog onClose={onClose} />);
    await submit({ current: "", next: "", confirm: "" });
    expect(screen.getByText("Informe a senha atual.")).toBeInTheDocument();
    expect(screen.getByText("Informe a nova senha.")).toBeInTheDocument();
    expect(screen.getByText("Confirme a nova senha.")).toBeInTheDocument();
    expect(current()).toHaveFocus();
  });

  it("UX-17: senha atual errada limpa só ela, com o foco e a ajuda a partir do primeiro erro", async () => {
    reply(422, { result: "current_password_invalid" });
    render(<ChangeOwnPasswordDialog onClose={onClose} />);
    expect(screen.queryByText("Se não lembra a senha atual, fale com o seu líder.")).toBeNull();
    await submit({ current: "Errada#2024" });
    expect(screen.getByText("A senha atual não confere.")).toBeInTheDocument();
    expect(screen.getByText("Se não lembra a senha atual, fale com o seu líder.")).toBeInTheDocument();
    expect(current()).toHaveValue("");
    expect(current()).toHaveFocus();
    expect(newPassword()).toHaveValue("Abacate7");
    expect(confirmation()).toHaveValue("Abacate7");
    const describedBy = current().getAttribute("aria-describedby") ?? "";
    expect(describedBy.split(" ")).toHaveLength(2);
  });

  it("UX-18: o bloqueio com {N}, com o foco e sem role=alert; some depois de {N} minutos", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    reply(429, { result: "change_blocked", retry_after_minutes: 1 });
    render(<ChangeOwnPasswordDialog onClose={onClose} />);
    await submit();
    const notice = screen.getByTestId("password-change-notice");
    expect(notice).toHaveTextContent("Muitas tentativas sem sucesso. Aguarde 1 minuto e tente de novo.");
    expect(notice).toHaveFocus();
    expect(notice).not.toHaveAttribute("role");
    expect(current()).toHaveValue("");
    expect(save()).toBeEnabled();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.queryByTestId("password-change-notice")).toBeNull();
  });

  it("UX-19: sucesso fecha com o toast do Negócio", async () => {
    reply(200, { result: "ok" });
    render(<ChangeOwnPasswordDialog onClose={onClose} />);
    await submit();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ mode: "voluntary", current_password: "Caminho2024" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({ title: "Senha alterada. Nos outros aparelhos, será preciso entrar de novo." });
  });

  it("UX-20: Cancelar e Esc fecham sem perguntar; durante o envio, nada fecha", async () => {
    let resolve: (value: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    const { unmount } = render(<ChangeOwnPasswordDialog onClose={onClose} />);
    fireEvent.change(current(), { target: { value: "Caminho2024" } });
    fireEvent.change(newPassword(), { target: { value: "Abacate7" } });
    fireEvent.change(confirmation(), { target: { value: "Abacate7" } });
    await act(async () => {
      fireEvent.click(save());
    });
    expect(save()).toHaveTextContent("Salvando…");
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.keyDown(current(), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => resolve(new Response(JSON.stringify({ result: "server_error" }), { status: 500 })));
    fireEvent.keyDown(current(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    render(<ChangeOwnPasswordDialog onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
