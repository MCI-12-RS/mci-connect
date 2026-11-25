import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { MEMBER_ROW_SELECT, type MemberRow } from "@/lib/members/fields";
import { SERVER_ERROR, type SignInOutcome } from "@/lib/auth/sign-in-result";
import { requestSignIn } from "@/services/auth/sign-in";

type Member = MemberRow;

interface AuthContextType {
  session: Session | null;
  user: User | null;
  member: Member | null;
  permissions: string[];
  isSystem: boolean;
  loading: boolean;
  /**
   * As permissões do usuário logado já chegaram (ou não há sessão). Antes
   * disso, `hasPermission` responde `false` para tudo: uma tela protegida por
   * permissão espera, em vez de dizer que o usuário não tem acesso.
   */
  permissionsLoaded: boolean;
  signIn: (identifier: string, password: string) => Promise<SignInOutcome>;
  signOut: () => Promise<void>;
  hasPermission: (...permissions: string[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isSystem, setIsSystem] = useState(false);
  const [loading, setLoading] = useState(true);
  // De quem são as permissões carregadas: a renovação do token recarrega as do
  // mesmo usuário sem voltar a "carregando".
  const [permissionsUserId, setPermissionsUserId] = useState<string | null>(null);

  const loadMemberData = async (userId: string) => {
    try {
      // Pela members_view: o próprio cadastro vem sem máscara.
      const { data: memberData } = await supabase
        .from("members_view")
        .select(MEMBER_ROW_SELECT)
        .eq("auth_user_id", userId)
        .maybeSingle();

      setMember(memberData);

      if (memberData?.role_id) {
        const [{ data: perms }, { data: role }] = await Promise.all([
          supabase
            .from("role_permissions")
            .select("permission")
            .eq("role_id", memberData.role_id),
          supabase
            .from("roles")
            .select("is_system")
            .eq("id", memberData.role_id)
            .maybeSingle()
        ]);

        setPermissions(perms?.map((p) => p.permission) || []);
        setIsSystem(role?.is_system || false);
      } else {
        setPermissions([]);
        setIsSystem(false);
      }
    } finally {
      setPermissionsUserId(userId);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          setTimeout(() => loadMemberData(session.user.id), 0);
        } else {
          setMember(null);
          setPermissions([]);
          setIsSystem(false);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        loadMemberData(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

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
    return error ? SERVER_ERROR : { result: "ok" };
  };

  const signOut = async () => {
    await supabase.rpc("log_auth_event", {
      _action: "logout",
      _success: true,
      _identifier: null,
      _reason: null,
    }).then(() => {}, () => {});
    await supabase.auth.signOut();
  };

  const hasPermission = (...perms: string[]) => {
    if (isSystem) return true;
    return perms.some((p) => permissions.includes(p));
  };

  const permissionsLoaded = !loading && (!user || permissionsUserId === user.id);

  return (
    <AuthContext.Provider
      value={{ session, user, member, permissions, isSystem, loading, permissionsLoaded, signIn, signOut, hasPermission }}
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
