import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

function trimText(value: string, maxLength = 4000): string {
  if (!value) return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function formatRouteError(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

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

  const action = String(body.action || "").trim();
  if (!action) {
    return NextResponse.json({ status: "error", message: "Missing RPC action." }, { status: 400 });
  }

  const formData = new FormData();
  formData.append("action", action);
  formData.append("payload", JSON.stringify(body.payload || {}));

  let upstream: Response;
  try {
    upstream = await fetch(rpcUrl, {
      method: "POST",
      body: formData,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        message: `Failed to reach backend RPC endpoint for action "${action}": ${formatRouteError(error)}`,
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  let parsed: unknown = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!upstream.ok) {
    return NextResponse.json(
      {
        status: "error",
        message: {
          action,
          upstream_status: upstream.status,
          upstream_status_text: upstream.statusText,
          upstream_body: parsed ?? trimText(text),
        },
      },
      { status: upstream.status },
    );
  }

  if (parsed && typeof parsed === "object") {
    return NextResponse.json(parsed, { status: upstream.status });
  }

  return NextResponse.json(
    {
      status: "error",
      message: {
        action,
        upstream_status: upstream.status,
        upstream_body: trimText(text),
      },
    },
    { status: 502 },
  );
}
