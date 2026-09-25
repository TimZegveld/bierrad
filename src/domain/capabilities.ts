import type {
  BeerWheelSession,
  ClientRole,
  SessionCapabilities,
} from "./models";
export function getCapabilities(
  role: ClientRole,
  session: BeerWheelSession,
  busy = false,
): SessionCapabilities {
  const control = role === "host" && !busy && session.mode === "manual";
  return {
    canViewSession: true,
    canControlSession: role === "host",
    canManageParticipants:
      control && ["setup", "ready"].includes(session.state),
    canStartSpin: control && ["ready", "first-winner"].includes(session.state),
    canReset:
      control &&
      !["countdown", "spinning-first", "spinning-second"].includes(
        session.state,
      ),
  };
}
