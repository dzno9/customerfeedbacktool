import { NextResponse } from "next/server";

export function requireInternalApiKey(request: Request): NextResponse | null {
  const expected = process.env.INTERNAL_API_KEY?.trim();
  if (!expected) {
    return NextResponse.json(
      { error: "Server misconfiguration: INTERNAL_API_KEY is required." },
      { status: 500 }
    );
  }

  const provided = request.headers.get("x-api-key")?.trim();
  if (!provided || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

export function readRequiredActorId(request: Request): string | null {
  const actorId = request.headers.get("x-actor-id")?.trim();
  return actorId ? actorId : null;
}
