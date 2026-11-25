import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { toast as sonnerToast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { dismiss as dismissToasts } from "@/hooks/use-toast";
import { MEMBER_ROW_SELECT, type MemberRow } from "@/lib/members/fields";
import { SERVER_ERROR, type SignInOutcome } from "@/lib/auth/sign-in-result";
import { shouldEndSession } from "@/lib/auth/session";
import { isFocusCheckDue, setSessionCheckHandler, singleFlight } from "@/lib/auth/session-check";
import { requestSignIn } from "@/services/auth/sign-in";
import { refreshAccess, useAccessQuery } from "@/hooks/use-access";
import { hasPermission as accessHasPermission, type Access } from "@/lib/access/access";
import type { PermissionAction } from "@/lib/access/permissions";

type Member = MemberRow;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  member: Member | null;
  /**
   * O acesso de quem está logado, pela `my_access()` (E2.02): permissões
   * efetivas, função e alcance. `null` sem sessão ou antes da primeira
   * leitura. É relido sem sair e entrar (RN-08, `use-access`).
   */
  access: Access | null;
  loading: boolean;
  /**
   * O acesso do usuário logado já chegou (ou não há sessão). Antes disso,
   * `hasPermission` responde `false` para tudo: uma tela protegida por
   * permissão espera, em vez de dizer que o usuário não tem acesso.
   */
  permissionsLoaded: boolean;
  /** A primeira leitura do acesso falhou (T12): a área principal mostra o aviso com "Tentar de novo". */
  accessLoadFailed: boolean;
  retryAccess: () => void;
  signIn: (identifier: string, password: string) => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  /**
   * A sessão terminou sem a pessoa pedir (cadastro excluído, renovação
   * recusada; E2.01, RN-14). O `ProtectedRoute` leva ao login com o aviso.
   * Volta a `false` no próximo login.
   */
  sessionEnded: boolean;
  /** Só mostra ou esconde: quem protege é o banco. As permissões aposentadas não liberam nada (RN-22). */
  hasPermission: (...permissions: PermissionAction[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/** Fim forçado da sessão: nenhum aviso da tela anterior fica por cima do login (E2.01, PR 6). */
function dismissOpenToasts() {
  dismissToasts();
  sonnerToast.dismiss();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);
  const queryClient = useQueryClient();
  // O usuário da sessão atual, para a verificação ler sem depender do render.
  const userIdRef = useRef<string | null>(null);
  // O próximo SIGNED_OUT foi pedido pela pessoa (botão Sair): sem aviso.
  const signOutRequestedRef = useRef(false);
  const lastFocusCheckRef = useRef<number | null>(null);
  // O fim forçado está em andamento: um evento com sessão (renovação) até o SIGNED_OUT não apaga o aviso.
  const endingRef = useRef(false);

  // O acesso (permissões, função e alcance) vem da `my_access()`, com a chave do usuário da sessão.
  const { access, loadFailed: accessLoadFailed, retry: retryAccess } = useAccessQuery(user?.id ?? null);

  const loadMemberData = async (userId: string) => {
    // Pela members_view: o próprio cadastro vem sem máscara.
    const { data: memberData } = await supabase
      .from("members_view")
      .select(MEMBER_ROW_SELECT)
      .eq("auth_user_id", userId)
      .maybeSingle();

    setMember(memberData);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        userIdRef.current = session?.user.id ?? null;
        if (event === "SIGNED_OUT") {
          // Sem o pedido da pessoa (renovação recusada, outra aba, fim forçado): o login mostra o aviso.
          if (!signOutRequestedRef.current) {
            setSessionEnded(true);
            dismissOpenToasts();
          }
          signOutRequestedRef.current = false;
          endingRef.current = false;
          // Nada do usuário anterior fica na memória para o próximo login.
          queryClient.clear();
        } else if (session && !endingRef.current) {
          setSessionEnded(false);
        }
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => loadMemberData(session.user.id), 0);
          // Sessão renovada: relê o acesso (T12).
          if (event === "TOKEN_REFRESHED") void refreshAccess(queryClient);
        } else {
          setMember(null);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      userIdRef.current = session?.user.id ?? null;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadMemberData(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [queryClient]);

  /**
   * Relê o próprio cadastro na `members_view` (E2.01, RN-14 e DT-20). Sem
   * linha e sem erro, o cadastro foi excluído: encerra a sessão só neste
   * navegador (as sessões no servidor já foram apagadas) e o `ProtectedRoute`
   * leva ao login com o aviso. Qualquer erro, inclusive a queda de conexão,
   * mantém a sessão. Uma releitura por vez.
   */
  const [verifySession] = useState(() =>
    singleFlight(async () => {
      const userId = userIdRef.current;
      if (!userId) return;
      const result = await supabase
        .from("members_view")
        .select("id")
        .eq("auth_user_id", userId)
        .maybeSingle();
      // A sessão mudou durante a releitura (saída, outro login): a resposta não vale mais.
      if (userIdRef.current !== userId || !shouldEndSession(result)) return;
      // O aviso antes de a sessão sumir: o ProtectedRoute redireciona já com ele.
      endingRef.current = true;
      setSessionEnded(true);
      dismissOpenToasts();
      // Sem log_auth_event: o banco não grava para cadastro excluído (DA-9).
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        // O SIGNED_OUT não veio: limpa à mão.
        endingRef.current = false;
        userIdRef.current = null;
        setSession(null);
        setUser(null);
        setMember(null);
        queryClient.clear();
      }
    }),
  );

  useEffect(() => setSessionCheckHandler(() => void verifySession()), [verifySession]);

  // Volta da aba ou da janela: no máximo uma releitura a cada FOCUS_CHECK_INTERVAL_MS.
  const checkOnFocus = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (!isFocusCheckDue(lastFocusCheckRef.current, now)) return;
    lastFocusCheckRef.current = now;
    void verifySession();
  }, [verifySession]);

  useEffect(() => {
    document.addEventListener("visibilitychange", checkOnFocus);
    window.addEventListener("focus", checkOnFocus);
    return () => {
      document.removeEventListener("visibilitychange", checkOnFocus);
      window.removeEventListener("focus", checkOnFocus);
    };
  }, [checkOnFocus]);

  /**
   * Login pela Edge Function `sign-in` (E1.04, RN-13 e RN-14): o único caminho.
   * As falhas esperadas voltam como resultado, sem exceção. No sucesso, a
   * sessão devolvida pela função passa ao cliente do Supabase, que a renova e
   * a guarda como antes. O login é registrado na Auditoria pelo servidor.
   */
  const signIn = async (identifier: string, password: string): Promise<SignInOutcome> => {
    const result = await requestSignIn(identifier, password);
    if (result.result !== "ok") return result;

    const { error } = await supabase.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token,
    });
    if (error) return SERVER_ERROR;
    setSessionEnded(false);
    return { result: "ok" };
  };

  const signOut = async () => {
    await supabase.rpc("log_auth_event", {
      _action: "logout",
      _success: true,
      _identifier: null,
      _reason: null,
    }).then(() => {}, () => {});
    signOutRequestedRef.current = true;
    const { error } = await supabase.auth.signOut();
    // A saída não aconteceu (sem conexão): o próximo SIGNED_OUT não é o deste pedido.
    if (error) signOutRequestedRef.current = false;
  };

  const hasPermission = (...perms: PermissionAction[]) => accessHasPermission(access, ...perms);

  const permissionsLoaded = !loading && (!user || access !== null);

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        member,
        access,
        loading,
        permissionsLoaded,
        accessLoadFailed,
        retryAccess,
        signIn,
        signOut,
        sessionEnded,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
