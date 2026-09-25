import type { Participant } from "../domain/models";
export function FinalResult({
  winners,
  onAgain,
  onSetup,
  canControl,
  disabled,
}: {
  winners: readonly Participant[];
  onAgain: () => void;
  onSetup: () => void;
  canControl: boolean;
  disabled: boolean;
}) {
  return (
    <section className="final-result" aria-live="polite">
      <span className="eyebrow">DE BIERBRIGADE VAN DEZE WEEK</span>
      <h2>🍻 Het rad heeft gesproken! 🍻</h2>
      <ul className="winner-names" aria-label="De bierhalers">
        {winners.map((winner) => (
          <li key={winner.id}>{winner.name}</li>
        ))}
      </ul>
      <h3>
        {winners.length === 1
          ? "Jij mag bier halen!"
          : "Jullie mogen bier halen!"}
      </h3>
      <p>Het volk heeft dorst. Maak ons trots.</p>
      {canControl && (
        <>
          <button className="primary" disabled={disabled} onClick={onAgain}>
            🍻 Opnieuw draaien
          </button>
          <button className="text-button" disabled={disabled} onClick={onSetup}>
            Deelnemers aanpassen
          </button>
          <button className="slack-future" disabled>
            Plaats winnaars in Slack · Binnenkort
          </button>
        </>
      )}
    </section>
  );
}
