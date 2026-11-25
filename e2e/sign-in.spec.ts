import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// Tela de login com a rede interceptada (E1.04, PR 2): UX-01, 02, 03, 05, 07,
// 12, 14, 18 e 19. A função `sign-in` é simulada com `page.route`, então nenhum
// teste aqui depende do banco. O login de verdade (RN-01 a RN-04, RN-08, RN-13
// e RN-14) está em `sign-in-stack.spec.ts`.

// Sem animação: o fade-in do cartão distorce as medidas e o contraste medido pelo axe.
test.use({ reducedMotion: "reduce" });

const SIGN_IN = "**/functions/v1/sign-in";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

const MSG = {
  empty: "Informe a identificação e a senha.",
  format: "Confira a identificação: use o CPF, o celular com DDD ou o e-mail.",
  invalid: "Usuário ou senha inválidos. Confira os dados e tente de novo.",
  connection: "Não foi possível entrar. Verifique a conexão e tente de novo.",
  locked15: "Muitas tentativas sem sucesso. Aguarde 15 minutos e tente de novo. Se esqueceu a senha, fale com o seu líder.",
};

interface Fake {
  /** Corpos (e status) respondidos na ordem; o último se repete. */
  replies: Array<{ status: number; body: object } | "abort">;
  /** Os corpos enviados à função. */
  sent: Array<{ identifier: unknown; password: unknown }>;
}

/** Simula a função `sign-in`: responde às pré-verificações (OPTIONS) e conta as chamadas (POST). */
async function fakeSignIn(page: Page, ...replies: Fake["replies"]): Promise<Fake> {
  const fake: Fake = { replies, sent: [] };
  await page.route(SIGN_IN, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    fake.sent.push(JSON.parse(request.postData() ?? "{}"));
    const reply = fake.replies[Math.min(fake.sent.length - 1, fake.replies.length - 1)];
    if (reply === "abort") {
      await route.abort("connectionrefused");
      return;
    }
    await route.fulfill({
      status: reply.status,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify(reply.body),
    });
  });
  return fake;
}

const INVALID = { status: 401, body: { result: "invalid_credentials" } } as const;
const LOCKED = (minutes: number) => ({ status: 429, body: { result: "locked", retry_after_minutes: minutes } }) as const;

const identifier = (page: Page) => page.getByLabel("Identificação");
const password = (page: Page) => page.getByLabel("Senha", { exact: true });
const submit = (page: Page) => page.locator('button[type="submit"]');
const message = (page: Page) => page.locator("#login-message");

async function fillForm(page: Page, id: string, pw: string) {
  await identifier(page).fill(id);
  await password(page).fill(pw);
}

/** Nenhuma rolagem lateral: a página cabe na largura da tela. */
async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

async function height(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("sem caixa");
  return box.height;
}

test.describe("UX-01: campos vazios (rede interceptada)", () => {
  test("Dado campos vazios, quando toca em Entrar, então mostra a mensagem, marca os campos, foca o primeiro e não chama a sign-in", async ({
    page,
  }) => {
    const fake = await fakeSignIn(page, INVALID);
    await page.goto("/login");
    await submit(page).click();

    await expect(message(page)).toHaveText(MSG.empty);
    await expect(identifier(page)).toHaveAttribute("aria-invalid", "true");
    await expect(password(page)).toHaveAttribute("aria-invalid", "true");
    await expect(identifier(page)).toBeFocused();
    // Nenhum balão nativo do navegador.
    expect(await page.evaluate(() => document.querySelector("form")?.noValidate)).toBe(true);
    expect(fake.sent).toHaveLength(0);
  });

  test("Dado só a senha vazia, então o foco vai para a senha e nada é enviado", async ({ page }) => {
    const fake = await fakeSignIn(page, INVALID);
    await page.goto("/login");
    await identifier(page).fill("ana@teste.invalid");
    await submit(page).click();

    await expect(message(page)).toHaveText(MSG.empty);
    await expect(password(page)).toBeFocused();
    await expect(identifier(page)).not.toHaveAttribute("aria-invalid", "true");
    expect(fake.sent).toHaveLength(0);
  });
});

