"use server";

import { redirect } from "next/navigation";

import { createClient } from "../../lib/supabase/server";

export async function signOut() {
  let failed = false;

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    failed = Boolean(error);
  } catch {
    failed = true;
  }

  if (failed) {
    redirect("/?authError=signout");
  }

  redirect("/");
}
