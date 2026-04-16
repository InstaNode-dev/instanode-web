import { useMemo, useState } from 'react';
import {
  agentStacksURL,
  createStackDeployment,
  redeployStack,
} from '../../api/stacks';
import styles from './DeployComponents.module.css';

function parseServiceKeys(yaml: string): string[] {
  const lines = yaml.split('\n');
  let inServices = false;
  const keys: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const trimmed = line.trim();
    if (/^services:\s*$/.test(trimmed)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (trimmed && !line.startsWith(' ') && !line.startsWith('\t')) {
      break;
    }
    const m = line.match(/^\s{2}([a-zA-Z0-9_-]+):\s*$/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

type Tab = 'upload' | 'curl';

type Props = {
  mode: 'create' | 'redeploy';
  redeploySlug?: string;
  onClose: () => void;
  onSuccess: () => void;
};

const exampleManifest = `services:
  api:
    build: .
    port: 8080
    expose: true
`;

export function NewDeploymentModal({ mode, redeploySlug, onClose, onSuccess }: Props) {
  const [tab, setTab] = useState<Tab>('upload');
  const [manifest, setManifest] = useState(mode === 'create' ? exampleManifest : exampleManifest);
  const [stackLabel, setStackLabel] = useState('');
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const serviceKeys = useMemo(() => parseServiceKeys(manifest), [manifest]);

  const curlSnippet = useMemo(() => {
    const path =
      mode === 'redeploy' && redeploySlug
        ? `/stacks/${encodeURIComponent(redeploySlug)}/redeploy`
        : '/stacks/new';
    const url = agentStacksURL(path);
    const keys = serviceKeys.length ? serviceKeys : ['api'];
    const chunks: string[] = [
      `curl -X POST ${url} \\`,
      `  -H "Authorization: Bearer $ACCESS_TOKEN" \\`,
      `  -F "manifest=@instant.yaml"`,
    ];
    if (mode === 'create' && stackLabel.trim()) {
      chunks[chunks.length - 1] += ' \\';
      chunks.push(`  -F "name=${stackLabel.trim()}"`);
    }
    for (const k of keys) {
      chunks[chunks.length - 1] += ' \\';
      chunks.push(`  -F "${k}=@${k}.tar.gz"`);
    }
    return chunks.join('\n');
  }, [mode, redeploySlug, serviceKeys, stackLabel]);

  const handleSubmit = async () => {
    setSubmitErr(null);
    if (!manifest.trim()) {
      setSubmitErr('Manifest is required.');
      return;
    }
    if (serviceKeys.length === 0) {
      setSubmitErr('No services found under services: in the manifest.');
      return;
    }
    if (mode === 'redeploy' && !redeploySlug?.trim()) {
      setSubmitErr('Missing stack slug for redeploy.');
      return;
    }
    for (const k of serviceKeys) {
      if (!files[k]) {
        setSubmitErr(`Missing tarball for service “${k}”.`);
        return;
      }
    }

    const fd = new FormData();
    fd.append('manifest', manifest);
    if (mode === 'create' && stackLabel.trim()) {
      fd.append('name', stackLabel.trim());
    }
    for (const k of serviceKeys) {
      const f = files[k];
      if (f) fd.append(k, f, f.name);
    }

    setSubmitting(true);
    try {
      if (mode === 'redeploy') {
        await redeployStack(redeploySlug!, fd);
      } else {
        await createStackDeployment(fd);
      }
      onSuccess();
      onClose();
    } catch (e) {
      setSubmitErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="new-deploy-title">
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h2 id="new-deploy-title" className={styles.modalTitle}>
            {mode === 'redeploy' ? `Redeploy ${redeploySlug}` : 'New deployment'}
          </h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className={styles.modalBody}>
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'upload' ? styles.tabActive : ''}`}
              onClick={() => setTab('upload')}
              data-testid="deploy-modal-tab-upload"
            >
              Upload
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'curl' ? styles.tabActive : ''}`}
              onClick={() => setTab('curl')}
              data-testid="deploy-modal-tab-curl"
            >
              curl command
            </button>
          </div>

          {tab === 'curl' ? (
            <>
              <p className={styles.hint}>
                Use the same JWT as the dashboard session in <code>ACCESS_TOKEN</code> (from your API client or
                browser devtools). Tarballs must be gzip-compressed tar archives of each service build context.
              </p>
              <pre className={styles.curlBox} data-testid="deploy-curl-snippet">
                {curlSnippet}
              </pre>
            </>
          ) : (
            <>
              {mode === 'create' && (
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="stack-label">
                    Display name (optional)
                  </label>
                  <input
                    id="stack-label"
                    className={styles.serviceInput}
                    style={{ width: '100%', maxWidth: 360 }}
                    value={stackLabel}
                    onChange={(e) => setStackLabel(e.target.value)}
                    placeholder="my-api"
                    data-testid="deploy-name-input"
                  />
                </div>
              )}
              <div className={styles.field}>
                <label className={styles.label} htmlFor="manifest-yaml">
                  instant.yaml
                </label>
                <textarea
                  id="manifest-yaml"
                  className={styles.textarea}
                  value={manifest}
                  onChange={(e) => setManifest(e.target.value)}
                  data-testid="deploy-manifest-input"
                />
                <p className={styles.hint}>
                  Detected services: {serviceKeys.length ? serviceKeys.join(', ') : '—'}
                </p>
              </div>
              {serviceKeys.map((k) => (
                <div key={k} className={styles.field}>
                  <label className={styles.label} htmlFor={`tar-${k}`}>
                    Tarball for “{k}”
                  </label>
                  <input
                    id={`tar-${k}`}
                    type="file"
                    accept=".tar,.gz,.tgz,application/gzip,application/x-tar"
                    data-testid={`deploy-tarball-${k}`}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setFiles((prev) => ({ ...prev, [k]: f }));
                    }}
                  />
                </div>
              ))}
              {submitErr ? (
                <p className={styles.modalError} role="alert">
                  {submitErr}
                </p>
              ) : null}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={submitting}
                  onClick={() => void handleSubmit()}
                  data-testid="deploy-submit-btn"
                >
                  {submitting ? 'Uploading…' : mode === 'redeploy' ? 'Redeploy' : 'Deploy'}
                </button>
                <button type="button" className={styles.actionBtn} onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
