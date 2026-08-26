import { PlayhouseShell } from "../components/playhouse-shell";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; basket?: string }>;
}) {
  const { view, basket } = await searchParams;

  return <PlayhouseShell view={view} basket={basket} />;
}
