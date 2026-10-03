"use server";

import {
  ArchiveSourceInput,
  archiveSource as archiveSourceService,
  CreateSourceUploadInput,
  CreateTextSourceInput,
  completeSourceUpload as completeSourceUploadService,
  createSourceUpload as createSourceUploadService,
  createTextSource as createTextSourceService,
  GetSourceDownloadUrlInput,
  getSourceDownloadUrl as getSourceDownloadUrlService,
  SourceIdInput,
  UpdateSourceRightsInput,
  updateSourceRights as updateSourceRightsService,
} from "@rc/modules/knowledge";
import { defineAction } from "./_define";

// Plan 05 §5.3. Roles per 10 §10.6: rights and archiving are owner-only, the rest is any user.

export const createSourceUpload = defineAction({
  name: "createSourceUpload",
  input: CreateSourceUploadInput,
  handler: (ctx, input) => createSourceUploadService(ctx, input),
});

export const completeSourceUpload = defineAction({
  name: "completeSourceUpload",
  input: SourceIdInput,
  handler: (ctx, input) => completeSourceUploadService(ctx, input),
});

export const createTextSource = defineAction({
  name: "createTextSource",
  input: CreateTextSourceInput,
  handler: (ctx, input) => createTextSourceService(ctx, input),
});

export const updateSourceRights = defineAction({
  name: "updateSourceRights",
  input: UpdateSourceRightsInput,
  roles: ["owner"],
  handler: (ctx, input) => updateSourceRightsService(ctx, input),
});

export const archiveSource = defineAction({
  name: "archiveSource",
  input: ArchiveSourceInput,
  roles: ["owner"],
  handler: (ctx, input) => archiveSourceService(ctx, input),
});

export const getSourceDownloadUrl = defineAction({
  name: "getSourceDownloadUrl",
  input: GetSourceDownloadUrlInput,
  handler: (ctx, input) => getSourceDownloadUrlService(ctx, input),
});
