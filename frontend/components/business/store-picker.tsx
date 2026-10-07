import { cn } from "@/lib/utils";

export interface StoreOption {
  store_id: number;
  store_name: string;
  city: string | null;
}

/** Multi-select list of stores to keep close. An empty selection means "everything I can see". */
export function StorePicker({
  stores,
  value,
  onChange,
}: {
  stores: StoreOption[];
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const toggle = (id: number) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  if (stores.length === 0) {
    return <p className="text-sm text-muted-foreground">No stores to show yet.</p>;
  }
  return (
    <fieldset>
      <legend className="sr-only">Stores to keep close</legend>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {stores.map((s) => (
          <li key={s.store_id}>
            <label
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm",
                value.includes(s.store_id) ? "border-foreground" : "border-border",
              )}
            >
              <input type="checkbox" checked={value.includes(s.store_id)} onChange={() => toggle(s.store_id)} />
              {s.store_name}
              <span className="ml-auto text-xs text-muted-foreground">{s.city ?? ""}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
