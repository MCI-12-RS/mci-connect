import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { SignInOutcome } from "@/lib/auth/sign-in-result";
import { LOGIN_TEXTS, lockedMessage } from "@/lib/auth/session";
import { requestSignIn } from "@/services/auth/sign-in";
import Login from "./Login";

// Tela de login (E1.04, PR 2): UX-01, 02, 04, 05, 06, 07, 08, 09, 11, 12, 13 e 19.
// O `signIn` do AuthContext é trocado por um dublê; no UX-07 ele passa pelo
// serviço de verdade (`requestSignIn`), com o `fetch` simulado.

const signInMock = vi.fn<(identifier: string, password: string) => Promise<SignInOutcome>>();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signIn: signInMock }),
}));

const EMAIL = "ana@teste.invalid";
const MOBILE = "(51) 98888-7777";

function renderLogin(state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: "/login", state }]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<p>Início</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const identifierInput = () => screen.getByLabelText("Identificação");
const passwordInput = () => screen.getByLabelText("Senha", { exact: true });
const submitButton = () => screen.getByRole("button", { name: /Entrar|Entrando/ });
const showPasswordButton = () => screen.getByRole("button", { name: /(Mostrar|Ocultar) senha/ });
const message = () => document.getElementById("login-message");

function fill(identifier: string, password: string) {
  fireEvent.change(identifierInput(), { target: { value: identifier } });
  fireEvent.change(passwordInput(), { target: { value: password } });
}

/** Toca em "Entrar" e espera a resposta do dublê. */
async function submit() {
  await act(async () => {
    fireEvent.click(submitButton());
  });
}

