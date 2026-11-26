import { useState } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormProvider, useForm } from "react-hook-form";
import { MemberAddressSection } from "@/components/members/MemberAddressSection";
import { CEP_LOOKUP_TIMEOUT_MS } from "@/hooks/use-cep-lookup";
import type { CepAddress } from "@/lib/address/cep";
import { CepField } from "./CepField";

// CEP comum (E2.08, RN-09, DT-12, UX-18): a busca sai só da digitação ou da
// colagem do 8º dígito; não encontrado e falha são avisos que não bloqueiam.

const FOUND = { logradouro: "Rua das Flores", bairro: "Centro", localidade: "Porto Alegre", uf: "RS", complemento: "lado par" };

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function Harness({ onFound, initial = "" }: { onFound: (address: CepAddress) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CepField id="zip_code" value={value} onChange={setValue} onFound={onFound} />
      <button type="button" onClick={() => setValue("90160-000")}>
        Do anfitrião
      </button>
    </>
  );
}

const cep = () => screen.getByLabelText("CEP");

describe("CepField (E2.08, UX-18)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("máscara de 8 dígitos e teclado numérico; com o 8º dígito, busca uma vez, mostra 'Buscando endereço…' e preenche", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (answer = resolve)));
    const onFound = vi.fn();
    render(<Harness onFound={onFound} />);
    expect(cep()).toHaveAttribute("inputmode", "numeric");
    expect(cep()).toHaveAttribute("autocomplete", "off");

    fireEvent.change(cep(), { target: { value: "9001000" } });
    expect(cep()).toHaveValue("90010-00");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(cep(), { target: { value: "90010000" } });
    expect(cep()).toHaveValue("90010-000");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://viacep.com.br/ws/90010000/json/");
    expect(screen.getByText("Buscando endereço…").closest("[role=status]")).not.toBeNull();

    await act(async () => answer(jsonResponse(FOUND)));
    expect(onFound).toHaveBeenCalledWith({ street: "Rua das Flores", neighborhood: "Centro", city: "Porto Alegre", state: "RS" });
    expect(screen.getByText("Rua, bairro, cidade e estado preenchidos pelo CEP.")).toHaveClass("sr-only");
  });

  it("não encontrado: o aviso embaixo, sem marcar o campo como inválido; some quando o CEP muda", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ erro: true }));
    render(<Harness onFound={vi.fn()} />);
    fireEvent.change(cep(), { target: { value: "99999999" } });
    const warning = await screen.findByText("CEP não encontrado. Confira o número ou preencha o endereço.");
    expect(cep()).not.toHaveAttribute("aria-invalid");
    expect(cep().getAttribute("aria-describedby")).toBe(warning.closest("p")?.id);
    fireEvent.change(cep(), { target: { value: "9999999" } });
    expect(screen.queryByText(/CEP não encontrado/)).not.toBeInTheDocument();
  });

  it("falha do serviço e tempo-limite de 8 s: o aviso de falha", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<Harness onFound={vi.fn()} />);
    fireEvent.change(cep(), { target: { value: "90010000" } });
    expect(await screen.findByText("Não foi possível buscar o endereço pelo CEP. Preencha o endereço.")).toBeInTheDocument();

    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    );
    fireEvent.change(cep(), { target: { value: "90020000" } });
    expect(screen.getByText("Buscando endereço…")).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(CEP_LOOKUP_TIMEOUT_MS);
    });
    vi.useRealTimers();
    expect(await screen.findByText("Não foi possível buscar o endereço pelo CEP. Preencha o endereço.")).toBeInTheDocument();
  });

  it("só a última busca vale: a anterior é cancelada", async () => {
    const signals: AbortSignal[] = [];
    let answerSecond: (response: Response) => void = () => {};
    fetchMock
      .mockImplementationOnce((_url: string, init: RequestInit) => {
        if (init.signal) signals.push(init.signal);
        return new Promise(() => {});
      })
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answerSecond = resolve)));
    const onFound = vi.fn();
    render(<Harness onFound={onFound} />);
    fireEvent.change(cep(), { target: { value: "90010000" } });
    fireEvent.change(cep(), { target: { value: "90010001" } });
    expect(signals[0].aborted).toBe(true);
    await act(async () => answerSecond(jsonResponse(FOUND)));
    expect(onFound).toHaveBeenCalledTimes(1);
  });

  it("o CEP que vem de outro campo (o anfitrião) não dispara a busca (UXD-9)", () => {
    render(<Harness onFound={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Do anfitrião" }));
    expect(cep()).toHaveValue("90160-000");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// O CEP no cadastro de membro (E2.08 PR 3, DA-11, tarefa 9).
interface AddressValues {
  zip_code: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
}

function MemberAddressHarness({ onSubmit }: { onSubmit: (values: AddressValues) => void }) {
  const form = useForm<AddressValues>({
    defaultValues: { zip_code: "", street: "", number: "12", complement: "fundos", neighborhood: "", city: "", state: "" },
  });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* A seção lê só os campos de endereço do formulário de membro. */}
        <MemberAddressSection readOnly={false} />
        <button type="submit">Salvar</button>
      </form>
    </FormProvider>
  );
}

describe("MemberAddressSection com o CEP comum (E2.08, RN-09)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preenche rua, bairro, cidade e estado e não mexe em número e complemento", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(FOUND)));
    render(<MemberAddressHarness onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "90010000" } });
    await waitFor(() => expect(screen.getByLabelText("Rua")).toHaveValue("Rua das Flores"));
    expect(screen.getByLabelText("Bairro")).toHaveValue("Centro");
    expect(screen.getByLabelText("Cidade")).toHaveValue("Porto Alegre");
    expect(screen.getByLabelText("Número")).toHaveValue("12");
    expect(screen.getByLabelText("Complemento")).toHaveValue("fundos");
  });

  it("o aviso de não encontrado não impede salvar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ erro: true })));
    const onSubmit = vi.fn();
    render(<MemberAddressHarness onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "99999999" } });
    await screen.findByText("CEP não encontrado. Confira o número ou preencha o endereço.");
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ zip_code: "99999-999", complement: "fundos" });
  });
});