test.describe("UX-02: Enter nos campos (rede interceptada)", () => {
  test("Enter na identificação com a senha vazia leva o foco à senha, sem mensagem nem requisição", async ({ page }) => {
    const fake = await fakeSignIn(page, INVALID);
    await page.goto("/login");
    await identifier(page).fill("ana@teste.invalid");
    await identifier(page).press("Enter");

    await expect(password(page)).toBeFocused();
    await expect(message(page)).toHaveCount(0);
    expect(fake.sent).toHaveLength(0);
  });

  test("Com a senha preenchida, Enter na identificação e na senha envia", async ({ page }) => {
    const fake = await fakeSignIn(page, INVALID);
    await page.goto("/login");
    await fillForm(page, "ana@teste.invalid", "segredo");
    await identifier(page).press("Enter");
    await expect(message(page)).toHaveText(MSG.invalid);
    expect(fake.sent).toHaveLength(1);

    await password(page).fill("segredo2");
    await password(page).press("Enter");
    await expect.poll(() => fake.sent.length).toBe(2);
  });
});

test.describe("UX-03: o espaço único das mensagens (360x800)", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  const cases: Array<[string, (page: Page) => Promise<Fake | null>, string]> = [
    ["campos vazios", async () => null, MSG.empty],
    ["formato não reconhecido", async () => null, MSG.format],
    ["falha de credencial", (page) => fakeSignIn(page, INVALID), MSG.invalid],
    ["bloqueio", (page) => fakeSignIn(page, LOCKED(15)), MSG.locked15],
    ["conexão", (page) => fakeSignIn(page, "abort"), MSG.connection],
    ["erro do servidor", (page) => fakeSignIn(page, { status: 500, body: { error: "x" } }), MSG.connection],
  ];

  for (const [name, prepare, text] of cases) {
    test(`${name}: a mensagem fica acima de Identificação, com o foco na senha`, async ({ page }) => {
      await prepare(page);
      await page.goto("/login");
      if (name === "campos vazios") {
        await submit(page).click();
      } else if (name === "formato não reconhecido") {
        await fillForm(page, "9888-7777", "segredo");
        await submit(page).click();
      } else {
        await fillForm(page, "ana@teste.invalid", "segredo");
        await password(page).focus();
        await submit(page).click();
      }

      await expect(message(page)).toHaveText(text);
      await expect(page.locator("#login-message")).toHaveCount(1);
      const messageBox = await message(page).boundingBox();
      const labelBox = await page.getByText("Identificação", { exact: true }).boundingBox();
      if (!messageBox || !labelBox) throw new Error("sem caixa");
      expect(messageBox.y + messageBox.height).toBeLessThanOrEqual(labelBox.y);
      // O foco na senha não esconde a mensagem: ela segue na tela.
      await password(page).focus();
      await expect(message(page)).toBeInViewport();
    });
  }

  test("uma mensagem por vez: a seguinte substitui a anterior", async ({ page }) => {
    await fakeSignIn(page, INVALID, LOCKED(15));
    await page.goto("/login");
    await submit(page).click();
    await expect(message(page)).toHaveText(MSG.empty);
    await fillForm(page, "ana@teste.invalid", "x");
    await submit(page).click();
    await expect(message(page)).toHaveText(MSG.invalid);
    await expect(page.locator("#login-message")).toHaveCount(1);
    await password(page).fill("y");
    await submit(page).click();
    await expect(message(page)).toHaveText(MSG.locked15);
    await expect(page.locator("#login-message")).toHaveCount(1);
  });
});

test.describe("UX-05: falha de credencial (respostas simuladas)", () => {
  // Os casos a a g da RN-07 chegam à tela com o mesmo corpo: a tela mostra sempre o mesmo texto.
  const typed = ["ana.souza@teste.invalid", "(51) 90000-2001", "168.995.350-09", "ninguem@teste.invalid", "excluida@teste.invalid"];

  for (const id of typed) {
    test(`'${id}': mensagem única com role=alert, identificação mantida, senha limpa e com o foco`, async ({ page }) => {
      await fakeSignIn(page, INVALID);
      await page.goto("/login");
      await fillForm(page, id, "senha-errada");
      await submit(page).click();

      await expect(message(page)).toHaveText(MSG.invalid);
      await expect(message(page)).toHaveAttribute("role", "alert");
      await expect(identifier(page)).toHaveValue(id);
      await expect(password(page)).toHaveValue("");
      await expect(password(page)).toBeFocused();
    });
  }

  test("o corpo enviado é exatamente o digitado (RN-09), com espaços e máscara", async ({ page }) => {
    const fake = await fakeSignIn(page, INVALID);
    await page.goto("/login");
    await fillForm(page, "  (51) 98888-7777 ", " s e n h a ");
    await submit(page).click();
    await expect(message(page)).toHaveText(MSG.invalid);
    expect(fake.sent).toEqual([{ identifier: "  (51) 98888-7777 ", password: " s e n h a " }]);
  });
});

