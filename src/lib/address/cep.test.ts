import { describe, expect, it } from "vitest";
import { applyCepAddress, cepDigits, isCompleteCep, maskCep, parseCepLookup } from "./cep";

describe("CEP (E2.08, RN-09, DT-12)", () => {
  it("máscara de 8 dígitos, com o hífen depois do 5º", () => {
    expect(maskCep("90010")).toBe("90010");
    expect(maskCep("900101")).toBe("90010-1");
    expect(maskCep("90010-100")).toBe("90010-100");
    expect(maskCep("900101009")).toBe("90010-100");
    expect(cepDigits("90.010-100")).toBe("90010100");
    expect(isCompleteCep("90010-10")).toBe(false);
    expect(isCompleteCep("90010-100")).toBe(true);
  });

  it("a resposta do serviço: encontrado, não encontrado ou falha, sem any", () => {
    expect(parseCepLookup({ logradouro: "Rua das Flores", bairro: "Centro", localidade: "Porto Alegre", uf: "RS", complemento: "ap. 9" })).toEqual({
      kind: "found",
      address: { street: "Rua das Flores", neighborhood: "Centro", city: "Porto Alegre", state: "RS" },
    });
    expect(parseCepLookup({ erro: true })).toEqual({ kind: "not_found" });
    expect(parseCepLookup({ erro: "true" })).toEqual({ kind: "not_found" });
    expect(parseCepLookup("<html>")).toEqual({ kind: "failed" });
    expect(parseCepLookup({ logradouro: "", bairro: "Centro", localidade: "Porto Alegre", uf: "RS" })).toMatchObject({
      address: { street: null },
    });
  });

  it("preenche rua, bairro, cidade e estado onde o serviço trouxe valor; nunca número e complemento (P-CEL-20)", () => {
    const current = { street: "Rua A", number: "10", complement: "fundos", neighborhood: "", city: "", state: "" };
    expect(applyCepAddress(current, { street: null, neighborhood: "Centro", city: "Porto Alegre", state: "RS" })).toEqual({
      street: "Rua A",
      number: "10",
      complement: "fundos",
      neighborhood: "Centro",
      city: "Porto Alegre",
      state: "RS",
    });
  });
});
