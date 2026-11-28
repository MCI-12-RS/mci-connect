import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FormDialog, type FormDialogActions } from "./FormDialog";

// O pedido de fechar vindo de fora (E2.12, DA-11): o voltar do aparelho com o formulário de relatório
// aberto pela consulta. Vale como o "Cancelar": fecha, pergunta "Descartar as alterações?" ou, durante
// o envio, recusa.

const TEXTS = { close: "Fechar", readOnlyClose: "Fechar", errorSummary: () => "", buttons: { cancel: "Cancelar" } };

function actions(overrides: Partial<FormDialogActions> = {}): FormDialogActions {
  return {
    formId: "f",
    primaryLabel: "Salvar alterações",
    busyLabel: "Salvando…",
    busy: false,
    disabled: false,
    errorCount: 0,
    failure: null,
    isDirty: () => false,
    ...overrides,
  };
}

function renderDialog(props: { closeRequest: number; dirty?: boolean; busy?: boolean; onClose: () => void; onDeclined: () => void }) {
  return render(
    <FormDialog
      title="Editar relatório"
      texts={TEXTS}
      onClose={props.onClose}
      actions={actions({ busy: props.busy ?? false, isDirty: () => props.dirty ?? false })}
      closeRequest={props.closeRequest}
      onCloseRequestDeclined={props.onDeclined}
    >
      <form id="f" />
    </FormDialog>,
  );
}

describe("FormDialog: pedido de fechar vindo de fora (DA-11 do E2.12)", () => {
  it("o valor inicial não pede nada; um valor novo sem alteração fecha", () => {
    const onClose = vi.fn();
    const onDeclined = vi.fn();
    const { rerender } = renderDialog({ closeRequest: 0, onClose, onDeclined });
    expect(onClose).not.toHaveBeenCalled();
    rerender(
      <FormDialog title="Editar relatório" texts={TEXTS} onClose={onClose} actions={actions()} closeRequest={1} onCloseRequestDeclined={onDeclined}>
        <form id="f" />
      </FormDialog>,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDeclined).not.toHaveBeenCalled();
  });

  it("com alteração, pergunta; Continuar editando recusa e o formulário fica", async () => {
    const onClose = vi.fn();
    const onDeclined = vi.fn();
    const dirty = actions({ isDirty: () => true });
    const { rerender } = render(
      <FormDialog title="Editar relatório" texts={TEXTS} onClose={onClose} actions={dirty} closeRequest={0} onCloseRequestDeclined={onDeclined}>
        <form id="f" />
      </FormDialog>,
    );
    rerender(
      <FormDialog title="Editar relatório" texts={TEXTS} onClose={onClose} actions={dirty} closeRequest={1} onCloseRequestDeclined={onDeclined}>
        <form id="f" />
      </FormDialog>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(onDeclined).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Editar relatório" })).toBeInTheDocument();
  });

  it("com alteração, Descartar fecha sem recusar", async () => {
    const onClose = vi.fn();
    const onDeclined = vi.fn();
    const dirty = actions({ isDirty: () => true });
    const { rerender } = render(
      <FormDialog title="Editar relatório" texts={TEXTS} onClose={onClose} actions={dirty} closeRequest={0} onCloseRequestDeclined={onDeclined}>
        <form id="f" />
      </FormDialog>,
    );
    rerender(
      <FormDialog title="Editar relatório" texts={TEXTS} onClose={onClose} actions={dirty} closeRequest={1} onCloseRequestDeclined={onDeclined}>
        <form id="f" />
      </FormDialog>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Descartar" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(onDeclined).not.toHaveBeenCalled();
  });

  it("o Cancelar com alteração e Continuar editando não conta como recusa de fora", async () => {
    const onClose = vi.fn();
    const onDeclined = vi.fn();
    renderDialog({ closeRequest: 0, dirty: true, onClose, onDeclined });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Continuar editando" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(onDeclined).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("durante o envio, recusa na hora, sem fechar nem perguntar", () => {
    const onClose = vi.fn();
    const onDeclined = vi.fn();
    const busy = actions({ busy: true, isDirty: () => true });
    const { rerender } = render(
      <FormDialog title="Editar relatório" texts={TEXTS} onClose={onClose} actions={busy} closeRequest={0} onCloseRequestDeclined={onDeclined}>
        <form id="f" />
      </FormDialog>,
    );
    rerender(
      <FormDialog title="Editar relatório" texts={TEXTS} onClose={onClose} actions={busy} closeRequest={1} onCloseRequestDeclined={onDeclined}>
        <form id="f" />
      </FormDialog>,
    );
    expect(onDeclined).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
