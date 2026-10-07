import { cn } from "@/lib/utils";

export interface RoleOption<T extends string = string> {
  value: T;
  label: string;
  blurb?: string;
}

/** Radio cards for choosing a role. Pass `locked` when the role comes from the sign-in and can't change. */
export function RoleCardGroup<T extends string>({
  roles,
  value,
  onChange,
  locked = false,
  legend = "Your role",
}: {
  roles: RoleOption<T>[];
  value: T;
  onChange: (value: T) => void;
  locked?: boolean;
  legend?: string;
}) {
  const shown = locked ? roles.filter((r) => r.value === value) : roles;
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {shown.map((role) => {
          const selected = role.value === value;
          return (
            <label
              key={role.value}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-xl border bg-card px-3 py-2.5 text-sm transition-colors",
                selected ? "border-foreground ring-1 ring-foreground/30" : "border-border hover:bg-secondary/60",
                locked && "cursor-default",
              )}
            >
              <input
                type="radio"
                name="role"
                className="sr-only"
                checked={selected}
                disabled={locked}
                onChange={() => onChange(role.value)}
              />
              <span className="font-medium">{role.label}</span>
              {role.blurb ? <span className="text-xs text-muted-foreground">{role.blurb}</span> : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
