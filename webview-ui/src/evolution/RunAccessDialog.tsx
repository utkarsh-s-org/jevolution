import { useEffect, useRef, useState } from 'react';

export function RunAccessDialog({
  onClose,
  onUnlock,
}: {
  onClose: () => void;
  onUnlock: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previousFocus?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="run-access-dialog"
      aria-labelledby="run-access-title"
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError('');
          try {
            const response = await fetch('/api/arena/session', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ code: password }),
            });
            setPassword('');
            if (!response.ok) {
              const data = await response.json();
              throw new Error(data.error || 'Could not unlock simulation.');
            }
            await onUnlock();
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not unlock simulation.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="run-access-title">Unlock live runs</h2>
        <p>Explore freely. Running AI agents requires the private password.</p>
        <label htmlFor="run-password">Run password</label>
        <input
          id="run-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          maxLength={256}
          required
        />
        {error && (
          <p className="access-error" role="alert">
            {error}
          </p>
        )}
        <div className="access-actions">
          <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>
            Keep browsing
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
        <small>Access lasts one hour. Use Lock when you finish.</small>
      </form>
    </dialog>
  );
}