beforeEach(() => {
  signInMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("UX-01: campos vazios", () => {
  it("Dado identificação e senha vazias, quando toca em Entrar, então mostra a mensagem, marca os dois campos, foca o primeiro e não chama o servidor", async () => {
    renderLogin();
    await submit();

    expect(signInMock).not.toHaveBeenCalled();
    expect(message()).toHaveTextContent("Informe a identificação e a senha.");
    expect(identifierInput()).toHaveAttribute("aria-invalid", "true");
    expect(passwordInput()).toHaveAttribute("aria-invalid", "true");
    expect(identifierInput()).toHaveFocus();
    expect(message()).toHaveAttribute("role", "alert");
  });

  it("Dado a identificação só com espaços e a senha preenchida, então só a identificação é marcada e recebe o foco", async () => {
    renderLogin();
    fill("   ", "segredo");
    await submit();

    expect(signInMock).not.toHaveBeenCalled();
    expect(identifierInput()).toHaveAttribute("aria-invalid", "true");
    expect(passwordInput()).not.toHaveAttribute("aria-invalid");
    expect(identifierInput()).toHaveFocus();
  });

  it("Dado a identificação preenchida e a senha vazia, então a senha é marcada, recebe o foco e a identificação não é limpa", async () => {
    renderLogin();
    fill(EMAIL, "");
    await submit();

    expect(signInMock).not.toHaveBeenCalled();
    expect(passwordInput()).toHaveAttribute("aria-invalid", "true");
    expect(identifierInput()).not.toHaveAttribute("aria-invalid");
    expect(passwordInput()).toHaveFocus();
    expect(identifierInput()).toHaveValue(EMAIL);
  });

  it("Dado uma senha só com espaços, então ela é enviada como está (RN-09)", async () => {
    signInMock.mockResolvedValue({ result: "invalid_credentials" });
    renderLogin();
    fill(EMAIL, "   ");
    await submit();

    expect(signInMock).toHaveBeenCalledWith(EMAIL, "   ");
  });

  it("o formulário não usa a validação nativa do navegador (nenhum balão)", () => {
    renderLogin();
    expect(identifierInput().closest("form")).toHaveAttribute("novalidate");
  });
});

describe("UX-02: Enter nos campos", () => {
  it("Dado a senha vazia, quando dá Enter na identificação, então o foco vai para a senha, sem mensagem e sem requisição", () => {
    renderLogin();
    fireEvent.change(identifierInput(), { target: { value: EMAIL } });
    identifierInput().focus();

    const notPrevented = fireEvent.keyDown(identifierInput(), { key: "Enter" });

    expect(notPrevented).toBe(false);
    expect(passwordInput()).toHaveFocus();
    expect(message()).toBeNull();
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("Dado a senha preenchida, então o Enter na identificação não é interceptado e o formulário envia", async () => {
    signInMock.mockResolvedValue({ result: "invalid_credentials" });
    renderLogin();
    fill(EMAIL, "segredo");

    const notPrevented = fireEvent.keyDown(identifierInput(), { key: "Enter" });
    expect(notPrevented).toBe(true);

    await act(async () => {
      fireEvent.submit(identifierInput().closest("form") as HTMLFormElement);
    });
    expect(signInMock).toHaveBeenCalledTimes(1);
  });

  it("Dado a senha preenchida, o Enter na senha também não é interceptado", () => {
    renderLogin();
    fill(EMAIL, "segredo");
    expect(fireEvent.keyDown(passwordInput(), { key: "Enter" })).toBe(true);
  });
});

describe("UX-04: cada resposta substitui a mensagem", () => {
  it("Dado duas falhas seguidas com o mesmo texto, então o elemento é montado de novo (novo anúncio)", async () => {
    signInMock.mockResolvedValue({ result: "invalid_credentials" });
    renderLogin();
    fill(EMAIL, "errada");
    await submit();
    const first = message();
    expect(first).toHaveTextContent(LOGIN_TEXTS.invalidCredentials);

    fireEvent.change(passwordInput(), { target: { value: "errada2" } });
    await submit();
    const second = message();

    expect(second).toHaveTextContent(LOGIN_TEXTS.invalidCredentials);
    expect(second).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(document.querySelectorAll("#login-message")).toHaveLength(1);
  });

  it("Dado a mensagem anterior, enquanto envia, então ela continua no lugar até a resposta chegar e então é trocada", async () => {
    signInMock.mockResolvedValueOnce({ result: "invalid_credentials" });
    renderLogin();
    fill(EMAIL, "errada");
    await submit();
    expect(message()).toHaveTextContent(LOGIN_TEXTS.invalidCredentials);

    let resolve: (outcome: SignInOutcome) => void = () => {};
    signInMock.mockReturnValueOnce(new Promise<SignInOutcome>((r) => (resolve = r)));
    fireEvent.change(passwordInput(), { target: { value: "outra" } });
    await submit();

    expect(submitButton()).toBeDisabled();
    expect(message()).toHaveTextContent(LOGIN_TEXTS.invalidCredentials);

    await act(async () => resolve({ result: "locked", minutes: 5 }));
    expect(message()).toHaveTextContent(lockedMessage(5));
    expect(message()).not.toHaveTextContent(LOGIN_TEXTS.invalidCredentials);
  });
});

describe("UX-05 (componente): falha de credencial", () => {
  it("então a mensagem é role=alert, a identificação fica, a senha é limpa e recebe o foco", async () => {
    signInMock.mockResolvedValue({ result: "invalid_credentials" });
    renderLogin();
    fill(EMAIL, "errada");
    await submit();

    expect(message()).toHaveAttribute("role", "alert");
    expect(identifierInput()).toHaveValue(EMAIL);
    expect(passwordInput()).toHaveValue("");
    expect(passwordInput()).toHaveFocus();
  });
});

describe("UX-06: bloqueio por tentativas", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("Dado uma resposta com 15 minutos, então a mensagem traz o 15, a identificação fica, a senha é limpa e o foco vai para a mensagem, sem role", async () => {
    signInMock.mockResolvedValue({ result: "locked", minutes: 15 });
    renderLogin();
    fill(EMAIL, "errada");
    await submit();

    expect(message()).toHaveTextContent(lockedMessage(15));
    expect(message()).toHaveTextContent("Aguarde 15 minutos");
    expect(message()).not.toHaveAttribute("role");
    expect(message()).toHaveFocus();
    expect(identifierInput()).toHaveValue(EMAIL);
    expect(passwordInput()).toHaveValue("");
  });

  it("Dado 1 minuto, então o texto usa o singular", async () => {
    signInMock.mockResolvedValue({ result: "locked", minutes: 1 });
    renderLogin();
    fill(EMAIL, "errada");
    await submit();

    expect(message()).toHaveTextContent("Aguarde 1 minuto e tente");
    expect(message()).not.toHaveTextContent("1 minutos");
  });

  it("Dado o bloqueio, então Entrar continua habilitado e sem contagem regressiva", async () => {
    signInMock.mockResolvedValue({ result: "locked", minutes: 15 });
    renderLogin();
    fill(EMAIL, "errada");
    await submit();

    expect(submitButton()).toBeEnabled();
    expect(submitButton()).toHaveTextContent("Entrar");
    const before = message()?.textContent;
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(message()?.textContent).toBe(before);
  });

  it("Dado o bloqueio de 2 minutos, então a mensagem some depois de 2 minutos, sem anúncio, e não antes", async () => {
    signInMock.mockResolvedValue({ result: "locked", minutes: 2 });
    renderLogin();
    fill(EMAIL, "errada");
    await submit();

    await act(async () => vi.advanceTimersByTime(2 * 60_000 - 1));
    expect(message()).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(1));
    expect(message()).toBeNull();
    expect(document.querySelector('[role="alert"], [role="status"], [aria-live]')).toBeNull();
  });

  it("Dado uma nova tentativa durante o bloqueio, então a mensagem é a da nova resposta e a contagem reinicia", async () => {
    signInMock.mockResolvedValueOnce({ result: "locked", minutes: 2 });
    renderLogin();
    fill(EMAIL, "errada");
    await submit();

    await act(async () => vi.advanceTimersByTime(90_000));
    signInMock.mockResolvedValueOnce({ result: "locked", minutes: 10 });
    fireEvent.change(passwordInput(), { target: { value: "outra" } });
    await submit();
    expect(message()).toHaveTextContent("Aguarde 10 minutos");

    // O prazo da primeira resposta (2 min) passa sem derrubar a nova mensagem.
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(message()).toHaveTextContent("Aguarde 10 minutos");
    await act(async () => vi.advanceTimersByTime(9 * 60_000));
    expect(message()).toBeNull();
  });

  it("Dado o bloqueio e uma nova tentativa que não é bloqueio, então a mensagem de bloqueio sai", async () => {
    signInMock.mockResolvedValueOnce({ result: "locked", minutes: 5 });
    renderLogin();
    fill(EMAIL, "errada");
    await submit();

    signInMock.mockResolvedValueOnce({ result: "invalid_credentials" });
    fireEvent.change(passwordInput(), { target: { value: "outra" } });
    await submit();

    expect(message()).toHaveTextContent(LOGIN_TEXTS.invalidCredentials);
    expect(message()).not.toHaveTextContent("Aguarde");
  });
});

describe("UX-07: conexão, erro do servidor e tempo-limite", () => {
  beforeEach(() => {
    // O dublê passa pelo serviço de verdade, que fala com o `fetch`.
    signInMock.mockImplementation(async (identifier, password) => {
      const result = await requestSignIn(identifier, password);
      return result.result === "ok" ? { result: "ok", mustChangePassword: result.mustChangePassword } : result;
    });
  });

  async function expectConnectionMessage() {
    expect(message()).toHaveTextContent(LOGIN_TEXTS.connection);
    expect(message()).toHaveAttribute("role", "alert");
    expect(identifierInput()).toHaveValue(EMAIL);
    expect(passwordInput()).toHaveValue("segredo");
    expect(submitButton()).toBeEnabled();
    expect(submitButton()).toHaveTextContent("Entrar");
  }

  it("Dado o fetch rejeitado (sem rede), então mostra a mensagem de conexão, mantém os campos e não muda o foco", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderLogin();
    fill(EMAIL, "segredo");
    submitButton().focus();
    await submit();

    await expectConnectionMessage();
    expect(submitButton()).toHaveFocus();
  });

  it("Dado um erro 500 do servidor, então mostra a mensagem de conexão e mantém os campos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "boom" }), { status: 500 })));
    renderLogin();
    fill(EMAIL, "segredo");
    submitButton().focus();
    await submit();

    await expectConnectionMessage();
    expect(submitButton()).toHaveFocus();
  });

  it("Dado um 200 fora do contrato, então também é a mensagem de conexão (nada do servidor é exibido)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: "ok" }), { status: 200 })));
    renderLogin();
    fill(EMAIL, "segredo");
    await submit();

    await expectConnectionMessage();
  });

  it("Dado um servidor que não responde, então depois do tempo-limite (20 s) mostra a mensagem de conexão", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      ),
    );
    renderLogin();
    fill(EMAIL, "segredo");
    await submit();

    expect(submitButton()).toBeDisabled();
    await act(async () => vi.advanceTimersByTime(19_999));
    expect(submitButton()).toBeDisabled();
    await act(async () => vi.advanceTimersByTime(1));

    await expectConnectionMessage();
  });
});

