import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMe, logout, refreshToken } from '../api/auth';
import { setAccessToken } from '../api/client';
import type { AuthMeResponse } from '../types/auth';
import type { User, Team } from '../types/auth';

export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

export function useAuth() {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: async () => {
      // Try refresh first to hydrate the in-memory access token
      try {
        const refreshed = await refreshToken();
        if (refreshed.ok) {
          setAccessToken(refreshed.access_token);
        }
      } catch {
        // No valid refresh cookie — user is logged out
        return null;
      }
      const me = (await fetchMe()) as AuthMeResponse;
      if (me.access_token) {
        setAccessToken(me.access_token);
      }
      return me;
    },
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setAccessToken(null);
      // Directly null the auth data so useRequireAuth redirects immediately
      // without waiting for a re-fetch cycle.
      queryClient.setQueryData(AUTH_QUERY_KEY, null);
    },
  });

  const user: User | null = data?.user ?? null;
  const team: Team | null = data?.team ?? null;
  const isAuthenticated = user !== null && !isError;

  return {
    user,
    team,
    isAuthenticated,
    isLoading,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}

/** Redirect to /login if unauthenticated. Use in protected pages. */
export function useRequireAuth() {
  const navigate = useNavigate();
  const auth = useAuth();

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      void navigate('/login', { replace: true });
    }
  }, [auth.isLoading, auth.isAuthenticated, navigate]);

  return auth;
}
