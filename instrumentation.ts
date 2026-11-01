/** 서버 시작 시 1회 실행 — Node 런타임에서만 시작 점검·워커를 불러온다 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { onServerStart } = await import("./instrumentation-node");
    await onServerStart();
  }
}