describe("UX-08: envio", () => {
  it("Dado o envio em andamento, então o botão mostra Entrando…, fica desabilitado e um duplo toque gera uma só requisição", async () => {
    let resolve: (outcome: SignInOutcome) => void = () => {};
    signInMock.mockReturnValue(new Promise<SignInOutcome>((r) => (resolve = r)));
    renderLogin();
    fill(EMAIL, "segredo");

    await act(async () => {
      fireEvent.click(submitButton());
      fireEvent.click(submitButton());
      fireEvent.submit(identifierInput().closest("form") as HTMLFormElement);
    });

    expect(submitButton()).toHaveTextContent("Entrando…");
    expect(submitButton()).toBeDisabled();
    expect(signInMock).toHaveBeenCalledTimes(1);

    await act(async () => resolve({ result: "invalid_credentials" }));
    expect(submitButton()).toBeEnabled();
    expect(submitButton()).toHaveTextContent("Entrar");
  });

  it("Dado o sucesso, então vai para o início", async () => {
    signInMock.mockResolvedValue({ result: "ok", mustChangePassword: false });
    renderLogin();
    fill(EMAIL, "segredo");
    await submit();
    expect(screen.getByText("Início")).toBeInTheDocument();
  });
});

describe("UX-09: nenhum texto técnico e nenhum toast", () => {
  const FORBIDDEN = [/bloquead/i, /suspens/i, /não encontrad/i, /senha incorreta/i, /invalid login credentials/i];

  it("os textos da tela e as mensagens do bloqueio não têm as palavras proibidas", () => {
    const all = [...Object.values(LOGIN_TEXTS), lockedMessage(1), lockedMessage(15)];
    for (const text of all) for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
  });

  it("a mensagem de falha é a mesma para qualquer causa e não usa toast", async () => {
    signInMock.mockResolvedValue({ result: "invalid_credentials" });
    renderLogin();
    fill(EMAIL, "errada");
    await submit();

    expect(message()).toHaveTextContent("Usuário ou senha inválidos. Confira os dados e tente de novo.");
    expect(document.querySelector("[data-sonner-toast], [data-radix-toast-viewport], [role='region'][aria-label*='otification']")).toBeNull();
    for (const pattern of FORBIDDEN) expect(document.body.textContent ?? "").not.toMatch(pattern);
  });
});

