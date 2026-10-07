import { useState } from "react";
import {
  REVIEW_TEXT_MAX,
  reviewLabels,
  type ReviewBallot,
  type ReviewSubmission,
} from "../../shared/reviews";
import type { WheelVariant } from "../../shared/variant";

const clock = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
});

/** What is filled in so far, kept only in memory and only for one draw. */
export type ReviewDraft = {
  drawId: string;
  scores: (number | undefined)[];
  texts: string[];
};
/** The kept draft for this ballot, or an empty one for a new draw. */
export function draftFor(ballot: ReviewBallot, draft?: ReviewDraft): ReviewDraft {
  if (
    draft?.drawId === ballot.drawId &&
    draft.scores.length === ballot.winners.length &&
    draft.texts.length === ballot.winners.length
  )
    return draft;
  return {
    drawId: ballot.drawId,
    scores: ballot.winners.map(() => undefined),
    texts: ballot.winners.map(() => ""),
  };
}

/**
 * Stars per winner, an optional anonymous text, one submission. The page keeps
 * the draft, so it survives the page switching layout or "Later".
 */
export function ReviewBallotCard({
  ballot,
  variant,
  channelName,
  draft,
  onDraftChange,
  onSubmit,
  onLater,
}: {
  ballot: ReviewBallot;
  variant: WheelVariant;
  channelName?: string;
  draft?: ReviewDraft;
  onDraftChange: (draft: ReviewDraft) => void;
  onSubmit: (submission: ReviewSubmission) => Promise<void>;
  onLater: () => void;
}) {
  const { scores, texts } = draftFor(ballot, draft);
  const setScores = (update: (all: (number | undefined)[]) => (number | undefined)[]) =>
    onDraftChange({ drawId: ballot.drawId, scores: update(scores), texts });
  const setTexts = (update: (all: string[]) => string[]) =>
    onDraftChange({ drawId: ballot.drawId, scores, texts: update(texts) });
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const labels = reviewLabels[variant];
  const where = channelName ? `#${channelName}` : "het kanaal";
  async function submit() {
    const missing = ballot.winners.filter((_, i) => !scores[i]).map((w) => w.name);
    if (missing.length) {
      setError(`Geef ${missing.join(" en ")} eerst sterren.`);
      return;
    }
    setPending(true);
    setError("");
    try {
      await onSubmit({ scores: scores as number[], texts });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="review-card" aria-labelledby="review-title">
      <header>
        <h2 id="review-title">Hoe was het rondje?</h2>
        <p className="helper">
          Stemmen kan tot {clock.format(Date.parse(ballot.closesAt))}.
        </p>
      </header>
      {ballot.winners.map((winner, i) => (
        <fieldset key={winner.index} className="review-winner">
          <legend>
            <span>{winner.name}</span>
            <small aria-live="polite">
              {scores[i] ? labels[scores[i]! - 1] : "Kies sterren"}
            </small>
          </legend>
          <div className="review-stars" role="radiogroup" aria-label={`Sterren voor ${winner.name}`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={scores[i] === n}
                aria-label={`${n} ${n === 1 ? "ster" : "sterren"}: ${labels[n - 1]}`}
                className={scores[i] && n <= scores[i]! ? "on" : undefined}
                onClick={() => {
                  setScores((all) => all.map((s, j) => (j === i ? n : s)));
                  setError("");
                }}
              >
                ★
              </button>
            ))}
          </div>
          <label className="review-text">
            <span className="sr-only">Review voor {winner.name} (optioneel)</span>
            <textarea
              maxLength={REVIEW_TEXT_MAX}
              rows={2}
              value={texts[i]}
              placeholder="Wat vond je ervan? (optioneel)"
              onChange={(e) =>
                setTexts((all) => all.map((t, j) => (j === i ? e.target.value : t)))
              }
            />
            <small>
              {texts[i].length} / {REVIEW_TEXT_MAX}
            </small>
          </label>
        </fieldset>
      ))}
      <p className="review-note">
        Je review komt anoniem in de thread van {where}. Je kunt maar één keer
        stemmen.
      </p>
      {error && (
        <p className="review-error" role="alert">
          {error}
        </p>
      )}
      <div className="review-actions">
        <button type="button" onClick={onLater} disabled={pending}>
          Later
        </button>
        <button type="button" className="primary" onClick={() => void submit()} disabled={pending}>
          Verstuur beoordeling
        </button>
      </div>
    </section>
  );
}

/** Thanks after voting; the votes themselves are never shown back. */
export function ReviewThanks({ closesAt }: { closesAt: string }) {
  return (
    <p className="review-thanks" role="status">
      ✓ Bedankt voor je stem! De reviews komen in Slack zodra iedereen gestemd
      heeft, uiterlijk om {clock.format(Date.parse(closesAt))}.
    </p>
  );
}

/**
 * Log in with Slack (to review after the round) or just watch. The channel
 * link goes to the backend only in a POST body, never in a URL.
 */
export function ReviewJoin({
  apiUrl,
  capability,
  viewLink,
  path = "/auth/slack/member",
  explanation = "Log in om na afloop de haler te beoordelen.",
}: {
  apiUrl: string;
  /** `/auth/slack/member` for a channel, `/auth/slack/join` for a session. */
  path?: string;
  explanation?: string;
  capability: string;
  viewLink?: string;
}) {
  // No rel="noreferrer": that would make the browser send "Origin: null",
  // which the backend refuses. The page policy (strict-origin) sends the
  // origin only; the capability travels in the body, never in a Referer.
  return (
    <form
      className="review-join"
      method="post"
      action={`${apiUrl}${path}`}
    >
      <input type="hidden" name="capability" value={capability} />
      <button type="submit" className="primary">
        Inloggen met Slack
      </button>
      {viewLink && <a href={viewLink}>Alleen kijken</a>}
      <small>{explanation}</small>
    </form>
  );
}
