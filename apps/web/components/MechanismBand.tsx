import { Eyebrow, FlowNode, FlowArrow } from "./ui";
import { Reveal } from "./motion";


/**
 * The dark "mechanism" band (DIRECTIVE §11.6) repurposed verbatim to explain
 * Candence's reactive pipeline. Terminal nodes (the onchain trigger and the
 * resulting order) are accent-colored, exactly as the reference colors its
 * terminal flow nodes.
 */
export function MechanismBand() {
  return (
    <section id="mechanism" className="section">
      <div className="shell">
        <Reveal variant="scale">
          <div className="band-dark">
            <Eyebrow accent>THE MECHANISM</Eyebrow>
            <h2 className="h-lg" style={{ color: "var(--snow)", maxWidth: 720, margin: "16px 0 20px" }}>
              No cron. No polling. The chain itself pulls the trigger.
            </h2>
            <p className="lead" style={{ maxWidth: 620, marginBottom: 32 }}>
              A price update on the underlying spot pool emits an event. Somnia&apos;s Reactivity precompile
              (<span className="mono">0x0100</span>) delivers it straight into our subscriber, which routes it to every
              live vault in the same block — each isolated by <span className="mono">try/catch</span> so one failing
              vault never blocks the rest. The decision path never leaves the chain.
            </p>
            <div className="flow">
              {/* Sequential glow up of the reactive pipeline. */}
              <FlowNode accent style={{ animationDelay: "0s" }}>MarkPriceUpdated (0x0100)</FlowNode>
              <FlowArrow />
              <FlowNode style={{ animationDelay: "0.8s" }}>ReactivitySubscriber</FlowNode>
              <FlowArrow />
              <FlowNode style={{ animationDelay: "1.6s" }}>AgentVault.onEvent</FlowNode>
              <FlowArrow />
              <FlowNode accent style={{ animationDelay: "2.4s" }}>placeOrderFor</FlowNode>
            </div>
            <p className="meta" style={{ marginTop: 24 }}>
              Settlement uses the same reactivity: oracle answer → hub callback → market resolves → redemption opens.
              Our sweeper claims winnings actively — they are never auto-converted.
            </p>
          </div>
        </Reveal>
      </div>
    </section>

  );
}
