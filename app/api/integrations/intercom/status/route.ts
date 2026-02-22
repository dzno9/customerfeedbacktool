import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { getIntercomStatus } from "@/lib/integrations/intercom-connection";

export async function GET() {
  try {
    const status = await getIntercomStatus({ db });
    return NextResponse.json(status, { status: 200 });
  } catch {
    return NextResponse.json(
      {
        error: "Unexpected error while loading Intercom status."
      },
      { status: 500 }
    );
  }
}