test.describe("UX-07: conexão e servidor (rede interceptada)", () => {
  for (const [name, reply] of [
    ["sem rede", "abort"],
    ["erro 500", { status: 500, body: { error: "x" } }],
    ["resposta fora do contrato", { status: 200, body: { result: "ok" } }],
  ] as const) {
    test(`${name}: mensagem de conexão, campos mantidos e botão habilitado`, async ({ page }) => {
      await fakeSignIn(page, reply);
      await page.goto("/login");
      await fillForm(page, "ana@teste.invalid", "segredo");
      await submit(page).click();

      await expect(message(page)).toHaveText(MSG.connection);
      await expect(identifier(page)).toHaveValue("ana@teste.invalid");
      await expect(password(page)).toHaveValue("segredo");
      await expect(submit(page)).toBeEnabled();
      await expect(submit(page)).toHaveText("Entrar");
    });
  }
});

test.describe("UX-12: atributos dos campos (E2E)", () => {
  test("os atributos da T1 estão no DOM real", async ({ page }) => {
    await page.goto("/login");
    await expect(identifier(page)).toHaveAttribute("autocomplete", "username");
    await expect(identifier(page)).toHaveAttribute("autocapitalize", "none");
    await expect(identifier(page)).toHaveAttribute("enterkeyhint", "next");
    await expect(identifier(page)).toHaveAttribute("placeholder", "CPF, celular ou e-mail");
    await expect(password(page)).toHaveAttribute("autocomplete", "current-password");
    await expect(password(page)).toHaveAttribute("enterkeyhint", "go");
  });
});

