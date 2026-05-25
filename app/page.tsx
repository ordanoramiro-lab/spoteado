import { createClient } from "@/lib/supabase/server";
import { SearchBar } from "@/components/search/search-bar";

export default async function Home() {
  const supabase = await createClient();
  const { data: beaches } = await supabase
    .from("beaches")
    .select("slug, name")
    .order("name");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16">
      <h1 className="font-serif text-4xl tracking-tight">Encontrá tu ola.</h1>
      <SearchBar beaches={beaches ?? []} />
    </main>
  );
}
