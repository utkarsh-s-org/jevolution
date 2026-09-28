import {
  DEFAULT_GROUPS,
  PREDATOR_PREY_RULES as PP,
  PROVIDER_KEYS,
  RULES,
} from '../../../core/src/evolution/constants.js';
import { ProviderError } from '../../../core/src/evolution/providerError.js';
import type {
  Decision,
  ModelGroup,
  ModelObservation,
  NativeDecisionResponse,
  Result,
} from '../../../core/src/evolution/types.js';

export const MODEL_DEFAULTS = { jev: 'jev-1.13.0', claude: 'claude-haiku-4-5-20251001' } as const;
// Predator–prey turns off food carrying and sharing, so its rabbits skip that paragraph.
export const PREY_INSTRUCTIONS =
  'You control one rabbit in a continuously moving ecosystem. Choose exactly one supplied legal action. Survive, maintain food energy and hydration, and reproduce with your lineage. Wolves can kill you while you wait. Use only your local observation and supplied personal memory. A movement action follows a path until another decision replaces it. Foraging and drinking continue on arrival. Rest conserves energy but cannot replenish it. Mating requires BOTH rabbits to choose each other and both to be healthy mature and nearby, and costs energy. Your inherited traits have engine-enforced tradeoffs: speed raises movement and energy use; vigilance widens vision and costs metabolism; thrift saves metabolism but slows movement and eating; fertility shortens reproduction cooldown but costs more energy; sociability increases signal range and signal cost. Memory contains only your own prior sightings at decision times, with ages: at most 4 food locations for 120 seconds, 2 water locations for 180 seconds, and 4 wolf sightings for 20 seconds. Old food may be depleted and wolves may have moved. Revisit choices let you inspect remembered locations. Memory is not inherited or shared automatically. You can observe neighbors moving and choose to follow a visible rabbit; tracking stops when it leaves sight. Receiving a signal never forces an action. Signals are optional, local, audible to either lineage, delayed, and cost energy. They refer to your current position and can be wrong. Choose the action and signal that best balance your survival and descendants. Do not provide a written explanation.';
export const PREDATOR_PREY_RABBIT_INSTRUCTIONS = PREY_INSTRUCTIONS.replace(
  'Mating requires BOTH rabbits to choose each other and both to be healthy mature and nearby, and costs energy.',
  `Breeding happens automatically when you are mature, have at least ${PP.breedEnergy} energy and ${PP.breedWater} water, and your cooldown permits it. No mate choice is required. Crowding can prevent births, and births cost energy; fertility changes the cost and cooldown. Focus your decisions on survival and resources.`,
);
export const INSTRUCTIONS = PREY_INSTRUCTIONS.replace(
  ' Do not provide a written explanation.',
  ` You can carry up to 4 food units: collect removes food from the ground without eating it; eatCargo feeds yourself; share delivers it to a visible hungry rabbit; deposit and withdraw use communal caches at burrows. Every unit restores 4 energy. Caches are open to either lineage. Sharing is optional and costs you inventory; help is an optional request for food below 55 energy. During drought, exposed grass withers; forest and lakeside patches retain food better, and carried or cached food is protected. Choose whether to prepare, deliver, or conserve based on your local situation. Do not provide a written explanation.`,
);

export const WOLF_INSTRUCTIONS =
  'You control one wolf in a continuously moving ecosystem. Choose one supplied legal action to survive, catch rabbits, and reproduce with your lineage. Use only your local observation: shelters exclude attacks, hiding forest rabbits are visible only within 2 tiles, and ordinary sight is 10 tiles with terrain occlusion. Hunting tracks your chosen prey only while visible. All wolves have identical movement speed and an 18-second eating cooldown after a catch, during which they cannot attack and move more slowly. You may rest, patrol, or choose a visible prey when hungry. Nearby wolves are observations, not commands. You may also choose a supplied mate action; mating requires both wolves to choose each other. Read lifeCycle in your observation. In dynamic mode, energy drains by 0.6 per second plus 0.1 per tile moved; catching a rabbit restores 45 energy (maximum 100). Zero energy causes starvation and age above 240 seconds causes death. Birth requires two living wolves from the same group, both at least 30 seconds old, with at least 95 energy and no reproduction cooldown. Both must choose each other as mates and meet within 1.7 tiles with a free nearby land tile and fewer than 32 wolves. Each parent pays 50 energy and waits 45 seconds before another birth. A catch alone never produces offspring; hunting funds the energy needed for mating. In fixed mode, population is held constant with no energy loss, births or deaths. Signals are not supported; choose none. Do not provide a written explanation.';

