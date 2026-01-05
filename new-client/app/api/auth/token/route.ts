import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { supabaseServerAdmin } from "@/lib/supabase/server";
import { buildTokenAuthEmail } from "@/lib/auth/tokenAuth";

const TOKEN_LENGTH_BYTES = 16;

function generateToken() {
  return randomBytes(TOKEN_LENGTH_BYTES).toString("hex");
}

export async function POST() {
  try {
    const supabase = await supabaseServerAdmin();
    const token = generateToken();
    const email = buildTokenAuthEmail(token);

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: token,
      email_confirm: true,
      user_metadata: {
        token_auth: true,
      },
    });

    if (error) {
      return NextResponse.json(
        { error: error.message ?? "Failed to create token-auth user" },
        { status: 400 }
      );
    }

    const userId = data?.user?.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Token-auth user was not returned by Supabase" },
        { status: 500 }
      );
    }

    const { error: insertError } = await supabase
      .from("token_auth_keys")
      .insert({
        user_id: userId,
        token,
      });

    if (insertError) {
      return NextResponse.json(
        { error: insertError.message ?? "Failed to store token record" },
        { status: 500 }
      );
    }

    return NextResponse.json({ token });
  } catch (err: unknown) {
    console.error("[token signup]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create token user" },
      { status: 500 }
    );
  }
}
