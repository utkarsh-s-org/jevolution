import { validateExperiments } from '../../core/src/evolution/experiments.js';
import { PROVIDER_KEYS } from '../../core/src/evolution/constants.js';
import type { ModelGroup, ModelObservation } from '../../core/src/evolution/types.js';
import { json, sameOrigin } from '../../server/src/evolution/hostedAuth.js';
import { choose, ProviderError } from '../../server/src/evolution/models.js';

export default {
  async fetch(request: Request) {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!sameOrigin(request)) return json({ error: 'Cross-origin access is disabled' }, 403);
    const apiKey = request.headers.get('x-provider-key')?.trim();
    if (!apiKey || apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey))
      return json({ error: 'Enter your own provider API key in API keys.' }, 401);
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      return json({ error: 'JSON required' }, 415);
    const text = await request.text();
    if (text.length > 128_000) return json({ error: 'Observation too large' }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }
    const group = body?.group as ModelGroup;
    const observation = body?.observation as ModelObservation;
    if (
      !group ||
      !Object.hasOwn(PROVIDER_KEYS, group.provider) ||
      group.controller !== 'model' ||
      typeof group.model !== 'string' ||
      !group.model.length ||
      group.model.length > 128 ||
      typeof group.label !== 'string' ||
      group.label.length > 80 ||
      !observation ||
      typeof observation !== 'object' ||
      Array.isArray(observation) ||
      !('rabbit' in observation || 'wolf' in observation) ||
      !Array.isArray(observation.choices) ||
      observation.choices.length < 1 ||
      observation.choices.length > 128 ||
      observation.choices.some(
        (choice) =>
          !choice ||
          typeof choice.id !== 'string' ||
          typeof choice.description !== 'string' ||
          choice.id.length > 128 ||
          choice.description.length > 2000,
      )
    )
      return json({ error: 'Invalid model observation' }, 400);
    try {
      const result = await choose(
        group,
        observation,
        AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]),
        {
          apiKey,
          relief: body.options?.relief !== false,
          predatorPrey: body.options?.predatorPrey === true,
          experiments: validateExperiments(body.options?.experiments),
        },
      );
      return json(result);
    } catch (error) {
      if (error instanceof ProviderError)
        return json(
          {
            error: 'Provider request failed. Check your key, model access, and quota.',
            status: error.status,
            retryAfterMs: error.retryAfterMs,

            latencyMs: error.latencyMs,
          },
          502,
        );
      return json({ error: 'Model request failed or timed out.' }, 502);
    }
  },
};
