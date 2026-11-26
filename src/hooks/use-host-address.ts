import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchMemberAddress, memberAddressQueryKey } from "@/hooks/use-member-address";
import type { MemberAddress } from "@/lib/members/fields";

export type HostAddressStatus = "idle" | "loading" | "failed";

/**
 * O endereço do anfitrião escolhido no seletor (E2.08, RN-10, DT-11, AQ-5,
 * UXD-8). `request(hostId)` a cada escolha, inclusive a volta ao anfitrião
 * gravado: a leitura é nova a cada pedido (sem cache), e só a resposta do
 * último pedido chega a `onLoaded` (uma ficha por pedido). `null` em
 * `onLoaded`: o anfitrião não está no escopo de quem edita.
 */
export function useHostAddress(onLoaded: (address: MemberAddress | null) => void) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<HostAddressStatus>("idle");
  const token = useRef(0);
  const lastHostId = useRef<string | null>(null);
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  const request = useCallback(
    async (hostId: string) => {
      token.current += 1;
      const mine = token.current;
      lastHostId.current = hostId;
      setStatus("loading");
      try {
        const address = await queryClient.fetchQuery({
          queryKey: memberAddressQueryKey(hostId),
          queryFn: () => fetchMemberAddress(hostId),
          staleTime: 0,
          retry: false,
        });
        if (mine !== token.current) return;
        setStatus("idle");
        onLoadedRef.current(address);
      } catch {
        if (mine === token.current) setStatus("failed");
      }
    },
    [queryClient],
  );

  /** O envio do formulário começou: a resposta que ainda vier não muda mais o endereço enviado. */
  const cancel = useCallback(() => {
    token.current += 1;
    setStatus((current) => (current === "loading" ? "idle" : current));
  }, []);

  const retry = useCallback(() => {
    if (lastHostId.current) void request(lastHostId.current);
  }, [request]);

  // Fechar o formulário descarta a resposta que ainda vier.
  useEffect(
    () => () => {
      token.current += 1;
    },
    [],
  );

  return { status, request, retry, cancel };
}
