"use server";

import {
  DisconnectAccountInput,
  disconnectInstagramAccount as disconnectService,
} from "@rc/modules/instagram";
import { defineAction } from "./_define";

// Plan 05 §5.9. Connecting an account is a browser redirect (/api/instagram/oauth/*), not an
// action. Disconnecting is for owners (10 §10.6).

export const disconnectInstagramAccount = defineAction({
  name: "disconnectInstagramAccount",
  input: DisconnectAccountInput,
  roles: ["owner"],
  handler: (ctx, input) => disconnectService(ctx, input),
});
