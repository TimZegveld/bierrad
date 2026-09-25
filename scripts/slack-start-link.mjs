import { randomBytes, createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
// Provisioning tool, never imported into the app. No token/link is printed.
const mode = process.argv[2];
const directory = new URL("../.private-slack/", import.meta.url);
const grantFile = new URL("grant.json", directory);
if (mode === "create") {
  const origin = new URL(
    process.argv[3] ?? "https://timzegveld.github.io/bierrad/",
  );
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    (origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(origin.hostname)
      ))
  )
    throw new Error("Gebruik een geldige frontend-URL.");
  const days = Number(process.argv[4] ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 30)
    throw new Error("Geldigheid: 1 tot 30 dagen.");
  const secret = randomBytes(32).toString("hex");
  const grant = {
    hash: createHash("sha256").update(secret).digest("hex"),
    expiresAt: Date.now() + days * 86400000,
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // Exclusive creation prevents accidental rotation or overwriting of existing private links.
  await writeFile(grantFile, JSON.stringify(grant), {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(
    new URL("start-link.txt", directory),
    `${origin.href}#/slack-start/${secret}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Startlink lokaal opgeslagen in .private-slack/start-link.txt (niet delen met kijkers). Publiceer daarna de grant.",
  );
} else if (mode === "publish") {
  const grant = JSON.parse(await readFile(grantFile, "utf8"));
  if (
    !/^[a-f0-9]{64}$/.test(grant.hash) ||
    !Number.isSafeInteger(grant.expiresAt) ||
    grant.expiresAt <= Date.now() ||
    grant.expiresAt > Date.now() + 30 * 86400000
  )
    throw new Error("Ongeldige of verlopen grant.");
  const wrangler = new URL(
    "../node_modules/wrangler/bin/wrangler.js",
    import.meta.url,
  );
  const { fileURLToPath } = await import("node:url");
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(wrangler), "secret", "put", "SLACK_START_GRANT", "--env="],
    {
      input: JSON.stringify(grant),
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    console.error(
      "Publiceren mislukt. Controleer Wrangler-login en Worker-toegang; uitvoer is afgeschermd.",
    );
    process.exitCode = 1;
  } else
    console.log(
      "Privé-starttoegang gepubliceerd. Een eerdere grant is ingetrokken voor nieuwe Slack-acties.",
    );
} else {
  console.log(
    "Gebruik: node scripts/slack-start-link.mjs create [frontend-url] [dagen=7] | publish",
  );
  process.exitCode = 1;
}
