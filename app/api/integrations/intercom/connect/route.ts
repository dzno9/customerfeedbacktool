import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { connectIntercom } from "@/lib/integrations/intercom-connection";

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  try {
    const result = await connectIntercom(payload, { db });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          status: result.status
        },
        { status: 400 }
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Unexpected error while connecting Intercom." }, { status: 500 });
  }
}