for (const viewport of [
  { width: 360, height: 800 },
  { width: 320, height: 568 },
]) {
  test.describe(`UX-14: ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("sem rolagem horizontal e com campos e botão de 44 px", async ({ page }) => {
      await page.goto("/login");
      await expectNoHorizontalScroll(page);
      expect(await height(identifier(page))).toBeGreaterThanOrEqual(44);
      expect(await height(password(page))).toBeGreaterThanOrEqual(44);
      expect(await height(submit(page))).toBeGreaterThanOrEqual(44);
      const toggle = page.getByRole("button", { name: "Mostrar senha" });
      const box = await toggle.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    });

    test("com a mensagem de bloqueio e o indicador, continua sem rolagem horizontal", async ({ page }) => {
      await fakeSignIn(page, LOCKED(15));
      await page.goto("/login");
      await fillForm(page, "168.995.350-09", "segredo");
      await submit(page).click();
      await expect(message(page)).toHaveText(MSG.locked15);
      await expectNoHorizontalScroll(page);
    });

    test("com a fonte em 200 %, nada é cortado na largura", async ({ page }) => {
      await fakeSignIn(page, LOCKED(15));
      await page.goto("/login");
      await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
      await fillForm(page, "168.995.350-09", "segredo");
      await submit(page).click();
      await expect(message(page)).toHaveText(MSG.locked15);
      await expectNoHorizontalScroll(page);
      const form = await page.locator("form").boundingBox();
      expect((form?.x ?? 0) + (form?.width ?? 0)).toBeLessThanOrEqual(viewport.width);
    });
  });
}

test.describe("UX-14: o botão Entrar com a mensagem de bloqueio (360x800)", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("com a mensagem de bloqueio, a mais longa, e o teclado fechado, Entrar fica visível sem rolar", async ({ page }) => {
    await fakeSignIn(page, LOCKED(15));
    await page.goto("/login");
    await fillForm(page, "168.995.350-09", "segredo");
    await submit(page).click();
    await expect(message(page)).toHaveText(MSG.locked15);

    await expect(submit(page)).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test("a tela usa min-h-dvh", async ({ page }) => {
    await page.goto("/login");
    const className = await page.locator("div.min-h-dvh").first().getAttribute("class");
    expect(className).toContain("min-h-dvh");
  });
});

test.describe("UX-19: formato não reconhecido (rede interceptada)", () => {
  for (const typed of ["9888-7777", "ana.souza"]) {
    test(`'${typed}': aviso de formato, sem requisição, foco na identificação e nada limpo`, async ({ page }) => {
      const fake = await fakeSignIn(page, INVALID);
      await page.goto("/login");
      await fillForm(page, typed, "segredo");
      await expect(page.getByTestId("identifier-indicator")).toHaveCount(0);
      await submit(page).click();

      await expect(message(page)).toHaveText(MSG.format);
      await expect(message(page)).toHaveAttribute("role", "alert");
      await expect(identifier(page)).toHaveAttribute("aria-invalid", "true");
      await expect(identifier(page)).toBeFocused();
      await expect(identifier(page)).toHaveValue(typed);
      await expect(password(page)).toHaveValue("segredo");
      expect(fake.sent).toHaveLength(0);
    });
  }

  test("com '@', a tentativa é enviada, mesmo mal formada", async ({ page }) => {
    const fake = await fakeSignIn(page, INVALID);
    await page.goto("/login");
    await fillForm(page, "ana@", "segredo");
    await submit(page).click();
    await expect(message(page)).toHaveText(MSG.invalid);
    expect(fake.sent).toEqual([{ identifier: "ana@", password: "segredo" }]);
  });
});

test.describe("UX-10: indicador de tipo nunca faz requisição", () => {
  test("digitar CPF, celular e e-mail só mostra o indicador, sem chamar a sign-in", async ({ page }) => {
    const fake = await fakeSignIn(page, INVALID);
    let backendCalls = 0;
    page.on("request", (request) => {
      if (/\/(functions|rest|auth)\/v1\//.test(request.url())) backendCalls++;
    });
    await page.goto("/login");
    const before = backendCalls;
    for (const [typed, label] of [
      ["000.000.001-91", "CPF"],
      ["168.995.350-09", "CPF ou celular"],
      ["(51) 98888-7777", "Celular"],
      ["ana@teste.invalid", "E-mail"],
    ] as const) {
      await identifier(page).fill(typed);
      await expect(page.getByTestId("identifier-indicator")).toHaveText(label);
    }
    expect(fake.sent).toHaveLength(0);
    expect(backendCalls).toBe(before);
  });
});

test.describe("UX-18: contraste e acessibilidade (axe)", () => {
  async function scan(page: Page, scope?: string[]) {
    let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]);
    for (const selector of scope ?? []) builder = builder.include(selector);
    const results = await builder.analyze();
    return results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} :: ${n.any[0]?.message ?? ""}`).join(" | ")}`,
    );
  }

  // O que o UX-18 mede: o texto da mensagem (4,5:1), o ícone (3:1) e o indicador (4,5:1).
  const UX18_SCOPE = ["#login-message", '[data-testid="identifier-indicator"]'];

  for (const theme of ["light", "dark"] as const) {
    test.describe(`tema ${theme}`, () => {
      const setTheme = async (page: Page) => {
        await page.goto("/login");
        await page.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
      };

      test("formulário limpo, com o indicador", async ({ page }) => {
        await setTheme(page);
        await identifier(page).fill("168.995.350-09");
        await expect(page.getByTestId("identifier-indicator")).toBeVisible();
        expect(await scan(page, UX18_SCOPE)).toEqual([]);
      });

      for (const [name, reply, typed, text] of [
        ["campos vazios", null, "", MSG.empty],
        ["falha de credencial", INVALID, "ana@teste.invalid", MSG.invalid],
        ["bloqueio", LOCKED(15), "ana@teste.invalid", MSG.locked15],
        ["conexão", "abort", "ana@teste.invalid", MSG.connection],
      ] as const) {
        test(`mensagem de ${name}`, async ({ page }) => {
          if (reply) await fakeSignIn(page, reply);
          await setTheme(page);
          if (typed) await fillForm(page, typed, "segredo");
          await submit(page).click();
          await expect(message(page)).toHaveText(text);
          expect(await scan(page, ["#login-message"])).toEqual([]);
        });
      }

      // A tela inteira: o botão "Entrar" (bg-primary + text-primary-foreground) no tema escuro fica
      // com 2,97:1, abaixo dos 4,5:1. Fora do UX-18, mas é achado: ver o relatório do QA.
      test(`tela inteira (axe, WCAG AA)${theme === "dark" ? " [achado: botão Entrar no tema escuro]" : ""}`, async ({ page }) => {
        test.fail(theme === "dark", "contraste do botão primário no tema escuro (token --primary)");
        await setTheme(page);
        await fillForm(page, "168.995.350-09", "segredo");
        expect(await scan(page)).toEqual([]);
      });
    });
  }
});
