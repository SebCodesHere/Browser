import { z } from "zod";

/** Validation at the IPC boundary. Website content never reaches these handlers. */

const tabMode = z.enum(["normal", "private", "tor"]);
const theme = z.enum(["system", "light", "dark"]);
const startupBehavior = z.enum(["newtab", "restore", "homepage"]);
const cookiePolicy = z.enum(["allow_all", "block_third_party", "session_only"]);
const id = z.string().min(1).max(200);
const url = z.string().min(1).max(8192);
const label = z.string().max(512);

export const tabIdSchema = id;
export const tabCreateSchema = z
  .object({
    url: url.optional(),
    internalUrl: z.string().max(300).optional(),
    mode: tabMode.optional(),
    activate: z.boolean().optional(),
    index: z.number().int().min(0).max(1000).optional()
  })
  .strict();

export const navigateSchema = z.object({
  tabId: id,
  input: z.string().min(1).max(8192)
});

export const tabOnlySchema = z.object({ tabId: id });

export const reloadSchema = z.object({
  tabId: id,
  ignoreCache: z.boolean().optional()
});

export const moveSchema = z.object({
  tabId: id,
  toIndex: z.number().int().min(0).max(1000)
});

export const findSchema = z.object({
  tabId: id,
  query: z.string().max(1000),
  options: z
    .object({
      forward: z.boolean().optional(),
      findNext: z.boolean().optional()
    })
    .strict()
    .optional()
});

export const boundsSchema = z.object({
  tabId: id.nullable(),
  bounds: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      width: z.number().finite(),
      height: z.number().finite()
    })
    .strict()
    .nullable()
});

export const settingsPatchSchema = z
  .object({
    theme: theme.optional(),
    searchProvider: z.string().min(1).max(80).optional(),
    customSearchName: label.optional(),
    customSearchUrl: z.string().max(8192).optional(),
    homepage: z.string().max(8192).optional(),
    startupBehavior: startupBehavior.optional(),
    downloadDirectory: z.string().max(4096).optional(),
    askWhereToSave: z.boolean().optional(),
    tabSleepEnabled: z.boolean().optional(),
    tabSleepMinutes: z.number().int().min(1).max(1440).optional(),
    devMode: z.boolean().optional(),
    cookiePolicy: cookiePolicy.optional(),
    clearDataOnExit: z.boolean().optional(),
    sendDoNotTrack: z.boolean().optional(),
    torProxy: z.string().max(512).optional(),
    extensionsEnabled: z.boolean().optional(),
    adblockEnabled: z.boolean().optional(),
    adblockAllowlist: z.array(z.string().max(253)).max(500).optional(),
    accentTheme: z
      .enum(["mint", "peach", "sky", "lilac", "rose", "sunset", "custom"])
      .optional(),
    accentColor: z.string().max(9).optional(),
    wallpaperId: z.enum(["none", "aurora", "dunes", "grid", "mist", "custom"]).optional(),
    wallpaperPath: z.string().max(200).optional()
  })
  .strict();

const importPath = z.string().min(1).max(4096);

export const importPickerSchema = z.enum(["file", "folder"]);

export const importPreviewSchema = z
  .object({
    bookmarksPath: importPath.nullable().optional(),
    settingsPath: importPath.nullable().optional()
  })
  .strict()
  .refine(
    (value) => Boolean(value.bookmarksPath || value.settingsPath),
    "Choose a bookmarks or settings file."
  );

export const importCommitSchema = z
  .object({
    bookmarksPath: importPath
  })
  .strict();

export const bookmarkCreateSchema = z
  .object({
    url,
    title: label.optional(),
    folder: z.string().max(120).optional()
  })
  .strict();

export const bookmarkUpdateSchema = z
  .object({
    title: label.optional(),
    url: url.optional(),
    folder: z.string().max(120).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update."
  });

export const bookmarkQuerySchema = z.object({
  query: z.string().max(1000).optional(),
  folder: z.string().max(120).optional()
});

export const historyQuerySchema = z.object({
  query: z.string().max(1000).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  offset: z.number().int().min(0).max(1_000_000).optional()
});

export const topSitesSchema = z.object({
  limit: z.number().int().min(1).max(50).optional()
});

export const extensionToggleSchema = z.object({
  id,
  enabled: z.boolean()
});

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` (${issue.path.join(".")})` : "";
    throw new Error(`Invalid request${where}: ${issue?.message ?? "validation failed"}`);
  }
  return result.data;
}
