import { useTheme } from "../Theme";
import type { BeerWheelSession, Participant } from "../domain/models";
import { feestLines, joinNames } from "../domain/presentation";
export function SpectatorResult({
  winners,
  session,
}: {
  winners: readonly Participant[];
  session: BeerWheelSession;
}) {
  const theme = useTheme();
  // A Feestrad says who fetches what, one line per goal.
  const lines = feestLines(session, winners);
  if (lines)
    return (
      <section className="spectator-result feest-result">
        <span className="eyebrow">
          {theme.icon} Het {theme.name} heeft gesproken! {theme.icon}
        </span>
        <ul className="feest-lines">
          {lines.map((l) => (
            <li key={l.id}>
              {l.icon} {l.line}
            </li>
          ))}
        </ul>
        <p>{theme.ending}</p>
      </section>
    );
  // One wheel already shows its haler in the banner: one line is enough here.
  if (winners.length === 1)
    return (
      <section className="spectator-result">
        <p className="spectator-result-line">
          {theme.icon} Het rad heeft gesproken: <strong>{winners[0].name}</strong>{" "}
          {theme.resultOne}
        </p>
      </section>
    );
  return (
    <section className="spectator-result">
      <span className="eyebrow">
        {theme.icon} Het rad heeft gesproken!
      </span>
      <p className="spectator-result-names">
        {joinNames(winners.map((winner) => winner.name))}
      </p>
      <p>{theme.resultMany}</p>
    </section>
  );
}
