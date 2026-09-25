import type { Participant } from "../types";
export function addParticipant(
  list: Participant[],
  input: string,
): Participant[] {
  const name = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Vul eerst een naam in.");
  if (name.length > 32) throw new Error("Gebruik maximaal 32 tekens.");
  if (
    list.some(
      (p) => p.name.toLocaleLowerCase("nl") === name.toLocaleLowerCase("nl"),
    )
  )
    throw new Error("Deze naam staat al op het rad.");
  return [...list, { id: crypto.randomUUID(), name }];
}
export const removeParticipant = (list: Participant[], id: string) =>
  list.filter((p) => p.id !== id);
