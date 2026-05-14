import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const rpcUrl = process.env.BACKEND_RPC_API_URL;
  if (!rpcUrl) {
    return NextResponse.json(
      { status: "error", message: "Missing BACKEND_RPC_API_URL in Vercel environment variables." },
      { status: 500 },
    );
  }

  let body: { action?: string; payload?: Record<string, unknown> } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ status: "error", message: "Invalid JSON request body." }, { status: 400 });
  }

  const formData = new FormData();
  formData.append("action", body.action || "");
  formData.append("payload", JSON.stringify(body.payload || {}));

  const upstream = await fetch(rpcUrl, {
    method: "POST",
    body: formData,
  });

  const text = await upstream.text();
  try {
    return NextResponse.json(JSON.parse(text), { status: upstream.status });
  } catch {
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("Content-Type") || "text/plain" },
    });
  }
}
