export async function GET(): Promise<Response> {
  return Response.json({
    ok:        true,
    service:   'nortion-ai',
    timestamp: new Date().toISOString(),
  });
}
