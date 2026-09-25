import type { Participant } from "../types";
export interface ParticipantSource {
  getParticipants(): Promise<Participant[]>;
}
// Future implementations call a backend; never call Slack with credentials from this app.
export interface SlackThread {
  messageUrl: string;
}
export interface WinnerPublisher {
  publishWinners(
    thread: SlackThread,
    winners: readonly [Participant, Participant],
  ): Promise<void>;
}
export interface SlackParticipantSource extends ParticipantSource {
  readonly thread: SlackThread;
}
