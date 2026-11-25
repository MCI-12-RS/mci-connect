import { describe, expect, it } from "vitest";
import { levelInfo, levelLabel, levelTone, memberLevel } from "./level";

// P40 e RN-02 do E2.06: rótulo do nível, aparência e leitor de tela.

describe("levelLabel", () => {
  it.each([
    [{ level: 0, isPastor: true, gender: "M" }, "Pastor"],
    [{ level: 0, isPastor: true, gender: "F" }, "Pastora"],
    [{ level: 0, isPastor: true, gender: null }, "Pastor(a)"],
    [{ level: 0, isPastor: true, gender: "" }, "Pastor(a)"],
    [{ level: 0, isPastor: true, gender: "M", bothPastors: true }, "Pastores"],
    [{ level: 1, isPastor: false, gender: "M" }, "G12"],
    [{ level: 2, isPastor: false }, "144"],
    [{ level: 3, isPastor: false }, "1.728"],
    [{ level: 4, isPastor: false }, "20.736"],
    [{ level: 5, isPastor: false }, "Nível 5"],
    [{ level: 6, isPastor: false }, "Nível 6"],
    [{ level: null, isPastor: false, gender: "F" }, "Sem liderança"],
    [{ level: undefined, isPastor: null }, "Sem liderança"],
  ])("%o → %s (UX-01)", (input, label) => {
    expect(levelLabel(input)).toBe(label);
  });

  it("nunca mostra '12' sozinho, 'Nível 0', 'Nível G12' nem 'Pastor(a)' para quem tem sexo", () => {
    const labels = [0, 1, 2, 3, 4, 5].flatMap((level) =>
      ["M", "F"].map((gender) => levelLabel({ level, isPastor: level === 0, gender })),
    );
    expect(labels).not.toContain("12");
    expect(labels).not.toContain("Nível 0");
    expect(labels).not.toContain("Nível G12");
    expect(labels).not.toContain("Pastor(a)");
  });

  it("a marca de pastor vale mesmo sem o nível; o nível 0 é sempre pastor", () => {
    expect(levelLabel({ level: null, isPastor: true, gender: "F" })).toBe("Pastora");
    expect(levelLabel({ level: 0, isPastor: false, gender: "M" })).toBe("Pastor");
  });
});

describe("levelTone", () => {
  it("pastor, nível ou sem liderança (DA-2: nível nulo e não pastor)", () => {
    expect(levelTone({ level: 0, isPastor: true })).toBe("pastor");
    expect(levelTone({ level: 1, isPastor: false })).toBe("level");
    expect(levelTone({ level: 7 })).toBe("level");
    expect(levelTone({ level: null, isPastor: false })).toBe("no_leadership");
  });
});

describe("levelInfo: leitor de tela (UX-16)", () => {
  it("os rótulos só com número levam o prefixo 'nível'", () => {
    expect(levelInfo({ level: 2 })).toEqual({ label: "144", tone: "level", srPrefix: "nível", spoken: "nível 144" });
    expect(levelInfo({ level: 3 }).spoken).toBe("nível 1.728");
    expect(levelInfo({ level: 4 }).srPrefix).toBe("nível");
  });

  it("os demais se explicam e são lidos em minúsculas, fora o G12", () => {
    expect(levelInfo({ level: 0, isPastor: true, gender: "M" })).toMatchObject({ srPrefix: null, spoken: "pastor" });
    expect(levelInfo({ level: 0, isPastor: true, gender: "F" }).spoken).toBe("pastora");
    expect(levelInfo({ level: 1 })).toMatchObject({ srPrefix: null, spoken: "G12" });
    expect(levelInfo({ level: 5 })).toMatchObject({ srPrefix: null, spoken: "nível 5" });
    expect(levelInfo({ level: null })).toMatchObject({ tone: "no_leadership", srPrefix: null, spoken: "sem liderança" });
  });
});

describe("memberLevel", () => {
  it("lê as colunas da members_view", () => {
    expect(memberLevel({ g12_level: 3, is_pastor: false, gender: "F" })).toEqual({ level: 3, isPastor: false, gender: "F" });
  });
});
