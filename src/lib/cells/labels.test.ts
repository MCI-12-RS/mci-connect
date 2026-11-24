import { describe, it, expect } from "vitest";
import { formatCellLabel, formatG12Label, formatMeetingTime, formatShortAddress, formatStreetLine } from "./labels";

describe("formatCellLabel", () => {
  it("líder, rua, número e bairro", () => {
    expect(
      formatCellLabel({ id: "abcdef-1", leader_name: "João da Silva", street: "Rua A", number: "10", neighborhood: "Centro" }),
    ).toBe("Célula de João da Silva, em Rua A 10, Centro");
  });

  it("omite as partes vazias do endereço", () => {
    expect(formatCellLabel({ leader_name: "Ana", street: "Rua B", number: null, neighborhood: "" })).toBe("Célula de Ana, em Rua B");
    expect(formatCellLabel({ leader_name: "Ana", neighborhood: "Centro" })).toBe("Célula de Ana, em Centro");
    expect(formatCellLabel({ leader_name: "Ana" })).toBe("Célula de Ana");
  });

  it("sem líder, usa os 5 primeiros caracteres do id", () => {
    expect(formatCellLabel({ id: "abcdef-1234", leader_name: null })).toBe("Célula (abcde)");
    expect(formatCellLabel({ id: null, leader_name: null })).toBe("Célula ()");
  });
});

describe("formatStreetLine", () => {
  it("rua, número e complemento", () => {
    expect(formatStreetLine({ street: "Rua A", number: "10", complement: "ap 2" })).toBe("Rua A 10 - ap 2");
  });

  it("omite o que estiver vazio", () => {
    expect(formatStreetLine({ street: "Rua A", number: null, complement: "" })).toBe("Rua A");
    expect(formatStreetLine({ street: null, number: null, complement: "fundos" })).toBe("fundos");
    expect(formatStreetLine({})).toBe("");
  });
});

describe("formatG12Label", () => {
  it("usa o nome do G12 vindo da view", () => {
    expect(formatG12Label({ g12_leader_name: "Pedro", leader_g12_level: 3 })).toBe("Pedro");
  });

  it("sem G12: 'Pastores' para líder de nível 0, '—' nos demais casos", () => {
    expect(formatG12Label({ g12_leader_name: null, leader_g12_level: 0 })).toBe("Pastores");
    expect(formatG12Label({ g12_leader_name: null, leader_g12_level: 2 })).toBe("—");
    expect(formatG12Label({ g12_leader_name: null, leader_g12_level: null })).toBe("—");
  });
});

describe("formatMeetingTime", () => {
  it("horas e minutos do horário do banco", () => {
    expect(formatMeetingTime("20:00:00")).toBe("20:00");
    expect(formatMeetingTime("19:30")).toBe("19:30");
  });

  it("sem horário, vazio", () => {
    expect(formatMeetingTime(null)).toBe("");
    expect(formatMeetingTime(undefined)).toBe("");
  });
});

describe("formatShortAddress", () => {
  it("rua e número, como nos cards", () => {
    expect(formatShortAddress({ street: "Rua das Flores", number: "120", neighborhood: "Centro" })).toBe("Rua das Flores, 120");
  });

  it("sem número, 's/n'", () => {
    expect(formatShortAddress({ street: "Rua das Flores", number: null })).toBe("Rua das Flores, s/n");
  });

  it("sem rua, o bairro; sem os dois, vazio", () => {
    expect(formatShortAddress({ street: "", number: "10", neighborhood: "Centro" })).toBe("Centro");
    expect(formatShortAddress({})).toBe("");
  });
});