describe("UX-11: indicador de tipo", () => {
  it("o indicador fica fora do rótulo, o nome do campo é só Identificação, sem aria-live, outline e motion-reduce", () => {
    renderLogin();
    expect(screen.queryByTestId("identifier-indicator")).toBeNull();
    fireEvent.change(identifierInput(), { target: { value: EMAIL } });

    const indicator = screen.getByTestId("identifier-indicator");
    expect(indicator).toHaveTextContent("E-mail");
    expect(indicator.closest("label")).toBeNull();
    expect(screen.getByLabelText("Identificação")).toBe(identifierInput());
    expect(screen.getByText("Identificação", { selector: "label" })).not.toHaveTextContent("E-mail");
    expect(indicator.closest("[aria-live]")).toBeNull();
    expect(indicator).not.toHaveAttribute("aria-live");
    expect(indicator).not.toHaveAttribute("role");
    // Badge variant="outline" (text-foreground, sem fundo) e animação desligada com motion-reduce.
    expect(indicator.className).toContain("text-foreground");
    expect(indicator.className).not.toContain("bg-primary");
    expect(indicator.className).toContain("motion-reduce:animate-none");
  });

  it.each([
    ["ana@teste.invalid", "E-mail"],
    ["51988887777", "Celular"],
    ["(51) 98888-7777", "Celular"],
    ["168.995.350-09", "CPF"],
  ])("o indicador de %s é %s", (typed, label) => {
    renderLogin();
    fireEvent.change(identifierInput(), { target: { value: typed } });
    expect(screen.getByTestId("identifier-indicator")).toHaveTextContent(label);
  });

  it("sem forma de identificação reconhecida, não há indicador", () => {
    renderLogin();
    fireEvent.change(identifierInput(), { target: { value: "ana.souza" } });
    expect(screen.queryByTestId("identifier-indicator")).toBeNull();
  });
});

