"use server";

import {
  CancelPublicationInput,
  cancelPublication as cancelService,
  ReschedulePublicationInput,
  reschedulePublication as rescheduleService,
  SchedulePublicationInput,
  schedulePublication as scheduleService,
} from "@rc/modules/publishing";
import { defineAction } from "./_define";

// Plan 05 §5.8. Scheduling, moving and cancelling are for owners and editors (10 §10.6); a chef
// reviews and approves but does not schedule.

const slim = (p: { id: string; status: string; scheduledAt: Date | null }) => ({
  publicationId: p.id,
  status: p.status,
  scheduledAt: p.scheduledAt?.toISOString() ?? null,
});

export const schedulePublication = defineAction({
  name: "schedulePublication",
  input: SchedulePublicationInput,
  roles: ["owner", "editor"],
  handler: async (ctx, input) => {
    const { publication, warnings } = await scheduleService(ctx, input);
    return { ...slim(publication), warnings };
  },
});

export const reschedulePublication = defineAction({
  name: "reschedulePublication",
  input: ReschedulePublicationInput,
  roles: ["owner", "editor"],
  handler: async (ctx, input) => {
    const { publication, warnings } = await rescheduleService(ctx, input);
    return { ...slim(publication), warnings };
  },
});

export const cancelPublication = defineAction({
  name: "cancelPublication",
  input: CancelPublicationInput,
  roles: ["owner", "editor"],
  handler: async (ctx, input) => slim(await cancelService(ctx, input)),
});
