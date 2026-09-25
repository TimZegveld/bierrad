import type { Participant } from "../types";
export function addParticipant(
  list: readonly Participant[],
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
export const removeParticipant = (list: readonly Participant[], id: string) =>
  list.filter((p) => p.id !== id);

/** Validate source/controller input while preserving stable external IDs. */
export function validateParticipants(
  people: readonly Participant[],
): Participant[] {
  const ids = new Set<string>();
  const names = new Set<string>();
  return people.map((person) => {
    const name = person.name.normalize("NFKC").trim().replace(/\s+/g, " ");
    const key = name.toLocaleLowerCase("nl");
    if (
      !person.id ||
      ids.has(person.id) ||
      !name ||
      name.length > 32 ||
      names.has(key)
    )
      throw new Error("Ongeldige of dubbele deelnemers.");
    ids.add(person.id);
    names.add(key);
    return { id: person.id, name };
  });
}
