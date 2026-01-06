import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

export default function LoginPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const nextValue = searchParams?.next;
  const next =
    typeof nextValue === "string" ? nextValue : Array.isArray(nextValue) ? nextValue[0] : "/";

  const params = new URLSearchParams();
  params.set("login", "1");
  if (next && next !== "/") {
    params.set("next", next);
  }

  redirect(`/?${params.toString()}`);
}
