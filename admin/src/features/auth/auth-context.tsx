import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, type ReactNode } from "react";

import { unauthorizedEvent } from "../../lib/api/client";
import { authApi } from "../../lib/api/resources";
import type { AuthView } from "../../lib/api/types";

interface AuthState {
  auth: AuthView | null | undefined;
  isLoading: boolean;
  setAuth: (auth: AuthView | null) => void;
}

const AuthContext = createContext<AuthState | null>(null);
export const authQueryKey = ["auth", "me"] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: authQueryKey,
    queryFn: authApi.me,
    retry: false,
    throwOnError: false,
  });
  useEffect(() => {
    const clear = () => client.setQueryData(authQueryKey, null);
    window.addEventListener(unauthorizedEvent, clear);
    return () => window.removeEventListener(unauthorizedEvent, clear);
  }, [client]);
  return (
    <AuthContext.Provider value={{
      auth: query.isError ? null : query.data,
      isLoading: query.isLoading,
      setAuth: (auth) => client.setQueryData(authQueryKey, auth),
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
