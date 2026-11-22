import { describe, it, expect } from "vitest";
import { applyHostAddress } from "./host-address";

const form = {
  leader_id: "leader-1",
  street: "Rua Antiga",
  number: "1",
  complement: "",
  neighborhood: "Bairro Antigo",
  city: "Canoas",
  state: "RS",
  zip_code: "92000000",
};

const host = {
  street: "Rua Nova",
  number: "20",
  complement: "casa 2",
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
  zip_code: "90000000",
};

describe("applyHostAddress (RN-11)", () => {
  it("copia o endereço inteiro quando os dados do anfitrião são visíveis", () => {
    expect(applyHostAddress(form, { ...host, sensitive_visible: true })).toEqual({
      leader_id: "leader-1",
      street: "Rua Nova",
      number: "20",
      complement: "casa 2",
      neighborhood: "Centro",
      city: "Porto Alegre",
      state: "RS",
      zip_code: "90000000",
    });
  });

  it("sem acesso aos dados sensíveis, copia só bairro, cidade e UF", () => {
    const masked = { ...host, street: null, number: null, complement: null, zip_code: null, sensitive_visible: false };
    expect(applyHostAddress(form, masked)).toEqual({
      ...form,
      neighborhood: "Centro",
      city: "Porto Alegre",
      state: "RS",
    });
  });

  it("não copia rua e CEP sem sensitive_visible, mesmo que venham preenchidos", () => {
    const result = applyHostAddress(form, { ...host, sensitive_visible: false });
    expect(result.street).toBe("Rua Antiga");
    expect(result.zip_code).toBe("92000000");
  });

  it("mantém o valor atual onde o do anfitrião está vazio", () => {
    const empty = { street: "", number: null, complement: null, neighborhood: null, city: "", state: null, zip_code: null, sensitive_visible: true };
    expect(applyHostAddress(form, empty)).toEqual(form);
  });
});