describe("UX-12: atributos dos campos", () => {
  it("a identificação tem os atributos da T1, o rótulo e o placeholder", () => {
    renderLogin();
    const input = identifierInput();
    expect(input).toHaveAttribute("autocomplete", "username");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).toHaveAttribute("enterkeyhint", "next");
    expect(input).toHaveAttribute("placeholder", "CPF, celular ou e-mail");
    expect(input).toHaveAttribute("id", "login");
  });

  it("a senha tem os atributos da T1", () => {
    renderLogin();
    expect(passwordInput()).toHaveAttribute("autocomplete", "current-password");
    expect(passwordInput()).toHaveAttribute("enterkeyhint", "go");
    expect(passwordInput()).toHaveAttribute("type", "password");
    expect(passwordInput()).toHaveAttribute("id", "password");
  });
});

describe("UX-13: mostrar senha", () => {
  it("é um botão type=button de 44x44 px com aria-label e aria-pressed que acompanham o estado", () => {
    renderLogin();
    const toggle = showPasswordButton();
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle.className).toContain("h-11");
    expect(toggle.className).toContain("w-11");
    expect(toggle).toHaveAccessibleName("Mostrar senha");
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(showPasswordButton()).toHaveAccessibleName("Ocultar senha");
    expect(showPasswordButton()).toHaveAttribute("aria-pressed", "true");
    expect(passwordInput()).toHaveAttribute("type", "text");

    fireEvent.click(showPasswordButton());
    expect(showPasswordButton()).toHaveAccessibleName("Mostrar senha");
    expect(passwordInput()).toHaveAttribute("type", "password");
  });

  it("não envia o formulário e devolve o foco ao campo da senha", () => {
    renderLogin();
    fill(EMAIL, "segredo");
    fireEvent.click(showPasswordButton());

    expect(signInMock).not.toHaveBeenCalled();
    expect(message()).toBeNull();
    expect(passwordInput()).toHaveFocus();
  });

  it("o nome acessível 'Senha' (exato) é só o campo, não o botão", () => {
    renderLogin();
    expect(screen.getAllByLabelText("Senha", { exact: true })).toHaveLength(1);
    // No Playwright, `getByLabel("Senha")` casa sem diferenciar maiúsculas e acha o botão também (AQ-7).
  });

  it("a senha volta a ficar oculta a cada envio", async () => {
    signInMock.mockResolvedValue({ result: "invalid_credentials" });
    renderLogin();
    fill(EMAIL, "segredo");
    fireEvent.click(showPasswordButton());
    expect(passwordInput()).toHaveAttribute("type", "text");

    await submit();
    expect(passwordInput()).toHaveAttribute("type", "password");
    expect(showPasswordButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("a senha também volta a ficar oculta quando o envio é barrado pela tela", async () => {
    renderLogin();
    fill("", "");
    fireEvent.click(showPasswordButton());
    await submit();
    expect(passwordInput()).toHaveAttribute("type", "password");
  });
});

describe("UX-19: formato da identificação", () => {
  it.each(["9888-7777", "ana.souza"])(
    "Dado '%s' (nada reconhecido, sem @), quando toca em Entrar, então mostra o aviso de formato e não chama o servidor",
    async (typed) => {
      renderLogin();
      fill(typed, "segredo");
      expect(screen.queryByTestId("identifier-indicator")).toBeNull();
      await submit();

      expect(signInMock).not.toHaveBeenCalled();
      expect(message()).toHaveTextContent("Confira a identificação: use o CPF, o celular com DDD ou o e-mail.");
      expect(message()).toHaveAttribute("role", "alert");
      expect(message()?.querySelector("svg")).not.toBeNull();
      expect(identifierInput()).toHaveAttribute("aria-invalid", "true");
      expect(identifierInput()).toHaveAttribute("aria-describedby", "login-message");
      expect(identifierInput()).toHaveFocus();
      expect(identifierInput()).toHaveValue(typed);
      expect(passwordInput()).toHaveValue("segredo");
      expect(passwordInput()).not.toHaveAttribute("aria-invalid");
    },
  );

  it("Dado um texto com @, então a tentativa é sempre enviada, mesmo mal formado", async () => {
    signInMock.mockResolvedValue({ result: "invalid_credentials" });
    renderLogin();
    fill("ana@", "segredo");
    await submit();
    expect(signInMock).toHaveBeenCalledWith("ana@", "segredo");
  });

  it("Dado campos vazios e formato ruim, então os vazios são conferidos antes do formato", async () => {
    renderLogin();
    fill("ana.souza", "");
    await submit();
    expect(message()).toHaveTextContent("Informe a identificação e a senha.");
    expect(passwordInput()).toHaveFocus();
  });

  it("a identificação enviada é o texto digitado, sem normalizar (RN-09)", async () => {
    signInMock.mockResolvedValue({ result: "invalid_credentials" });
    renderLogin();
    fill(`  ${MOBILE}  `, "segredo");
    await submit();
    expect(signInMock).toHaveBeenCalledWith(`  ${MOBILE}  `, "segredo");
  });
});

describe("Sessão encerrada (T10 do E2.01)", () => {
  it("Dado o estado de navegação session_ended, então mostra o aviso com role=status, sem marcar campo nenhum", () => {
    renderLogin({ reason: "session_ended" });
    expect(message()).toHaveTextContent(LOGIN_TEXTS.sessionEnded);
    expect(message()).toHaveAttribute("role", "status");
    expect(identifierInput()).not.toHaveAttribute("aria-invalid");
  });

  it("sem o estado, não há mensagem", () => {
    renderLogin();
    expect(message()).toBeNull();
    expect(identifierInput()).not.toHaveFocus();
    expect(identifierInput()).not.toHaveAttribute("aria-describedby");
  });

  it("Dado o aviso, então o foco vai para a Identificação, descrita pelo aviso, para o leitor de tela lê-lo", () => {
    renderLogin({ reason: "session_ended" });
    expect(identifierInput()).toHaveFocus();
    expect(identifierInput()).toHaveAttribute("aria-describedby", "login-message");
    expect(passwordInput()).not.toHaveAttribute("aria-describedby");
  });

  it("Dado o aviso, então o estado sai do histórico (recarregar não o mostra de novo) e o aviso continua na tela", () => {
    function StateProbe() {
      const location = useLocation();
      return <p data-testid="nav-state">{JSON.stringify(location.state)}</p>;
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: "/login", state: { reason: "session_ended" } }]}>
        <Routes>
          <Route
            path="/login"
            element={
              <>
                <Login />
                <StateProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("nav-state")).toHaveTextContent("null");
    expect(message()).toHaveTextContent(LOGIN_TEXTS.sessionEnded);
  });

  it("Dado o aviso e uma tentativa que falha, então o aviso é trocado e a Identificação deixa de ser descrita por ele", async () => {
    signInMock.mockResolvedValue({ result: "invalid_credentials" });
    renderLogin({ reason: "session_ended" });
    fill(EMAIL, "errada");
    await submit();
    expect(message()).not.toHaveTextContent(LOGIN_TEXTS.sessionEnded);
    expect(identifierInput()).not.toHaveAttribute("aria-describedby");
  });
});

