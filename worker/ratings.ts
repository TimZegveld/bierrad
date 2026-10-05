import { DurableObject } from "cloudflare:workers";
import type { RatingSummary } from "../shared/ratings";
import { RequestError } from "./session";

/** One serialized SQLite store per workspace AND variant. No public fetch API. */
export class Ratings extends DurableObject<Env> {
  private schema() {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS scores (person TEXT PRIMARY KEY, total INTEGER NOT NULL, count INTEGER NOT NULL, average REAL NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS ballots (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)",
    );
  }
  summaries(ids: string[]): Record<string, RatingSummary> {
    if (ids.length > 100 || ids.some((id) => !/^[UW][A-Z0-9]{8,20}$/.test(id)))
      throw new RequestError(400, "invalid");
    this.schema();
    const result: Record<string, RatingSummary> = {};
    for (const id of ids) {
      const row = this.ctx.storage.sql
        .exec<{
          average: number;
          count: number;
        }>("SELECT average, count FROM scores WHERE person = ?", id)
        .toArray()[0];
      result[id] = row
        ? { average: row.average, count: row.count }
        : { average: 0, count: 0 };
    }
    return result;
  }
  /** Validation of identity, official winners and timing lives in LiveSession. */
  hasBallot(id: string) {
    this.schema();
    return (
      this.ctx.storage.sql
        .exec(
          "SELECT id FROM ballots WHERE id = ? AND expires > ?",
          id,
          Date.now(),
        )
        .toArray().length > 0
    );
  }
  async vote(
    ballotId: string,
    votes: { person: string; stars: number }[],
    expiresAt: number,
    dedupUntil = expiresAt,
  ): Promise<boolean> {
    if (
      !/^[a-f0-9]{64}$/.test(ballotId) ||
      votes.length < 1 ||
      votes.length > 100 ||
      new Set(votes.map((v) => v.person)).size !== votes.length ||
      votes.some(
        (v) =>
          !/^[UW][A-Z0-9]{8,20}$/.test(v.person) ||
          !Number.isInteger(v.stars) ||
          v.stars < 1 ||
          v.stars > 5,
      ) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now() ||
      !Number.isFinite(dedupUntil) ||
      dedupUntil < expiresAt
    )
      throw new RequestError(400, "invalid");
    this.schema();
    // No await in the transaction: the uniqueness claim and ALL score increments commit together.
    const accepted = this.ctx.storage.transactionSync(() => {
      const exists = this.ctx.storage.sql
        .exec("SELECT id FROM ballots WHERE id = ?", ballotId)
        .toArray().length;
      if (exists) return false;
      this.ctx.storage.sql.exec(
        "INSERT INTO ballots VALUES (?, ?)",
        ballotId,
        dedupUntil,
      );
      for (const v of votes)
        this.ctx.storage.sql.exec(
          "INSERT INTO scores VALUES (?, ?, 1, ?) ON CONFLICT(person) DO UPDATE SET total = scores.total + excluded.total, count = scores.count + 1, average = CAST(scores.total + excluded.total AS REAL) / (scores.count + 1)",
          v.person,
          v.stars,
          v.stars,
        );
      return true;
    });
    await this.arm();
    return accepted;
  }
  /** Operations-only RPC for deletion; never exposed through browser endpoints. */
  forget(person: string) {
    this.schema();
    this.ctx.storage.sql.exec("DELETE FROM scores WHERE person = ?", person);
  }
  private async arm() {
    const next = this.ctx.storage.sql
      .exec<{ at: number | null }>("SELECT MIN(expires) AS at FROM ballots")
      .one().at;
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    this.schema();
    this.ctx.storage.sql.exec(
      "DELETE FROM ballots WHERE expires <= ?",
      Date.now(),
    );
    await this.arm();
  }
}