// Predator–prey wolves follow different rules (solo pups, no old age, encounter kills, scent),
// so they get their own text, built from the preset's numbers so it cannot drift.
export const PREDATOR_PREY_WOLF_INSTRUCTIONS = [
  'You control one wolf hunting rabbits in a continuously moving ecosystem. Choose exactly one supplied legal action.',
  `Your energy drains by ${PP.wolfMetabolism} per second (maximum 100); at 0 you starve. There is no old age.`,
  `Catching a rabbit restores ${PP.wolfMealEnergy} energy. You catch any exposed rabbit you reach, not only the one you chase; after a catch you rest ${PP.wolfEatCooldown} seconds.`,
  `With at least ${PP.wolfBreedEnergy} energy you automatically have a pup beside you; it costs ${PP.wolfBreedCost} energy and you wait ${PP.wolfBreedCooldown} seconds before the next. No mate is needed, so hunting is how you raise pups.`,
  `Sight is ${PP.wolfSight} tiles with terrain occlusion. Rabbits in burrows are safe; rabbits hiding in forest are visible only within ${PP.shelteredWolfRange} tiles.`,
  `Hunt actions chase one visible rabbit while it stays visible.${PP.wolfScent ? ' When no rabbit is in sight, following the scent moves you toward the nearest rabbits.' : ''} Patrols move you in a fixed direction to find prey. Resting never feeds you.`,
  'Signals are not supported; choose none. Do not provide a written explanation.',
].join(' ');

