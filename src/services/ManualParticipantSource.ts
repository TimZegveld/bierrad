import type { ParticipantSource } from "./ParticipantSource";
import type { Participant } from "../types";
import { addParticipant } from "../utils/participants";
const KEY = "bierrad.participants.v1";
export class ManualParticipantSource implements ParticipantSource {
  async getParticipants(): Promise<Participant[]> {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed))
      throw new Error("Ongeldige opgeslagen deelnemers.");
    return parsed.reduce<Participant[]>((list, entry: unknown) => {
      if (
        typeof entry !== "object" ||
        !entry ||
        !("name" in entry) ||
        typeof entry.name !== "string"
      )
        throw new Error("Ongeldige opgeslagen deelnemers.");
      return addParticipant(list, entry.name);
    }, []);
  }
  save(participants: Participant[]) {
    localStorage.setItem(KEY, JSON.stringify(participants));
  }
}
