import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth, AUTH_QUERY_KEY } from '../hooks/useAuth';
import { loginMagicLink, loginGitHub, fetchMe, startGoogleOAuth } from '../api/auth';
import { setAccessToken } from '../api/client';
import styles from './LoginPage.module.css';

export function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect') ?? '/dashboard';
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  if (isLoading) {
    return <div className={styles.loading} aria-live="polite">Loading…</div>;
  }

  // Suppress the already-authenticated guard during an active login flow so that
  // setQueryData(AUTH_QUERY_KEY, ...) doesn't trigger a premature redirect to /dashboard
  // before navigate(redirectTo) fires (which may be /claim?t=... in the onboarding funnel).
  if (isAuthenticated && !isLoggingIn) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleMagicLink = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('sending');
    setErrorMsg('');
    try {
      const res = await loginMagicLink(email.trim());
      // If the server returned an access_token directly (MVP shortcut),
      // store it and navigate to dashboard immediately.
      if ('access_token' in res && res.access_token) {
        setIsLoggingIn(true);
        setAccessToken(res.access_token as string);
        // Immediately hydrate the auth cache with real user data.
        // Without this, React Query serves the stale null (from the failed
        // pre-login refresh) to the next page, making it think unauthenticated.
        try {
          const meData = await fetchMe();
          queryClient.setQueryData(AUTH_QUERY_KEY, meData);
        } catch {
          // Non-fatal — the next page will re-try auth on mount
        }
        void navigate(redirectTo, { replace: true });
        return;
      }
      // Otherwise show "check your inbox" (magic-link flow).
      setStatus('sent');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>⚡</span>
          <h1 className={styles.brandName}>instant.dev</h1>
          <p className={styles.tagline}>Zero-click developer infrastructure</p>
        </div>

        {status === 'sent' ? (
          <div className={styles.sentState} data-testid="magic-link-sent">
            <span className={styles.sentIcon}>📬</span>
            <h2 className={styles.sentTitle}>Check your inbox</h2>
            <p className={styles.sentBody}>
              We sent a magic link to <strong>{email}</strong>. Click it to sign in.
            </p>
            <button
              className={styles.resendBtn}
              onClick={() => setStatus('idle')}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={(e) => void handleMagicLink(e)} className={styles.form} noValidate>
              <div className={styles.fieldGroup}>
                <label htmlFor="email" className={styles.label}>
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  className={styles.input}
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  data-testid="email-input"
                />
              </div>

              {status === 'error' && (
                <p className={styles.error} role="alert" data-testid="login-error">
                  {errorMsg}
                </p>
              )}

              <button
                type="submit"
                className={styles.primaryBtn}
                disabled={status === 'sending' || !email.trim()}
                data-testid="magic-link-btn"
              >
                {status === 'sending' ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            <div className={styles.divider}>
              <span className={styles.dividerText}>or</span>
            </div>

            <div className={styles.oauthRow}>
              {import.meta.env.VITE_GOOGLE_CLIENT_ID ? (
                <button
                  type="button"
                  className={styles.googleBtn}
                  onClick={() => startGoogleOAuth(redirectTo)}
                  data-testid="google-oauth-btn"
                >
                  <svg className={styles.googleIcon} viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                  Continue with Google
                </button>
              ) : null}
              <button
                type="button"
                className={styles.githubBtn}
                onClick={() => void loginGitHub()}
                data-testid="github-oauth-btn"
              >
                <svg className={styles.githubIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
                Continue with GitHub
              </button>
            </div>

            <p className={styles.footer}>
              By signing in you agree to our{' '}
              <a href="https://instant.dev/terms" target="_blank" rel="noopener noreferrer">Terms</a>
              {' '}and{' '}
              <a href="https://instant.dev/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
