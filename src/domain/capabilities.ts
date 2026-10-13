import type {
  BeerWheelSession,
  ClientRole,
  SessionCapabilities,
} from "./models";
import { drawable } from "./drawEngine";
export function getCapabilities(
  role: ClientRole,
  session: BeerWheelSession,
  busy = false,
): SessionCapabilities {
  const control = role === "host" && !busy && session.mode === "manual";
  const setup = ["setup", "ready"].includes(session.state);
  return {
    canViewSession: true,
    canControlSession: role === "host",
    canManageParticipants: control && setup,
    canConfigureDraw: control && setup && session.participants.length > 0,
    canStartDraw:
      control &&
      ["ready", "finished"].includes(session.state) &&
      drawable(session),
    canReset: control && ["setup", "ready", "finished"].includes(session.state),
  };
}
