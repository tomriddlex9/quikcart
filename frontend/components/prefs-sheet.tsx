"use client";

import { useTheme } from "next-themes";
import { Laptop, Moon, Sun } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACCENT_OPTIONS,
  DENSITY_OPTIONS,
  RADIUS_OPTIONS,
  TEAM_LENS_OPTIONS,
  usePrefs,
  type Accent,
  type Density,
  type Radius,
  type TeamLens,
} from "@/lib/prefs";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
] as const;

export function PrefsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { theme, setTheme } = useTheme();
  const { prefs, setPrefs } = usePrefs();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Console preferences</SheetTitle>
          <SheetDescription>
            Theme, density, and lens settings persist on this device.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-4">
          <section className="flex flex-col gap-2">
            <Label>Theme</Label>
            <div className="flex gap-1.5">
              {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={theme === value ? "secondary" : "outline"}
                  className="flex-1 gap-1.5"
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                >
                  <Icon className="size-3.5" />
                  {label}
                </Button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <Label htmlFor="prefs-team">Team lens</Label>
            <Select
              value={prefs.team}
              onValueChange={(value) => setPrefs({ team: value as TeamLens })}
            >
              <SelectTrigger id="prefs-team" className="w-full">
                <SelectValue placeholder="Team" />
              </SelectTrigger>
              <SelectContent>
                {TEAM_LENS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Reshapes home modules and sidebar emphasis.
            </p>
          </section>

          <section className="flex flex-col gap-2">
            <Label htmlFor="prefs-density">Density</Label>
            <Select
              value={prefs.density}
              onValueChange={(value) => setPrefs({ density: value as Density })}
            >
              <SelectTrigger id="prefs-density" className="w-full">
                <SelectValue placeholder="Density" />
              </SelectTrigger>
              <SelectContent>
                {DENSITY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="flex flex-col gap-2">
            <Label htmlFor="prefs-accent">Accent</Label>
            <Select
              value={prefs.accent}
              onValueChange={(value) => setPrefs({ accent: value as Accent })}
            >
              <SelectTrigger id="prefs-accent" className="w-full">
                <SelectValue placeholder="Accent" />
              </SelectTrigger>
              <SelectContent>
                {ACCENT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="flex flex-col gap-2">
            <Label htmlFor="prefs-radius">Corner radius</Label>
            <Select
              value={prefs.radius}
              onValueChange={(value) => setPrefs({ radius: value as Radius })}
            >
              <SelectTrigger id="prefs-radius" className="w-full">
                <SelectValue placeholder="Radius" />
              </SelectTrigger>
              <SelectContent>
                {RADIUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <section className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="prefs-reduced-motion">Reduced motion</Label>
              <p className="text-xs text-muted-foreground">
                Disables skeleton pulses and route animations.
              </p>
            </div>
            <Switch
              id="prefs-reduced-motion"
              checked={prefs.reducedMotion}
              onCheckedChange={(checked) => setPrefs({ reducedMotion: checked })}
            />
          </section>

          <section className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="prefs-compact-nav">Compact nav</Label>
              <p className="text-xs text-muted-foreground">
                Narrows the sidebar to reclaim workspace width.
              </p>
            </div>
            <Switch
              id="prefs-compact-nav"
              checked={prefs.compactNav}
              onCheckedChange={(checked) => setPrefs({ compactNav: checked })}
            />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
