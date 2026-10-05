import { useEffect, useState } from "react";
import { VariantContext } from "../Theme";
import { themes, type WheelVariant } from "../../shared/variant";
import type { RatingBallot } from "../../shared/ratings";
import { configuredApiUrl } from "../sessions/liveNavigation";
import { RatingDialog } from "./RatingDialog";
export function RatingPage({
  capability,
  failure,
  variant = "beer",
}: {
  capability?: string;
  failure?: string;
  variant?: WheelVariant;
}) {
  const [ballot, setBallot] = useState<RatingBallot>();
  const [scores, setScores] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(true);
  const [expired, setExpired] = useState(false);
  const api = configuredApiUrl();
  async function request(submit = false) {
    if (!api || !capability)
      throw new Error("Beoordelen is hier niet beschikbaar.");
    const response = await fetch(`${api}/api/rating`, {
      method: submit ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${capability}`,
        ...(submit ? { "Content-Type": "application/json" } : {}),
      },
      ...(submit
        ? {
            body: JSON.stringify({
              scores: ballot!.round.winners.map((w) => ({
                winnerId: w.id,
                stars: scores[w.id],
              })),
            }),
          }
        : {}),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? "Even rustig aan. Probeer over een minuut opnieuw."
          : "Deze beoordeling is niet beschikbaar. Open de ronde opnieuw en bevestig met Slack dat je meedeed.",
      );
    return response.json() as Promise<RatingBallot>;
  }
  useEffect(() => {
    let active = true;
    if (!failure)
      void request().then(
        (b) => {
          if (active) setBallot(b);
        },
        (e) => {
          if (active) setNotice(e.message);
        },
      );
    return () => {
      active = false;
    };
  }, [capability, api, failure]);
  useEffect(() => {
    if (!ballot) return;
    const offset = ballot.serverNow - Date.now();
    const timer = setInterval(() => {
      if (Date.now() + offset >= Date.parse(ballot.expiresAt)) {
        setExpired(true);
        setBallot(undefined);
        setScores({});
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [ballot]);
  const kind = ballot?.variant ?? variant;
  const theme = themes[kind];
  useEffect(() => {
    document.documentElement.dataset.variant = kind;
    document.title = `${theme.name} — Geef je sterren`;
  }, [kind, theme.name]);
  const fail = failure
    ? failure === "forbidden"
      ? "Je kunt alleen beoordelen als je als volwaardig Slack-lid aan deze trekking meedeed."
      : "Inloggen is niet gelukt. Open de ronde opnieuw om het nog eens te proberen."
    : expired
      ? "Deze ronde is afgelopen. Bedankt voor het meedoen!"
      : notice;
  return (
    <VariantContext.Provider value={kind}>
      <main className="rating-page">
        <a className="brand" href={`#/${kind}`}>
          {theme.icon} <strong>{theme.name.toLowerCase()}</strong>
        </a>
        <span className="eyebrow">EEN RONDJE WAARDERING</span>
        <h1>Maak de haler blij.</h1>
        <p>Een klein gebaar voor jouw rondje {theme.drink}.</p>
        {fail ? (
          <p role="alert" className="notice">
            {fail}
          </p>
        ) : !ballot ? (
          <p role="status">Je beoordeling wordt klaargezet…</p>
        ) : ballot.submitted ? (
          <div className="rating-thanks" role="status">
            <span aria-hidden="true">★</span>
            <h2>Je sterren zijn binnen!</h2>
            <p>
              Bedankt voor je beoordeling. Deze trekking heb je al beoordeeld.
            </p>
          </div>
        ) : (
          <>
            <p>
              {ballot.round.winners.map((w) => w.name).join(" & ")}{" "}
              {ballot.round.winners.length === 1 ? "haalde" : "haalden"} het{" "}
              {theme.drink}.
            </p>
            <button className="primary" onClick={() => setOpen(true)}>
              Geef je sterren ★
            </button>
          </>
        )}
        {ballot && !ballot.submitted && open && !expired && (
          <RatingDialog
            title="Hoe was het rondje?"
            onClose={() => setOpen(false)}
          >
            <p>
              Geef {ballot.round.winners.length === 1 ? "de" : "iedere"}{" "}
              {theme.drink}haler 1 tot 5 sterren. Kleine moeite, groot plezier.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setPending(true);
                setNotice("");
                try {
                  setBallot(await request(true));
                } catch (error) {
                  setNotice((error as Error).message);
                } finally {
                  setPending(false);
                }
              }}
            >
              {ballot.round.winners.map((w) => (
                <fieldset className="star-picker" key={w.id} disabled={pending}>
                  <legend>
                    {theme.winnerIcon} {w.name}
                  </legend>
                  <div
                    role="radiogroup"
                    aria-label={`Beoordeling voor ${w.name}`}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <label
                        key={n}
                        className={n <= (scores[w.id] ?? 0) ? "selected" : ""}
                      >
                        <input
                          type="radio"
                          name={`stars-${w.id}`}
                          value={n}
                          checked={scores[w.id] === n}
                          onChange={() =>
                            setScores((s) => ({ ...s, [w.id]: n }))
                          }
                          aria-label={`${n} ${n === 1 ? "ster" : "sterren"}`}
                        />
                        <span aria-hidden="true">★</span>
                      </label>
                    ))}
                  </div>
                  <small>
                    {scores[w.id]
                      ? [
                          "",
                          "Kan beter",
                          "Bijna daar",
                          "Prima rondje",
                          "Goed geregeld",
                          "Een echte held!",
                        ][scores[w.id]]
                      : "Kies jouw aantal sterren"}
                  </small>
                </fieldset>
              ))}
              {notice && (
                <p role="alert" className="error">
                  {notice}
                </p>
              )}
              <button
                className="primary"
                disabled={
                  pending || ballot.round.winners.some((w) => !scores[w.id])
                }
              >
                {pending
                  ? "Je sterren worden opgeslagen…"
                  : "Verstuur mijn sterren ★"}
              </button>
              <p className="helper">
                Eén beoordeling per trekking. Je sterren tellen alleen mee bij{" "}
                {theme.name}.
              </p>
            </form>
          </RatingDialog>
        )}
      </main>
    </VariantContext.Provider>
  );
}
