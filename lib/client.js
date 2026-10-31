/**
 * Browser half: a session-cost estimate in the composer statistics dock.
 *
 * DSH already folds provider-reported token usage into the `tokenUsage` Session
 * projection (wire view = { uncachedInputTokens, outputTokens, cacheReadTokens,
 * cacheWriteTokens }). This bundle prices that durable total with DeepSeek's
 * published per-million-token rates and renders one more `conversation.composer.dock`
 * entry, so the cost sits right below the composer next to the existing token
 * and speed pills.
 *
 * Rates are USD per 1M tokens. Peak hours are 01:00-04:00 and 06:00-10:00 UTC,
 * Monday-Friday; every other hour (and weekends) is off-peak at half price.
 * Chinese public holidays are not modelled — the label stays an estimate.
 *
 * To change prices, edit PRICES below. To change the currency symbol, edit
 * CURRENCY. The bundle has no build step and no imports beyond React.
 */
window.__ModuleLoader__.load({
  id: "dsh-client-ui-session-cost",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");

    /** Official DeepSeek list prices, USD per 1M tokens. */
    const PRICES = {
      "deepseek-flash": {
        name: "DeepSeek-V4.1-Flash",
        peak: { cacheRead: 0.006, cacheMiss: 0.3, output: 1.2 },
        offPeak: { cacheRead: 0.003, cacheMiss: 0.15, output: 0.6 },
      },
      "deepseek-v4-pro": {
        name: "DeepSeek-V4-Pro",
        peak: { cacheRead: 0.044, cacheMiss: 1.32, output: 3.96 },
        offPeak: { cacheRead: 0.022, cacheMiss: 0.66, output: 1.98 },
      },
    };
    const DEFAULT_MODEL = "deepseek-flash";
    const CURRENCY = "$";

    const PILL_STYLE = {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "1px 8px",
      borderRadius: "var(--dsw-radius-sm)",
      color: "var(--dsw-alias-label-tertiary)",
      fontSize: "calc(var(--dsh-content-font-size-secondary, 13px) - 1px)",
      lineHeight: "calc(20px + var(--dsh-content-font-delta-secondary, 0px))",
      fontVariantNumeric: "tabular-nums",
      whiteSpace: "nowrap",
      cursor: "default",
    };

    /**
     * Whether a UTC instant is inside DeepSeek's peak window.
     * @param {Date} date
     * @returns {boolean}
     */
    function isPeakUtc(date) {
      const day = date.getUTCDay();
      if (day === 0 || day === 6) return false;
      const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
      return (minutes >= 60 && minutes < 240) || (minutes >= 360 && minutes < 600);
    }

    /**
     * Resolve the rate table for a model at one instant.
     * @param {string} model
     * @param {Date} now
     * @returns {{ model: string, name: string, known: boolean, peak: boolean, rates: {cacheRead:number, cacheMiss:number, output:number} }}
     */
    function resolveRates(model, now) {
      const key = typeof model === "string" && PRICES[model] !== undefined ? model : DEFAULT_MODEL;
      const entry = PRICES[key];
      const peak = isPeakUtc(now);
      return {
        model: key,
        name: entry.name,
        known: key === model,
        peak,
        rates: peak ? entry.peak : entry.offPeak,
      };
    }

    /**
     * Price one `tokenUsage` wire view.
     * @param {{uncachedInputTokens?:number, outputTokens?:number, cacheReadTokens?:number, cacheWriteTokens?:number}} usage
     * @param {{cacheRead:number, cacheMiss:number, output:number}} rates
     * @returns {{cacheMiss:number, cacheRead:number, output:number, total:number, billedInput:number}}
     */
    function computeCost(usage, rates) {
      const missTokens = (usage.uncachedInputTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
      const readTokens = usage.cacheReadTokens ?? 0;
      const outputTokens = usage.outputTokens ?? 0;
      const cacheMiss = (missTokens * rates.cacheMiss) / 1e6;
      const cacheRead = (readTokens * rates.cacheRead) / 1e6;
      const output = (outputTokens * rates.output) / 1e6;
      return {
        cacheMiss,
        cacheRead,
        output,
        total: cacheMiss + cacheRead + output,
        billedInput: missTokens + readTokens,
      };
    }

    /**
     * Currency text with enough precision to stay useful at sub-cent totals.
     * @param {number} value
     * @returns {string}
     */
    function formatCost(value) {
      if (!Number.isFinite(value) || value <= 0) return `${CURRENCY}0`;
      if (value < 0.01) return `${CURRENCY}${value.toFixed(4)}`;
      if (value < 0.1) return `${CURRENCY}${value.toFixed(3)}`;
      return `${CURRENCY}${value.toFixed(2)}`;
    }

    /**
     * Per-million-token rate text: $0.003/M, $0.30/M, $1.20/M.
     * @param {number} rate
     * @returns {string}
     */
    function formatRate(rate) {
      const text = rate >= 0.1 ? rate.toFixed(2) : rate.toFixed(3);
      return `${CURRENCY}${text}/M`;
    }

    /** Group digits for the tooltip without depending on the active locale. */
    function formatTokens(value) {
      return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    /**
     * The dock entry. `useProjection` is the Session-scoped projection hook the
     * slot framework injects; `useProjection("tokenUsage")` is the wire view.
     */
    function SessionCostPill({ useProjection }) {
      const usage = useProjection("tokenUsage");
      const selection = useProjection("modelSelection");
      // Peak/off-peak can change while a Session sits idle; refresh once a minute.
      const [, tick] = React.useReducer((value) => (value + 1) % 1000000, 0);
      React.useEffect(() => {
        const timer = setInterval(tick, 60_000);
        return () => clearInterval(timer);
      }, []);

      if (usage === undefined) return null;
      const totalTokens =
        (usage.uncachedInputTokens ?? 0) +
        (usage.outputTokens ?? 0) +
        (usage.cacheReadTokens ?? 0) +
        (usage.cacheWriteTokens ?? 0);
      if (totalTokens === 0) return null;

      const current = (selection && (selection.next || selection.lastUsed)) || undefined;
      const model = current && current.model;
      const now = new Date();
      const pricing = resolveRates(model, now);
      const cost = computeCost(usage, pricing.rates);

      const lines = [
        "Estimated session cost (model tokens only)",
        `Model: ${pricing.name} (${pricing.model})${pricing.known ? "" : " — assumed rates"}`,
        `Input · cache hit: ${formatTokens(usage.cacheReadTokens ?? 0)} × ${formatRate(pricing.rates.cacheRead)} = ${formatCost(cost.cacheRead)}`,
        `Input · cache miss: ${formatTokens((usage.uncachedInputTokens ?? 0) + (usage.cacheWriteTokens ?? 0))} × ${formatRate(pricing.rates.cacheMiss)} = ${formatCost(cost.cacheMiss)}`,
        `Output: ${formatTokens(usage.outputTokens ?? 0)} × ${formatRate(pricing.rates.output)} = ${formatCost(cost.output)}`,
        `Total: ${formatCost(cost.total)}`,
        pricing.peak ? "Peak rates (01:00–04:00, 06:00–10:00 UTC, Mon–Fri)" : "Off-peak rates",
        "List prices; Chinese public holidays are not modelled.",
      ];

      return React.createElement(
        "span",
        {
          "data-composer-stat": "cost",
          "data-session-cost": cost.total.toFixed(8),
          "data-cost-model": pricing.model,
          "data-cost-period": pricing.peak ? "peak" : "off-peak",
          style: PILL_STYLE,
          title: lines.join("\n"),
          "aria-label": `Estimated session cost ${formatCost(cost.total)} at ${pricing.peak ? "peak" : "off-peak"} rates`,
        },
        React.createElement("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, `Cost ≈ ${formatCost(cost.total)}`),
      );
    }

    const inject = ["slots"];

    /**
     * Client plugin body: add the pill after the existing usage entry.
     * @param {object} ctx client root context.
     */
    function apply(ctx) {
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "cost",
            order: 2,
          },
          SessionCostPill,
        ),
      );
    }

    exports.SessionCostPill = SessionCostPill;
    exports.apply = apply;
    exports.inject = inject;
    exports.computeCost = computeCost;
    exports.isPeakUtc = isPeakUtc;
    exports.resolveRates = resolveRates;
    exports.formatCost = formatCost;
    return module.exports;
  },
});