export { ProviderError } from '../../../core/src/evolution/providerError.js';
export function defaultGroups(): ModelGroup[] {
  return DEFAULT_GROUPS.map((g) => ({
    ...g,
    model:
      (g.id === 'jev'
        ? process.env.JEV_MODEL
        : g.id === 'claude'
          ? process.env.CLAUDE_MODEL
          : undefined) || g.model,
  }));
}
export function providerReadiness() {
  return Object.fromEntries(
    Object.entries(PROVIDER_KEYS).map(([p, key]) => [p, !!process.env[key]]),
  ) as Record<ModelGroup['provider'], boolean>;
}
function validateDecision(value: unknown, observation: ModelObservation): Decision {
  if (!value || typeof value !== 'object') throw new ProviderError('Malformed decision object');
  const d = value as Record<string, unknown>;
  if (
    typeof d.choice !== 'string' ||
    !observation.choices.some((c) => c.id === d.choice) ||
    typeof d.signal !== 'string' ||
    !('wolf' in observation ? ['none'] : ['none', 'danger', 'food', 'follow', 'help']).includes(
      d.signal,
    )
  )
    throw new ProviderError('Provider returned an invalid choice or signal');
  return { choice: d.choice, signal: d.signal as Decision['signal'] };
}
export async function choose(
  group: ModelGroup,
  observation: ModelObservation,
  signal: AbortSignal,
  {
    relief = true,
    predatorPrey = false,
    cooperation = false,
  }: { relief?: boolean; predatorPrey?: boolean; cooperation?: boolean } = {},
): Promise<Result> {
  if (group.controller === 'deterministic')
    throw new ProviderError('Deterministic wolves do not use a model API');
  let instructions =
    'wolf' in observation
      ? predatorPrey
        ? PREDATOR_PREY_WOLF_INSTRUCTIONS
        : WOLF_INSTRUCTIONS
      : predatorPrey
        ? PREDATOR_PREY_RABBIT_INSTRUCTIONS
        : relief
          ? INSTRUCTIONS
          : PREY_INSTRUCTIONS;
  if (cooperation && !('wolf' in observation)) {
    instructions = instructions
      .replace(
        'Survive, maintain food energy and hydration, and reproduce with your lineage.',
        'Keep the rabbit community alive across all model groups, while maintaining your own food energy and hydration. Weigh the benefit of helping against risk and cost; needless sacrifice is not required.',
      )
      .replace(
        'Choose the action and signal that best balance your survival and descendants.',
        'Choose the action and signal that best support community survival, including your own.',
      )
      .replace(
        'Foraging and drinking continue on arrival.',
        predatorPrey
          ? 'Foraging and drinking continue on arrival.'
          : 'Foraging lasts a short bout after arrival and then stops until a new decision; drinking continues on arrival.',
      )
      .replace(
        'Rest conserves energy but cannot replenish it.',
        'Rest avoids movement cost but still consumes baseline metabolism and cannot replenish energy.',
      );
    instructions += predatorPrey
      ? ' Your legal choices may include warning a visible neighbor and moving toward visible cover, accepting a warning, continuing that movement or declining. Warnings contain only an old wolf sighting, not live tracking. Respond using your current local view. Shelters exclude attacks; arriving in forest alone does not confer hiding: choose an ordinary hide action later when offered. A task completes only after you physically reach cover; it never certifies safety or longer survival. Choosing another action may abandon the task. There are no food-delivery tasks in this preset. Requests never force compliance.'
      : ' Your legal choices may include requesting food, accepting a request, continuing a delivery or declining it. Acceptance commits your current cargo and movement; choosing a different action can abandon the task. Successful delivery is determined by actual food transfer, not a promise. When you have surplus energy, consider collecting food to carry for nearby hungry rabbits. Only use the supplied local inbox and choices. Requests never force you to comply.';
  }
  // "Need food" is offered only to a rabbit that is actually hungry, and only with relief on.
  const hungry =
    relief && 'rabbit' in observation && observation.rabbit.energy < RULES.hungryEnergy;
  const started = performance.now();
  const { provider, model } = group;
  const choices = Object.fromEntries(observation.choices.map((c) => [c.id, c.description]));
  const signals =
    'wolf' in observation
      ? { none: 'Do not signal.' }
      : {
          // "none" first: models favor the first option. Each signal says when to use it and why.
          none: 'Do not signal. The default when nothing below applies.',
          danger:
            'Danger: use when a wolf is in sight. Warns nearby allies so they can hide or flee in time.',
          food: 'Food here: use when you are on a patch with food to spare. Nearby allies can come and eat instead of searching.',
          follow:
            'Follow me: use when you are heading to food, water, or safety. Nearby allies can follow you there.',
          ...(hungry
            ? {
                help: 'Need food: your energy is low. Asks nearby rabbits to bring you food; at most once every 6 seconds.',
              }
            : {}),
        };
  const parameters = {
    type: 'object',
    properties: {
      choice: { type: 'string', enum: Object.keys(choices) },
      signal: { type: 'string', enum: Object.keys(signals) },
    },
    required: ['choice', 'signal'],
    additionalProperties: false,
  };
  const description = 'Choose one supplied legal action ID and one optional local signal.';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const key = process.env[PROVIDER_KEYS[provider]];
  if (!key) throw new ProviderError(`Missing ${PROVIDER_KEYS[provider]}`, 401);
  let url: string;
  let body: object;
  if (provider === 'typesafe') {
    url = 'https://api.typesafe.ai/v1/systemone';
    headers.Authorization = `Bearer ${key}`;
    body = {
      model,
      state: observation,
      questions: {
        action: { type: 'choice', instructions, criteria: choices },
        signal: {
          type: 'choice',
          instructions: `${instructions} Choose only the optional local signal.`,
          criteria: signals,
        },
      },
    };
  } else if (provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages';
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model,
      max_tokens: 512,
      system: instructions,
      messages: [{ role: 'user', content: JSON.stringify(observation) }],
      tools: [{ name: 'choose_action', description, input_schema: parameters }],
      tool_choice: { type: 'tool', name: 'choose_action', disable_parallel_tool_use: true },
    };
  } else if (provider === 'openai') {
    url = 'https://api.openai.com/v1/responses';
    headers.Authorization = `Bearer ${key}`;
    body = {
      model,
      store: false,
      instructions,
      input: JSON.stringify(observation),
      max_output_tokens: 2048,
      ...(model === 'gpt-5.6-luna' ? { reasoning: { effort: 'none' } } : {}),
      tools: [{ type: 'function', name: 'choose_action', description, parameters, strict: true }],
      tool_choice: { type: 'function', name: 'choose_action' },
      parallel_tool_calls: false,
    };
  } else {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    headers['x-goog-api-key'] = key;
    body = {
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(observation) }] }],
      tools: [
        {
          functionDeclarations: [
            { name: 'choose_action', description, parametersJsonSchema: parameters },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['choose_action'] },
      },
      generationConfig: { maxOutputTokens: 2048 },
    };
  }
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after');
    const retryAfterMs = retryAfter
      ? Math.max(
          0,
          Number.isFinite(Number(retryAfter))
            ? Number(retryAfter) * 1000
            : Date.parse(retryAfter) - Date.now(),
        )
      : 0;
    // Provider bodies can contain echoed input or credentials; never forward them to the browser/log.
    throw new ProviderError(
      `${group.label} API returned HTTP ${response.status}`,
      response.status,
      retryAfterMs,
    );
  }
  const data = (await response.json()) as {
    model?: string;
    modelVersion?: string;
    answers?: { action?: { choice?: string }; signal?: { choice?: string } };
    content?: { type: string; name?: string; input?: unknown }[];
    output?: { type: string; name?: string; arguments?: string }[];
    candidates?: { content?: { parts?: { functionCall?: { name: string; args: unknown } }[] } }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  };
  const block =
    provider === 'typesafe'
      ? data.answers
      : provider === 'anthropic'
        ? data.content?.find((c) => c.type === 'tool_use' && c.name === 'choose_action')
        : provider === 'openai'
          ? data.output?.find((c) => c.type === 'function_call' && c.name === 'choose_action')
          : data.candidates?.[0]?.content?.parts?.find(
              (p) => p.functionCall?.name === 'choose_action',
            )?.functionCall;
  const json = JSON.stringify(block ?? null, null, 2);
  const nativeResponse: NativeDecisionResponse = {
    format: provider === 'typesafe' ? 'Structured answers' : 'Tool call',
    json: json.slice(0, 12000),
    truncated: json.length > 12000,
  };
  let decision: Decision;
  try {
    let raw: unknown;
    if (provider === 'typesafe')
      raw = { choice: data.answers?.action?.choice, signal: data.answers?.signal?.choice };
    else if (provider === 'anthropic')
      raw = data.content?.find((c) => c.type === 'tool_use' && c.name === 'choose_action')?.input;
    else if (provider === 'openai') {
      try {
        raw = JSON.parse(
          data.output?.find((c) => c.type === 'function_call' && c.name === 'choose_action')
            ?.arguments || 'null',
        );
      } catch {
        throw new ProviderError('Provider returned malformed action JSON');
      }
    } else
      raw = data.candidates?.[0]?.content?.parts?.find(
        (p) => p.functionCall?.name === 'choose_action',
      )?.functionCall?.args;
    decision = validateDecision(raw, observation);
  } catch (error) {
    if (error instanceof ProviderError) {
      error.nativeResponse = nativeResponse;
      error.latencyMs = performance.now() - started;
    }
    throw error;
  }
  return {
    decision,
    nativeResponse,
    model: data.model || data.modelVersion || model,
    inputTokens: data.usage?.input_tokens ?? data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens:
      data.usage?.output_tokens ??
      (data.usageMetadata?.candidatesTokenCount || 0) +
        (data.usageMetadata?.thoughtsTokenCount || 0),
    latencyMs: performance.now() - started,
    requestId: response.headers.get('request-id') || response.headers.get('x-request-id'),
  };
}
