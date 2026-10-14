export async function creationAllowed(env: Env, ip: string) {
  return (
    (await env.CREATION_LIMIT.limit({ key: ip })).success &&
    (await env.CREATION_GLOBAL.limit({ key: "creation" })).success
  );
}
