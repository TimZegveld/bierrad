import { ChannelApiError } from "./ChannelClient";

/** Serial polling: a slow response cannot overwrite a newer poll. */
export class ChannelPoller<T> {
  private active = true;
  private busy = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private load: () => Promise<T>,
    private receive: (value: T) => void,
    private fail: (error: Error, terminal: boolean) => void,
    private delay = 10000,
  ) {}
  refresh = async (): Promise<void> => {
    if (!this.active || this.busy) return;
    clearTimeout(this.timer);
    this.busy = true;
    try {
      const value = await this.load();
      if (this.active) this.receive(value);
    } catch (error) {
      if (this.active) {
        const terminal = error instanceof ChannelApiError && error.terminal;
        this.fail(
          error instanceof Error ? error : new Error("Verbinding herstellen…"),
          terminal,
        );
        if (terminal) this.active = false;
      }
    } finally {
      this.busy = false;
      if (this.active)
        this.timer = setTimeout(() => void this.refresh(), this.delay);
    }
  };
  stop() {
    this.active = false;
    clearTimeout(this.timer);
  }
}
