import { useEffect, useState } from "react";
import type { RatingStatus } from "../../shared/ratings";
import { useTheme } from "../Theme";
import { RatingDialog } from "./RatingDialog";
export function RatingPrompt({
  status,
  offset = 0,
  connected,
  drawing,
  onBegin,
}: {
  status: RatingStatus;
  offset?: number;
  connected: boolean;
  drawing: boolean;
  onBegin: (drawId: string) => void;
}) {
  const theme = useTheme();
  const [now, setNow] = useState(() => Date.now() + offset);
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [open, setOpen] = useState<string>();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(timer);
  }, [offset]);
  const available = status.rounds.filter((r) => Date.parse(r.opensAt) <= now);
  const next = status.rounds.find((r) => Date.parse(r.opensAt) > now);
  useEffect(() => {
    if (drawing || !connected || open) return;
    const round = available.find((r) => !dismissed.has(r.drawId));
    if (round) setOpen(round.drawId);
  }, [available, dismissed, drawing, connected, open]);
  const round = available.find((r) => r.drawId === open);
  const close = () => {
    if (open) setDismissed((ids) => new Set([...ids, open]));
    setOpen(undefined);
  };
  if (!status.rounds.length) return null;
  return (
    <section className="rating-prompt" aria-label="Beoordelingen">
      {available.length > 0 ? (
        <>
          <span>★ Hoe was het rondje {theme.drink}?</span>
          <div className="rating-round-actions">
            {available.map((r, i) => (
              <button key={r.drawId} onClick={() => setOpen(r.drawId)}>
                Beoordeel {r.winners.map((w) => w.name).join(" & ")}
                {available.length > 1 ? ` · ronde ${i + 1}` : ""}
              </button>
            ))}
          </div>
        </>
      ) : (
        next && (
          <p>
            ★ De haler krijgt even de tijd. Beoordelen kan over{" "}
            {Math.max(1, Math.ceil((Date.parse(next.opensAt) - now) / 60000))}{" "}
            min.
          </p>
        )
      )}
      {round && !drawing && (
        <RatingDialog title="Hoe was jouw rondje?" onClose={close}>
          <p>
            {theme.icon}{" "}
            <strong>{round.winners.map((w) => w.name).join(" & ")}</strong>{" "}
            {round.winners.length === 1 ? "haalde" : "haalden"} het{" "}
            {theme.drink}. Geef 1 tot 5 sterren.
          </p>
          <p className="helper">
            Bevestig met Slack dat je meedeed. Je kunt iedere trekking één keer
            beoordelen.
          </p>
          <button
            className="primary"
            disabled={!connected}
            onClick={() => onBegin(round.drawId)}
          >
            Bevestig met Slack & geef sterren
          </button>
          <button className="rating-later" onClick={close}>
            Ik doe het later
          </button>
        </RatingDialog>
      )}
    </section>
  );
}
