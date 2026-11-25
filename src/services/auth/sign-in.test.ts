import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestSignIn } from "./sign-in";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("requestSignIn", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_teste");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("envia a identificação e a senha como digitadas, só com a chave pública", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { result: "invalid_credentials" }));
    const result = await requestSignIn(" Ana@Exemplo.com ", "  senha com espaços ");
    expect(result).toEqual({ result: "invalid_credentials" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://exemplo.supabase.co/functions/v1/sign-in");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({ "Content-Type": "application/json", apikey: "sb_publishable_teste" });
    expect(JSON.parse(String(init?.body))).toEqual({ identifier: " Ana@Exemplo.com ", password: "  senha com espaços " });
  });

  it("lê o bloqueio com os minutos", async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { result: "locked", retry_after_minutes: 3 }));
    expect(await requestSignIn("a@b.c", "x")).toEqual({ result: "locked", minutes: 3 });
  });

  it("rede fora do ar é server_error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await requestSignIn("a@b.c", "x")).toEqual({ result: "server_error" });
  });

  it("5xx e corpo que não é JSON são server_error", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { result: "server_error" }));
    expect(await requestSignIn("a@b.c", "x")).toEqual({ result: "server_error" });
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad Gateway</html>", { status: 502 }));
    expect(await requestSignIn("a@b.c", "x")).toEqual({ result: "server_error" });
  });

  it("o tempo-limite aborta a chamada e vira server_error", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const pending = requestSignIn("a@b.c", "x", { timeoutMs: 20_000 });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ result: "server_error" });
  });
});
