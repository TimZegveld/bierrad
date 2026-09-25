import type { Participant } from "../types";
export function FinalResult({
  winners,
  onReset,
  onNew,
  canReset,
}: {
  winners: readonly Participant[];
  canReset: boolean;
  onReset: () => void;
  onNew: () => void;
}) {
  return (
    <section className="final-result" aria-live="polite">
      <div className="result-emoji">🍻</div>
      <span className="eyebrow">DE BIERBRIGADE VAN DEZE WEEK</span>
      <h2>🍻 Het rad heeft gesproken! 🍻</h2>
      <p className="winner-names">
        {winners[0].name}
        <span>&</span>
        {winners[1].name}
      </p>
      <h3>Jullie mogen bier halen!</h3>
      <p>Het volk heeft dorst. Maak ons trots.</p>
      {canReset && (
        <>
          <button className="primary" onClick={onReset}>
            Opnieuw met dezelfde deelnemers
          </button>
          <button className="text-button" onClick={onNew}>
            Nieuw bierrad
          </button>
          <button className="slack-future" disabled>
            Plaats winnaars in Slack · Binnenkort
          </button>
        </>
      )}
    </section>
  );
}
