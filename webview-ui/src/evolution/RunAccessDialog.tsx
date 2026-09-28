import { useEffect, useRef, useState } from 'react';

import { KEY_PROVIDERS } from './providerLabels.js';
export function RunAccessDialog({
  onClose,
  onUnlock,
}: {
  onClose: () => void;
  onUnlock: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [provider, setProvider] = useState('typesafe');
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const response = await fetch('/api/arena/keys');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load account keys.');
    setSaved(data.keys.map((item: { provider: string }) => item.provider));
  }
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    void load().catch((error: Error) => setError(error.message));
    return () => {
      element?.close();
      prior?.focus();
    };
  }, []);
  async function save(remove = false) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/arena/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider, key, remove }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not update your key.');
      setKey('');
      await load();
      await onUnlock();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save key.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="run-access-dialog"
      aria-labelledby="run-access-title"
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id="run-access-title">Account API keys</h2>
        <p>Encrypted and saved to your account. Personal keys use your provider credits.</p>
        <label>
          Provider
          <select
            value={provider}
            disabled={busy}
            onChange={(event) => {
              setProvider(event.target.value);
              setKey('');
            }}
          >
            {Object.entries(KEY_PROVIDERS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
                {saved.includes(id) ? ' · key saved' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          {saved.includes(provider) ? 'Replace API key' : 'API key'}
          <input
            type="password"
            value={key}
            autoComplete="off"
            spellCheck={false}
            maxLength={4096}
            onChange={(event) => setKey(event.target.value)}
            disabled={busy}
          />
        </label>
        <p>Keys are never included in saved runs or exports.</p>
        {error && <p role="alert">{error}</p>}
        <div className="run-access-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !saved.includes(provider)}
            onClick={() => void save(true)}
          >
            Remove key
          </button>
          <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>
            Close
          </button>
          <button type="submit" className="primary-button" disabled={busy || !key.trim()}>
            Save to account
          </button>
        </div>
      </form>
    </dialog>
  );
}
