import {
  useEffect,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTheme } from "../Theme";
import type { SessionController } from "../sessions/SessionController";
import { advanceDraw, sessionWinners } from "../domain/drawEngine";
import { countLabel, resultShownAt } from "../domain/presentation";
import { SpectatorView } from "./SpectatorView";

/** A replay counts down "3, 2, 1" before the wheels turn again. */
const REPLAY_LEAD_MS = 3500;
const noSubscription = () => () => {};

/**
 * Whether a round that no longer blocks the next is over for the screen: a
 * minute after its finale, or at once when it ended without a draw. Display
 * only; it reads the round's own snapshot and never changes it.
 */
export function useRoundOver(
  controller: SessionController | undefined,
  active: boolean,
): boolean {
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noSubscription,
    () => controller?.getSnapshot(),
  );
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const offset = snapshot?.clockOffsetMs ?? 0;
  const switchAt = snapshot
    ? resultShownAt(snapshot.session, snapshot.live?.scheduledDraw)
    : undefined;
  const over =
    !active && switchAt !== undefined && Date.now() + offset >= switchAt;
  useEffect(() => {
    if (active || over || switchAt === undefined) return;
    const timer = window.setTimeout(
      tick,
      Math.max(0, switchAt - (Date.now() + offset)) + 25,
    );
    return () => window.clearTimeout(timer);
  }, [active, over, switchAt, offset]);
  return over;
}

/** After the finale: who fetches, at a glance, instead of a wheel that stopped long ago. */
export function RoundResult({
  controller,
  badge,
  roundName,
  today,
  when,
  replayOpen,
  onReplay,
  children,
}: {
  controller: SessionController;
  badge: string;
  /** "bierronde", or a Koekrad round's own word. */
  roundName: string;
  today: boolean;
  /** "om 15:45", or the day when the round was not today. */
  when: string;
  replayOpen: boolean;
  onReplay: (open: boolean) => void;
  /** Review progress, the next request, links and the member bar. */
  children: ReactNode;
}) {
  const theme = useTheme();
  const { session } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const winners = sessionWinners(session);
  const drawn = winners.length > 0;
  if (replayOpen && drawn)
    return (
      <div className="channel-live">
        <div className="channel-strip" aria-live="polite">
          <strong>{badge}</strong>
          <span>🔁 Herhaling van de trekking {when}</span>
          <button className="link-button" onClick={() => onReplay(false)}>
            Terug naar de uitslag
          </button>
        </div>
        <RoundReplay controller={controller} />
      </div>
    );
  return (
    <div className="unavailable channel-page round-result" aria-live="polite">
      <span className="friday-badge">{badge}</span>
      <h1>
        {drawn
          ? `De ${roundName}${today ? " van vandaag" : ""} is gedraaid ${theme.icon}`
          : `De ${roundName} ging niet door`}
      </h1>
      {drawn ? (
        <section className="round-result-winners">
          <span className="eyebrow">{theme.finale}</span>
          <ul className="winner-names" aria-label={`De ${theme.haler}s`}>
            {winners.map((winner) => (
              <li key={winner.id}>
                {theme.winnerIcon} {winner.name}
              </li>
            ))}
          </ul>
          <p>
            {winners.length === 1 ? theme.resultOne : theme.resultMany}{" "}
            {theme.ending}
          </p>
          <p className="helper">
            Gedraaid {when} ·{" "}
            {countLabel(session.participants.length, "deelnemer", "deelnemers")}
          </p>
          <button className="link-button" onClick={() => onReplay(true)}>
            🎡 Bekijk het rad nog eens
          </button>
        </section>
      ) : (
        <p>
          Er is {when} niet gedraaid: er deed niemand mee, of de aanmeldingen
          konden niet worden gelezen.
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * The finished draw played again from its own frozen instruction: the same
 * wheels, the same landing spots, only shifted to now. Nothing is sent.
 */
function RoundReplay({ controller }: { controller: SessionController }) {
  const { session, live } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const draw = session.activeDraw!;
  // Local time plus this offset is the draw's own clock, started anew.
  const [offset] = useState(
    () => Date.parse(draw.startAt) - Date.now() - REPLAY_LEAD_MS,
  );
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const now = Date.now() + offset;
  const replay = advanceDraw(
    { ...session, state: "spinning", winnerIds: [] },
    draw.id,
    now,
  );
  // Re-render as each wheel stops, so its haler is revealed in turn.
  const next = Math.min(
    ...draw.spins
      .map((spin) => Date.parse(draw.startAt) + spin.durationMs)
      .filter((at) => at > now),
  );
  useEffect(() => {
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(tick, next - (Date.now() + offset) + 25);
    return () => window.clearTimeout(timer);
  }, [next, offset]);
  return (
    <SpectatorView
      session={replay}
      live={{ role: "spectator", status: live?.status ?? "connected" }}
      clockOffsetMs={offset}
      notice=""
    />
  );
}

