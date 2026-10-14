import { equalHash, hashSecret } from "../auth";
import { LoginError, type PendingLogin } from "./login";

/** One isolated object per login, in the existing CHANNELS namespace. */
export class LoginAttemptStore {
  constructor(private storage: DurableObjectStorage) {}

  async create(pending: PendingLogin, secret: string): Promise<void> {
    const secretHash = await hashSecret(secret);
    if (await this.storage.get("login")) throw new LoginError("expired");
    await this.storage.put("login", { pending, secretHash });
    await this.storage.setAlarm(pending.expiresAt);
  }

  async consume(secret: string, state: string): Promise<PendingLogin | null> {
    const hash = await hashSecret(secret);
    // A transaction makes concurrent callbacks consume the attempt only once.
    return this.storage.transaction(async (txn) => {
      const record = await txn.get<{
        pending: PendingLogin;
        secretHash: string;
      }>("login");
      if (!record) return null;
      if (Date.now() >= record.pending.expiresAt) {
        await txn.delete("login");
        return null;
      }
      if (
        !equalHash(hash, record.secretHash) ||
        !equalHash(state, record.pending.state)
      )
        return null;
      await txn.delete("login");
      return record.pending;
    });
  }

  async expire(): Promise<void> {
    await this.storage.delete("login");
  }
}
