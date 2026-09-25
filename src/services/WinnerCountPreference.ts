export interface WinnerCountPreference {
  load(): number;
  save(count: number): void;
}
const KEY = "bierrad.winnerCount.v1";
export class LocalWinnerCountPreference implements WinnerCountPreference {
  load(): number {
    const raw = localStorage.getItem(KEY);
    const value = raw === null ? 2 : Number(raw);
    return Number.isSafeInteger(value) && value >= 1 ? value : 2;
  }
  save(count: number): void {
    localStorage.setItem(KEY, String(count));
  }
}
