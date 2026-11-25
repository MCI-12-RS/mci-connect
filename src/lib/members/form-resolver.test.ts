import { describe, expect, it } from "vitest";
import { ministryFieldsView } from "@/lib/access/member-form";
import type { FieldErrors } from "react-hook-form";
import { initialMemberFormFields, type MemberFormFields } from "./form-values";
import { memberFormResolver, validateMemberFormFields, type MemberFormContext } from "./form-resolver";

const context: MemberFormContext = {
  validation: {
    stored: null,
    memberId: null,
    today: "2026-11-23",
    sensitiveVisible: true,
    canEditMinistry: true,
    seesWholeChurch: true,
  },
  view: ministryFieldsView({ seesWholeChurch: true, isNew: true }),
  role: { required: false, initial: null },
};

const resolverOptions = { fields: {}, shouldUseNativeValidation: false } as const;

describe("validateMemberFormFields (RN-19, UX-08)", () => {
  it("Lúcia do critério da RN-19: os quatro erros, mais o líder, na ordem da tela", () => {
    const fields = { ...initialMemberFormFields(null), name: "Lúcia", email: "lucia@", cpf: "111.111.111-11" };
    expect(validateMemberFormFields(fields, context).map((error) => error.field)).toEqual([
      "name",
      "gender",
      "email",
      "cpf",
      "leader_id",
    ]);
  });

  it("a Função obrigatória vale sem escolha e sem a inicial", () => {
    const fields = { ...initialMemberFormFields(null), name: "Ana Souza", gender: "F" as const, mobile_whatsapp: "51988887777", has_leadership: false };
    const required = { ...context, role: { required: true, initial: null } };
    expect(validateMemberFormFields(fields, required).map((error) => error.field)).toEqual(["role_id"]);
    expect(validateMemberFormFields(fields, { ...required, role: { required: true, initial: "membro" } })).toEqual([]);
  });
});

describe("memberFormResolver", () => {
  it("devolve os erros nos campos, com o código no type", async () => {
    const fields = { ...initialMemberFormFields(null), has_leadership: false };
    const result = await memberFormResolver(fields, context, resolverOptions);
    const errors: FieldErrors<MemberFormFields> = result.errors;
    expect(errors.name).toEqual({ type: "name_invalid", message: "Informe o nome e o sobrenome." });
    expect(errors.identification?.type).toBe("identifier_required");
  });

  it("sem erro, devolve os valores", async () => {
    const fields = {
      ...initialMemberFormFields(null),
      name: "Ana Souza",
      gender: "F" as const,
      mobile_whatsapp: "(51) 98888-7777",
      has_leadership: false,
    };
    const result = await memberFormResolver(fields, context, resolverOptions);
    expect(result.errors).toEqual({});
    expect(result.values).toBe(fields);
  });
});
