import type { Provider } from '../../../core/src/evolution/types.js';
export type DeviceKeys = Partial<Record<Provider, string>>;
const STORAGE_KEY = 'jevolution.provider-keys.v1';
export const KEY_PROVIDERS = {
  typesafe: 'Jev',
  anthropic: 'Claude',
  openai: 'OpenAI',
  google: 'Gemini',
} as const;
export function readDeviceKeys(): DeviceKeys {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return Object.fromEntries(
      Object.keys(KEY_PROVIDERS)
        .filter((k) => typeof raw?.[k] === 'string')
        .map((k) => [k, raw[k]]),
    );
  } catch {
    return {};
  }
}
export function saveDeviceKeys(keys: DeviceKeys) {
  const clean = Object.fromEntries(
    Object.keys(KEY_PROVIDERS).map((k) => [k, keys[k as Provider]?.trim() || '']),
  );
  if (Object.values(clean).some((key) => key && (key.length > 4096 || /[^\x21-\x7e]/.test(key))))
    throw new Error('API keys must contain printable characters without spaces.');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
}
export function forgetDeviceKeys() {
  localStorage.removeItem(STORAGE_KEY);
}
