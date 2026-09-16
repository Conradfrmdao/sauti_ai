/**
 * Provider selection is a safety control, not a preference: a stray
 * OPENROUTER_API_KEY must never quietly put 12-27s models on the voice path.
 * Deterministic, no network.
 */
import assert from "node:assert/strict";

const { providerOrder, openRouterEnabled } = await import("../lib/ai/provider");

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const GEM = "test-gemini-key";
const OR = "test-openrouter-key";

// Default: Gemini only, even with an OpenRouter key sitting in the environment.
withEnv({ GEMINI_API_KEY: GEM, OPENROUTER_API_KEY: OR, OPENROUTER_ENABLED: undefined, REASONING_PROVIDER: undefined }, () => {
  assert.equal(openRouterEnabled(), false, "OpenRouter must be off unless switched on");
  assert.deepEqual(providerOrder(), ["gemini"]);
});

// Explicitly enabled: Gemini leads, OpenRouter backs it up.
withEnv({ GEMINI_API_KEY: GEM, OPENROUTER_API_KEY: OR, OPENROUTER_ENABLED: "true", REASONING_PROVIDER: undefined }, () => {
  assert.equal(openRouterEnabled(), true);
  assert.deepEqual(providerOrder(), ["gemini", "openrouter"]);
});

// Flipped: OpenRouter leads, Gemini backs it up.
withEnv({ GEMINI_API_KEY: GEM, OPENROUTER_API_KEY: OR, OPENROUTER_ENABLED: undefined, REASONING_PROVIDER: "openrouter" }, () => {
  assert.equal(openRouterEnabled(), true, "naming it as the provider implies enabling it");
  assert.deepEqual(providerOrder(), ["openrouter", "gemini"]);
});

// No Gemini key: falls to OpenRouter only when it is actually enabled.
withEnv({ GEMINI_API_KEY: undefined, OPENROUTER_API_KEY: OR, OPENROUTER_ENABLED: "true", REASONING_PROVIDER: undefined }, () => {
  assert.deepEqual(providerOrder(), ["openrouter"]);
});

withEnv({ GEMINI_API_KEY: undefined, OPENROUTER_API_KEY: OR, OPENROUTER_ENABLED: undefined, REASONING_PROVIDER: undefined }, () => {
  assert.deepEqual(providerOrder(), [], "nothing configured means nothing runs, not a silent slow path");
});

// "1" is as good as "true".
withEnv({ GEMINI_API_KEY: GEM, OPENROUTER_API_KEY: OR, OPENROUTER_ENABLED: "1", REASONING_PROVIDER: undefined }, () => {
  assert.deepEqual(providerOrder(), ["gemini", "openrouter"]);
});

// An enable flag with no key is still no provider.
withEnv({ GEMINI_API_KEY: GEM, OPENROUTER_API_KEY: undefined, OPENROUTER_ENABLED: "true", REASONING_PROVIDER: undefined }, () => {
  assert.equal(openRouterEnabled(), false);
  assert.deepEqual(providerOrder(), ["gemini"]);
});

console.log("Provider selection checks passed: 7 cases.");