describe("E2.03: login (T1)", () => {
  it("UX-01: 'Esqueceu a senha? Fale com o seu líder.' abaixo de Entrar, num <p> sem link nem botão, com ou sem mensagem", async () => {
    renderLogin();
    const forgot = screen.getByText("Esqueceu a senha? Fale com o seu líder.");
    expect(forgot.tagName).toBe("P");
    expect(forgot.querySelector("a, button")).toBeNull();
    expect(submitButton().compareDocumentPosition(forgot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    signInMock.mockResolvedValueOnce({ result: "invalid_credentials" });
    fill(EMAIL, "errada");
    await submit();
    expect(screen.getByText("Esqueceu a senha? Fale com o seu líder.")).toBeInTheDocument();
  });

  it("UX-02: a senha não vira maiúscula nem é corrigida, também com 'Mostrar senha'; sem maxLength", () => {
    renderLogin();
    fireEvent.click(showPasswordButton());
    const input = passwordInput();
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("autocapitalize", "none");
    expect(input).toHaveAttribute("autocorrect", "off");
    expect(input).toHaveAttribute("spellcheck", "false");
    expect(input).not.toHaveAttribute("maxlength");
    expect(showPasswordButton()).toHaveAttribute("aria-controls", "password");
  });

  it("RN-08 b: com a marca, o login leva à troca obrigatória com a identificação no estado", async () => {
    signInMock.mockResolvedValue({ result: "ok", mustChangePassword: true });
    function Change() {
      const location = useLocation();
      return <p>troca {JSON.stringify(location.state)}</p>;
    }
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<Change />} />
        </Routes>
      </MemoryRouter>,
    );
    fill(EMAIL, "12345678");
    await submit();
    expect(screen.getByText(`troca {"username":"${EMAIL}"}`)).toBeInTheDocument();
  });
});
