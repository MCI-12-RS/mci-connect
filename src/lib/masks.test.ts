// E2.04 (P23, RN-06, RN-07; UX-06 e UX-07): as máscaras nunca cortam dígitos
// e preservam o cursor.
import { describe, expect, it } from "vitest";
import { applyMask, cpfDisplayValue, maskCpf, maskMobileOnBlur, maskMobileTyping, mobileDisplayValue } from "./masks";

/** Digita caractere por caractere, com o cursor no fim, como no campo. */
const type = (text: string, mask: (value: string) => string): string =>
  Array.from(text).reduce((value, char) => {
    const next = value + char;
    return applyMask(next, next.length, mask).value;
  }, "");

describe("celular: a tabela da T3 (UX-06), digitada ou colada", () => {
  it.each([
    ["51988887777", "(51) 98888-7777"],
    ["(51)98888-7777", "(51) 98888-7777"],
    ["+55 (51) 98888-7777", "(51) 98888-7777"],
    ["5551988887777", "(51) 98888-7777"],
    ["051 98888-7777", "(51) 98888-7777"],
    ["(55) 99999-1111", "(55) 99999-1111"],
    ["55999991111", "(55) 99999-1111"],
    ["5133334444", "(51) 3333-4444"],
    ["98888-1234", "98888-1234"],
    ["(51) 98888-12345", "(51) 98888-12345"],
  ])("%s → %s", (input, expected) => {
    // Colado: a forma lida ao colar.
    expect(maskMobileOnBlur(applyMask(input, input.length, maskMobileTyping).value)).toBe(expected);
    // Digitado: a máscara a cada tecla e, ao sair, a forma lida.
    const typed = type(input, maskMobileTyping);
    expect(maskMobileOnBlur(typed)).toBe(expected);
    // Nenhum dígito cortado.
    expect(typed.replace(/\D/g, "")).toBe(input.replace(/\D/g, ""));
  });

  it("formata com 10 ou 11 dígitos; com menos, fica como foi digitado", () => {
    expect(maskMobileTyping("519888")).toBe("519888");
    expect(maskMobileTyping("5133334444")).toBe("(51) 3333-4444");
    expect(maskMobileTyping("(51) 3333-44445")).toBe("(51) 33334-4445");
    expect(maskMobileTyping("+5551988887777")).toBe("+5551988887777");
    expect(maskMobileTyping("051988887777")).toBe("051988887777");
    expect(maskMobileTyping("abc")).toBe("abc");
  });

  it("UX-06: corrigir o 3º dígito de \"(51) 98888-7777\" deixa o cursor logo depois dele", () => {
    // Apagar o "9" (índice 5) e digitar "8" no lugar.
    const afterDelete = applyMask("(51) 8888-7777", 5, maskMobileTyping);
    expect(afterDelete).toEqual({ value: "(51) 8888-7777", caret: 5 });
    const afterType = applyMask("(51) 88888-7777", 6, maskMobileTyping);
    expect(afterType).toEqual({ value: "(51) 88888-7777", caret: 6 });
  });

  it("o cursor segue o mesmo dígito quando a máscara muda de forma (10 → 11 dígitos)", () => {
    // "(51) 9888-8777" com um "1" digitado logo depois do hífen.
    expect(applyMask("(51) 9888-18777", 11, maskMobileTyping)).toEqual({ value: "(51) 98881-8777", caret: 10 });
  });

  it("mobileDisplayValue (P23, T6): o gravado legível com a máscara; o ilegível como está", () => {
    expect(mobileDisplayValue("51988887777")).toBe("(51) 98888-7777");
    expect(mobileDisplayValue("98887777")).toBe("98887777");
    expect(mobileDisplayValue(null)).toBe("");
  });
});

describe("CPF: a tabela da T3 (UX-07)", () => {
  it.each([
    ["52998224725", "529.982.247-25"],
    ["01234567890", "012.345.678-90"],
    ["529.982.247-26", "529.982.247-26"],
    ["1144477735", "114.447.773-5"],
    ["111444777350", "111.444.777-350"],
  ])("%s → %s", (input, expected) => {
    expect(maskCpf(input)).toBe(expected);
    expect(type(input, maskCpf)).toBe(expected);
  });

  it("formata aos poucos enquanto a pessoa digita", () => {
    expect(maskCpf("529")).toBe("529");
    expect(maskCpf("5299")).toBe("529.9");
    expect(maskCpf("5299822")).toBe("529.982.2");
    expect(maskCpf("abc")).toBe("abc");
  });

  it("cpfDisplayValue", () => {
    expect(cpfDisplayValue("00000000191")).toBe("000.000.001-91");
    expect(cpfDisplayValue(null)).toBe("");
  });
});

describe("applyMask", () => {
  it("sem mudança, valor e cursor ficam", () => {
    expect(applyMask("98888", 2, maskMobileTyping)).toEqual({ value: "98888", caret: 2 });
  });

  it("cursor antes de qualquer dígito vai para antes do primeiro dígito", () => {
    expect(applyMask("5133334444", 0, maskMobileTyping)).toEqual({ value: "(51) 3333-4444", caret: 1 });
  });
});
