export interface Participant {
  id: string;
  name: string;
}
export type DrawState =
  | "setup"
  | "ready"
  | "spinning-first"
  | "first-winner"
  | "spinning-second"
  | "finished";
