import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "@/integrations/supabase/types";

type Member = Database["public"]["Tables"]["members"]["Row"];

interface AuthContextType {
  session: Session | null;
  user: User | null;
  member: Member | null;
  permissions: string[];
  isSystem: boolean;
  loading: boolean;
  signIn: (login: string, password: string) => Promise<void>;
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

  const loadMemberData = async (userId: string) => {
    const { data: memberData } = await supabase
      .from("members")
      .select("*")
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

  const signIn = async (login: string, password: string) => {
    let email = login;

    // If it doesn't look like an email, try resolving it via the Edge Function
    if (!login.includes("@")) {
      const { data, error } = await supabase.functions.invoke("get-user-email", {
        body: { identifier: login }
      });

      if (error) throw error;
      if (data?.email) {
        email = data.email;
      } else {
        throw new Error("CPF ou celular não encontrado ou não vinculado a um e-mail.");
      }
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const hasPermission = (...perms: string[]) => {
    if (isSystem) return true;
    return perms.some((p) => permissions.includes(p));
  };

  return (
    <AuthContext.Provider value={{ session, user, member, permissions, isSystem, loading, signIn, signOut, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
