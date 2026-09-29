import { useEffect, useRef, useState } from 'react';

import App from './App.js';
import { closeHostedClient, HOSTED } from './hostedClient.js';
import { LandingClip } from './LandingClip.js';
import { CardBody, CardContainer, CardItem } from './ThreeDCard.js';

type Session = { configured: boolean; user: { id: string; email: string } | null };

export default function AccountGateway() {
  const accountId = useRef<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const [page, setPage] = useState(
    location.hash === '#account' ? 'account' : location.hash === '#sample' ? 'sample' : 'home',
  );
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!HOSTED) return;
    // Retire plaintext device credentials. They are never silently uploaded.
    try {
      localStorage.removeItem('jevolution.provider-keys.v1');
    } catch {
      /* Storage may be disabled. */
    }
    const controller = new AbortController();
    const refresh = async () => {
      const params = new URLSearchParams(location.hash.slice(1));
      if (params.has('error')) {
        history.replaceState(null, '', location.pathname + '#account');
        setPage('account');
        setMode('login');
        setError(
          'That confirmation link has expired or was already used. Log in, or request a new link below.',
        );
      }
      const access_token = params.get('access_token'),
        refresh_token = params.get('refresh_token');
      if (access_token && refresh_token) {
        history.replaceState(null, '', location.pathname + '#account');
        setPage('account');
        setMode('login');
        const response = await fetch('/api/arena/account', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'confirm', access_token, refresh_token }),
          signal: controller.signal,
        });
        if (!response.ok)
          setError('Email confirmation expired. Log in, or request a new link below.');
      }
      const response = await fetch('/api/arena/account', {
        signal: controller.signal,
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Account service unavailable. Please try again later.');
      const next = await response.json();
      if (accountId.current && accountId.current !== next.user?.id) closeHostedClient();
      accountId.current = next.user?.id || null;
      setSession(next);
    };
    const check = () =>
      void refresh().catch((error: Error) => {
        if (error.name !== 'AbortError') setError(error.message);
      });
    check();
    const timer = setInterval(check, 300000);
    window.addEventListener('focus', check);
    const channel = new BroadcastChannel('jevolution-account');
    channel.onmessage = () => {
      closeHostedClient();
      location.reload();
    };
    const navigate = () =>
      setPage(
        location.hash === '#account' ? 'account' : location.hash === '#sample' ? 'sample' : 'home',
      );
    window.addEventListener('hashchange', navigate);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', check);
      channel.close();
      window.removeEventListener('hashchange', navigate);
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);
  if (!HOSTED) return <App />;
  if (page === 'sample' && !session?.user)
    return (
      <App
        onSignIn={() => {
          closeHostedClient();
          setPage('account');
          location.hash = 'account';
        }}
      />
    );
  if (session?.user)
    return (
      <App
        key={session.user.id}
        onLogout={() => {
          closeHostedClient();
          setSession({ configured: true, user: null });
          location.hash = 'account';
          const channel = new BroadcastChannel('jevolution-account');
          channel.postMessage('logout');
          channel.close();
        }}
      />
    );
  const navigate = (next: string) => {
    location.hash = next === 'home' ? '' : next;
    setPage(next);
    setError('');
  };
  return (
    <div className="welcome-page">
      <header className="welcome-nav">
        <button className="brand" onClick={() => navigate('home')}>
          <img src="/favicon.png" alt="" width="36" height="36" />
          jevolution
        </button>
        <button
          className="secondary-button"
          onClick={() => {
            setMode('login');
            navigate('account');
          }}
        >
          Log in
        </button>
      </header>
      <main className="welcome-main">
        {page === 'home' ? (
          <>
            <section className="welcome-hero">
              <div>
                <p className="welcome-eyebrow">A living multi-agent experiment</p>
                <h1>
                  One habitat.
                  <br />
                  Thousands of decisions.
                </h1>
                <p className="welcome-intro">
                  Build a world for AI agents. Change the conditions, watch how they interact, and
                  explore the data behind their survival.
                </p>
                <button
                  className="primary-button"
                  onClick={() => {
                    setMode('signup');
                    navigate('account');
                  }}
                >
                  Get started <span aria-hidden="true">↗</span>
                </button>
                <button
                  className="secondary-button explore-sample"
                  onClick={() => navigate('sample')}
                >
                  Explore a sample · no key needed
                </button>
                <p className="welcome-caption">Rabbits, wolves, and a world you can change.</p>
              </div>
              <CardContainer className="welcome-card">
                <CardBody>
                  <CardItem translateZ={50} className="card3d-title">
                    Watch a living ecosystem
                  </CardItem>
                  <CardItem as="p" translateZ={60} className="card3d-text">
                    Every rabbit and wolf is its own Jev agent. Hover to step inside the habitat.
                  </CardItem>
                  <CardItem translateZ={100} className="card3d-media">
                    <LandingClip />
                  </CardItem>
                  <div className="card3d-actions">
                    <CardItem
                      translateZ={20}
                      as="button"
                      className="card3d-link"
                      onClick={() => navigate('sample')}
                    >
                      Try now →
                    </CardItem>
                    <CardItem
                      translateZ={20}
                      as="button"
                      className="primary-button"
                      onClick={() => {
                        setMode('signup');
                        navigate('account');
                      }}
                    >
                      Sign up
                    </CardItem>
                  </div>
                </CardBody>
              </CardContainer>
            </section>
            <section className="welcome-features" aria-label="What you can explore">
              <article>
                <span>01 / HABITAT</span>
                <h2>Shape the environment</h2>
                <p>Edit terrain and adjust food, temperature, predators, and communication.</p>
              </article>
              <article>
                <span>02 / AGENTS</span>
                <h2>See each decision</h2>
                <p>
                  Follow an animal. Inspect model responses, signals, traits, and measured latency.
                </p>
              </article>
              <article>
                <span>03 / EXPERIMENTS</span>
                <h2>Keep the evidence</h2>
                <p>
                  Replay a run, compare populations, and export results with their settings and
                  seed.
                </p>
              </article>
            </section>
            <p className="welcome-footnote">
              An experimental AI sandbox. Simulated behavior is not a validated model of real
              wildlife.
            </p>
          </>
        ) : (
          <section className="account-card">
            <p className="welcome-eyebrow">Your next experiment starts here</p>
            <h1>{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
            <p>Keep your provider settings with your account, across devices.</p>
            <div className="account-tabs">
              <button
                aria-pressed={mode === 'signup'}
                onClick={() => {
                  setMode('signup');
                  setError('');
                }}
              >
                Create account
              </button>
              <button
                aria-pressed={mode === 'login'}
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
              >
                Log in
              </button>
            </div>
            {!session ? (
              <p role="status">{error || 'Connecting to account service…'}</p>
            ) : (
              !session.configured && (
                <p className="account-notice" role="status">
                  Account setup is in progress. Sign-up and login will be available once the account
                  service is connected.
                </p>
              )
            )}
            <form
              ref={form}
              onSubmit={async (event) => {
                event.preventDefault();
                if (!session?.configured || busy) return;
                setBusy(true);
                setError('');
                setMessage('');
                const values = new FormData(event.currentTarget);
                try {
                  const response = await fetch('/api/arena/account', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                      action: mode,
                      email: values.get('email'),
                      password: values.get('password'),
                    }),
                  });
                  const data = await response.json();
                  if (!response.ok)
                    throw new Error(data.error || 'Could not sign in. Please try again.');
                  if (data.message) {
                    setMessage(data.message);
                    setMode('login');
                  }
                  closeHostedClient();
                  accountId.current = data.user?.id || null;
                  setSession(data);
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Could not sign in.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={!session?.configured || busy}
                />
              </label>
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'signup' ? 12 : undefined}
                  maxLength={256}
                  disabled={!session?.configured || busy}
                />
              </label>
              {message && <p role="status">{message}</p>}
              {session && error && <p role="alert">{error}</p>}
              <button className="primary-button" disabled={!session?.configured || busy}>
                {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Log in'}
              </button>
            </form>
            {mode === 'login' && (
              <button
                className="account-back"
                disabled={!session?.configured || busy}
                onClick={async () => {
                  const email = form.current?.querySelector<HTMLInputElement>('[name="email"]');
                  if (!email?.reportValidity()) return;
                  setBusy(true);
                  setError('');
                  setMessage('');
                  try {
                    const response = await fetch('/api/arena/account', {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify({ action: 'resend', email: email.value }),
                    });
                    const data = await response.json();
                    if (!response.ok) throw new Error(data.error || 'Could not send confirmation.');
                    setMessage(data.message);
                  } catch (error) {
                    setError(
                      error instanceof Error ? error.message : 'Could not send confirmation.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Resend confirmation email
              </button>
            )}
            <button className="account-back" onClick={() => navigate('home')}>
              ← Back to overview
            </button>
          </section>
        )}
      </main>
    </div>
  );
}
