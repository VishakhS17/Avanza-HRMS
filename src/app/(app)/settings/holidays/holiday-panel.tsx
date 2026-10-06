"use client";

import { useActionState } from "react";
import Link from "next/link";
import { FormField } from "@/components/shared/form-field";
import { NativeSelect } from "@/components/shared/native-select";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WEEKDAYS, weekdayLabel, type WeekdayName } from "@/lib/leave-dates";
import {
  createHolidayAction,
  setWeeklyOffAction,
  updateHolidayAction,
  type HolidayActionState,
} from "@/app/(app)/settings/holidays/actions";

const initialState: HolidayActionState = {};

type HolidayRow = { id: string; date: string; name: string; isActive: boolean };

type LocationRow = {
  id: string;
  name: string;
  city: string | null;
  isActive: boolean;
  weeklyOff: WeekdayName[];
};

function Message({ state }: { state: HolidayActionState }) {
  if (state.error) return <p className="text-sm text-destructive">{state.error}</p>;
  if (state.ok) return <p className="text-sm text-secondary">Saved.</p>;
  return null;
}

export function HolidayPanel({
  locations,
  selected,
  holidays,
}: {
  locations: LocationRow[];
  selected: LocationRow | null;
  holidays: HolidayRow[];
}) {
  const [weeklyState, weeklyAction, weeklyPending] = useActionState(setWeeklyOffAction, initialState);
  const [createState, createAction, createPending] = useActionState(createHolidayAction, initialState);

  if (!selected) {
    return <p className="text-sm text-muted-foreground">Add a location before creating holidays.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <FormField label="Location" htmlFor="holiday-location">
          <NativeSelect id="holiday-location" name="location" defaultValue={selected.id}>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
                {location.isActive ? "" : " (inactive)"}
              </option>
            ))}
          </NativeSelect>
        </FormField>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      <form action={weeklyAction} className="rounded-xl border border-border bg-card p-4">
        <input type="hidden" name="locationId" value={selected.id} />
        <p className="text-sm font-medium text-foreground">Weekly off</p>
        <div className="mt-3 flex flex-wrap gap-3">
          {WEEKDAYS.map((day) => (
            <label key={day} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                name="weeklyOff"
                value={day}
                defaultChecked={selected.weeklyOff.includes(day)}
              />
              {weekdayLabel(day)}
            </label>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button type="submit" disabled={weeklyPending}>
            {weeklyPending ? "Saving…" : "Save weekly off"}
          </Button>
          <Message state={weeklyState} />
        </div>
      </form>

      <form action={createAction} className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
        <input type="hidden" name="locationId" value={selected.id} />
        <FormField label="Date" htmlFor="holiday-date">
          <Input name="date" type="date" required />
        </FormField>
        <FormField label="Name" htmlFor="holiday-name">
          <Input name="name" required maxLength={80} />
        </FormField>
        <Button type="submit" disabled={createPending}>
          {createPending ? "Saving…" : "Add holiday"}
        </Button>
        <div className="sm:col-span-3">
          <Message state={createState} />
        </div>
      </form>

      <div className="flex flex-col gap-4">
        {holidays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No holidays for this location yet.</p>
        ) : (
          holidays.map((holiday) => <HolidayRowForm key={holiday.id} holiday={holiday} />)
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Employees see active holidays on <Link href="/my-space/holidays" className="text-secondary hover:underline">Holidays</Link>.
      </p>
    </div>
  );
}

function HolidayRowForm({ holiday }: { holiday: HolidayRow }) {
  const [state, action, pending] = useActionState(updateHolidayAction, initialState);
  return (
    <form action={action} className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[8rem_1fr_9rem_auto] sm:items-end">
      <input type="hidden" name="id" value={holiday.id} />
      <p className="text-sm text-muted-foreground sm:pb-2">{holiday.date}</p>
      <FormField label="Name" htmlFor={`${holiday.id}-name`}>
        <Input name="name" defaultValue={holiday.name} required maxLength={80} />
      </FormField>
      <FormField label="Status" htmlFor={`${holiday.id}-active`}>
        <NativeSelect name="isActive" defaultValue={holiday.isActive ? "true" : "false"}>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </NativeSelect>
      </FormField>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <div className="flex items-center gap-3 sm:col-span-4">
        <StatusBadge status={holiday.isActive ? "success" : "neutral"}>
          {holiday.isActive ? "Active" : "Inactive"}
        </StatusBadge>
        <Message state={state} />
      </div>
    </form>
  );
}
