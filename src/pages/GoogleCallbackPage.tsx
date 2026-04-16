import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AUTH_QUERY_KEY } from '../hooks/useAuth';
import {
  completeGoogleLogin,
  fetchMe,
  getGoogleOAuthRedirectURI,
  OAUTH_REDIRECT_STORAGE_KEY,
} from '../api/auth';
import { setAccessToken } from '../api/client';
import styles from './LoginPage.module.css';

export function GoogleCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('Signing in with Google…');

  useEffect(() => {
    const err = searchParams.get('error');
    if (err) {
      setMessage(`Google sign-in was cancelled or failed (${err}).`);
      return;
    }

    const code = searchParams.get('code');
    if (!code) {
      setMessage('Missing authorization code. Return to the login page and try again.');
      return;
    }

    const redirectTo = sessionStorage.getItem(OAUTH_REDIRECT_STORAGE_KEY) ?? '/dashboard';

    let cancelled = false;
    void (async () => {
      try {
        const res = await completeGoogleLogin(code, getGoogleOAuthRedirectURI());
        if (cancelled) return;
        if (!res.ok || !res.access_token) {
          setMessage(res.message ?? 'Sign-in failed. Try again from the login page.');
          return;
        }
        setAccessToken(res.access_token);
        sessionStorage.removeItem(OAUTH_REDIRECT_STORAGE_KEY);
        try {
          const meData = await fetchMe();
          queryClient.setQueryData(AUTH_QUERY_KEY, meData);
        } catch {
          // Non-fatal — downstream pages will refresh auth
        }
        void navigate(redirectTo, { replace: true });
      } catch (e) {
        if (cancelled) return;
        setMessage(e instanceof Error ? e.message : 'Sign-in failed. Try again from the login page.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, queryClient, searchParams]);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.tagline} style={{ textAlign: 'center', margin: 0 }}>
          {message}
        </p>
        <p style={{ textAlign: 'center', margin: 0 }}>
          <Link to="/login">Back to login</Link>
        </p>
      </div>
    </div>
  );
}
