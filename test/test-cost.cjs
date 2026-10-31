/**
 * Dependency-free checks for the session-cost bundle.
 *
 * The client bundle is a browser script (`window.__ModuleLoader__.load`), so it
 * is evaluated in a VM with a stub loader and a stub React. That covers the
 * pricing math, peak/off-peak boundaries, formatting, and the slot registration
 * without installing anything.
 *
 * Run: node test/test-cost.js
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const bundlePath = path.join(__dirname, "..", "lib", "client.js");
const code = fs.readFileSync(bundlePath, "utf8");

let definition;
const fakeReact = {
  createElement: () => null,
  useReducer: (_reducer, initial) => [initial, () => {}],
  useEffect: () => {},
};

const sandbox = {
  window: { __ModuleLoader__: { load: (value) => (definition = value) } },
  Symbol,
  Number,
  String,
  Date,
  setInterval: () => 0,
  clearInterval: () => {},
  console,
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: bundlePath });

const mod = definition.factory((name) => {
  if (name === "react") return fakeReact;
  throw new Error(`unexpected require(${JSON.stringify(name)})`);
});

// The browser module id must match the package name exactly.
assert.equal(definition.id, "dsh-client-ui-session-cost");
assert.deepEqual([...mod.inject], ["slots"]);
assert.equal(typeof mod.SessionCostPill, "function");
assert.equal(typeof mod.apply, "function");

// Official DeepSeek rates, USD per 1M tokens.
const sample = {
  uncachedInputTokens: 130013,
  outputTokens: 39248,
  cacheReadTokens: 11581184,
  cacheWriteTokens: 0,
};

const flashOffPeak = mod.resolveRates("deepseek-flash", new Date("2026-10-31T13:09:00Z"));
assert.equal(flashOffPeak.peak, false);
assert.equal(flashOffPeak.known, true);
const flashCost = mod.computeCost(sample, flashOffPeak.rates);
assert.equal(flashCost.cacheMiss, 130013 * 0.15 / 1e6);
assert.equal(flashCost.cacheRead, 11581184 * 0.003 / 1e6);
assert.equal(flashCost.output, 39248 * 0.6 / 1e6);
assert.ok(Math.abs(flashCost.total - 0.077794302) < 1e-9);
assert.equal(mod.formatCost(flashCost.total), "$0.078");

const flashPeak = mod.resolveRates("deepseek-flash", new Date("2026-10-27T02:00:00Z"));
assert.equal(flashPeak.peak, true);
assert.ok(Math.abs(mod.computeCost(sample, flashPeak.rates).total - 0.155588604) < 1e-9);

const proOffPeak = mod.resolveRates("deepseek-v4-pro", new Date("2026-10-31T13:09:00Z"));
assert.equal(proOffPeak.known, true);
assert.equal(mod.formatCost(mod.computeCost(sample, proOffPeak.rates).total), "$0.42");

// Unknown models fall back to Flash rates and are marked unknown.
const unknown = mod.resolveRates("some-future-model", new Date("2026-10-31T13:09:00Z"));
assert.equal(unknown.known, false);
assert.equal(unknown.model, "deepseek-flash");

// Peak windows are 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday.
const peakChecks = [
  ["2026-10-27T02:00:00Z", true], // Tuesday, inside
  ["2026-10-27T04:00:00Z", false], // Tuesday, exclusive end
  ["2026-10-27T05:00:00Z", false], // Tuesday, between windows
  ["2026-10-27T07:00:00Z", true], // Tuesday, second window
  ["2026-10-27T09:59:00Z", true], // Tuesday, still inside
  ["2026-10-27T10:00:00Z", false], // Tuesday, exclusive end
  ["2026-10-31T02:00:00Z", false], // Saturday
  ["2026-10-31T07:00:00Z", false], // Saturday
];
for (const [iso, expected] of peakChecks) {
  assert.equal(mod.isPeakUtc(new Date(iso)), expected, iso);
}

// Display rounding: sub-cent totals keep four decimals, then three, then two.
assert.equal(mod.formatCost(0), "$0");
assert.equal(mod.formatCost(0.0042), "$0.0042");
assert.equal(mod.formatCost(0.078), "$0.078");
assert.equal(mod.formatCost(0.15), "$0.15");
assert.equal(mod.formatCost(1.5), "$1.50");

// The dock entry keeps the existing order and is a new control.
const calls = [];
const ctx = {
  slots: {
    inject: (name, register) => {
      calls.push({ name });
      register();
    },
    register: (spec, component) => {
      calls.push({ spec, component });
      return () => {};
    },
  },
};
mod.apply(ctx);
assert.equal(calls[0].name, "conversation.composer.dock");
assert.equal(calls[1].spec.name, "conversation.composer.dock");
assert.equal(calls[1].spec.id, "cost");
assert.equal(calls[1].spec.order, 2);
assert.equal(calls[1].component, mod.SessionCostPill);

console.log("session-cost: all checks passed");
