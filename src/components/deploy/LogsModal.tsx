import { useEffect, useRef, useState } from 'react';
import { getAccessToken } from '../../api/client';
import { agentStacksURL } from '../../api/stacks';
import styles from './DeployComponents.module.css';

type Props = {
  slug: string;
  service: string;
  onClose: () => void;
};

export function LogsModal({ slug, service, onClose }: Props) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const preRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const ac = new AbortController();
    const decoder = new TextDecoder();
    let buf = '';

    (async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(
          agentStacksURL(`/stacks/${encodeURIComponent(slug)}/logs/${encodeURIComponent(service)}`),
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            credentials: 'include',
            signal: ac.signal,
          },
        );
        if (!res.ok) {
          setError(`HTTP ${res.status}`);
          return;
        }
        const reader = res.body?.getReader();
        if (!reader) {
          setError('No response body');
          return;
        }
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const block of parts) {
            for (const line of block.split('\n')) {
              if (line.startsWith('data:')) {
                const payload = line.slice(5).trimStart();
                if (payload === '[end]') continue;
                setText((t) => (t ? `${t}\n${payload}` : payload));
              }
            }
          }
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).message);
      }
    })();

    return () => ac.abort();
  }, [slug, service]);

  useEffect(() => {
    preRef.current?.scrollTo({ top: preRef.current.scrollHeight });
  }, [text]);

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="logs-modal-title">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 id="logs-modal-title" className={styles.modalTitle}>
            Logs — {service}
          </h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {error ? (
          <p className={styles.modalError} role="alert">
            {error}
          </p>
        ) : (
          <pre ref={preRef} className={styles.logsPre}>
            {text || 'Waiting for log lines…'}
          </pre>
        )}
      </div>
    </div>
  );
}
