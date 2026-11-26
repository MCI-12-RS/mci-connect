import { describe, it, expect } from "vitest";
import { applyHostAddress } from "./host-address";

const typed = {
  leader_id: "leader-1",
  street: "Rua A",
  number: "1",
  complement: "fundos",
  neighborhood: "Bairro Antigo",
  city: "Canoas",
  state: "RS",
  zip_code: "92000-000",
};

const carla = {
  street: "Rua das Flores",
  number: "100",
  complement: "ap. 2",
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
  zip_code: "90010-000",
};

describe("applyHostAddress (E2.08, RN-10, DT-11, P-CEL-07)", () => {
  it("com os dados sensíveis (Rita), os sete campos passam a ser os do anfitrião: full", () => {
    expect(applyHostAddress(typed, { ...carla, sensitive_visible: true })).toEqual({
      address: { leader_id: "leader-1", ...carla },
      outcome: "full",
    });
  });

  it("substitui também onde o anfitrião não tem dado (nunca uma mistura)", () => {
    const partialHost = { ...carla, complement: null, number: null, sensitive_visible: true };
    const { address } = applyHostAddress(typed, partialHost);
    expect(address.complement).toBe("");
    expect(address.number).toBe("");
    expect(address.street).toBe("Rua das Flores");
  });

  it("sem os dados sensíveis (Pedro): bairro, cidade e estado do anfitrião; CEP, rua, número e complemento vazios", () => {
    const masked = { ...carla, street: null, number: null, complement: null, zip_code: null, sensitive_visible: false };
    expect(applyHostAddress(typed, masked)).toEqual({
      address: { ...typed, street: "", number: "", complement: "", zip_code: "", neighborhood: "Centro", city: "Porto Alegre", state: "RS" },
      outcome: "partial",
    });
  });

  it("sem sensitive_visible, rua e CEP nunca entram, mesmo que venham preenchidos (UX-14)", () => {
    const { address } = applyHostAddress(typed, { ...carla, sensitive_visible: false });
    expect(address.street).toBe("");
    expect(address.number).toBe("");
    expect(address.zip_code).toBe("");
  });

  it("nada visível (Gabriel, sem endereço): o endereço não muda: unavailable", () => {
    const empty = { street: null, number: null, complement: null, neighborhood: null, city: null, state: null, zip_code: null, sensitive_visible: true };
    expect(applyHostAddress(typed, empty)).toEqual({ address: typed, outcome: "unavailable" });
  });

  it("para quem não vê os sensíveis, o anfitrião só com rua e CEP dá o mesmo resultado do vazio (UX-15)", () => {
    const onlyStreet = { street: null, number: null, complement: null, neighborhood: null, city: null, state: null, zip_code: null, sensitive_visible: false };
    expect(applyHostAddress(typed, onlyStreet)).toEqual({ address: typed, outcome: "unavailable" });
  });

  it("anfitrião fora do escopo (null): unavailable, sem mudar nada", () => {
    expect(applyHostAddress(typed, null)).toEqual({ address: typed, outcome: "unavailable" });
  });
});
