import { useEffect, useRef, useState } from 'react';

import type { Provider } from '../../../core/src/evolution/types.js';
import { forgetDeviceKeys, KEY_PROVIDERS, readDeviceKeys, saveDeviceKeys } from './deviceKeys.js';
export function RunAccessDialog({
  onClose,
  onUnlock,
}: {
  onClose: () => void;
  onUnlock: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [keys, setKeys] = useState(readDeviceKeys);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      prior?.focus();
    };
  }, []);
  async function save(forget = false) {
    setBusy(true);
    setError('');
    try {
      if (forget) forgetDeviceKeys();
      else saveDeviceKeys(keys);
      await onUnlock();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not save keys. Check browser storage permissions.',
      );
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
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="run-access-title">Your API keys</h2>
        <p>Saved on this device. Calls use your provider account and credits.</p>
        <p>
          Keys pass through our server over HTTPS for each request. They are not saved on the server
          or included in exports. Browser storage can be read by scripts on this site; use
          restricted keys with provider spending limits.
        </p>
        {Object.entries(KEY_PROVIDERS).map(([provider, label]) => (
          <label key={provider} htmlFor={`key-${provider}`}>
            {label}
            <input
              id={`key-${provider}`}
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={4096}
              value={keys[provider as Provider] || ''}
              onChange={(e) => setKeys({ ...keys, [provider]: e.target.value })}
              disabled={busy}
            />
          </label>
        ))}
        {error && <p role="alert">{error}</p>}
        <div className="run-access-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void save(true)}
            disabled={busy}
          >
            Forget keys
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            Save on device
          </button>
        </div>
      </form>
    </dialog>
  );
}
