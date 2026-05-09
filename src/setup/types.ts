// --- Wizard prompt interface ---

export interface Prompts {
  group<T extends Record<string, () => Promise<unknown>>>(
    prompts: T,
  ): Promise<Record<string, unknown>>;
  text(opts: {
    message: string;
    placeholder?: string;
    defaultValue?: string;
  }): Promise<unknown>;
  select(opts: {
    message: string;
    options: Array<{ value: unknown; label: string; hint?: string }>;
  }): Promise<unknown>;
  confirm(opts: { message: string; initialValue?: boolean }): Promise<unknown>;
  isCancel(val: unknown): boolean;
  spinner(): { start(msg: string): void; stop(msg: string): void };
  note(content: string, title: string): void;
  intro(msg: string): void;
  outro(msg: string): void;
  log: {
    success(msg: string): void;
    error(msg: string): void;
    warn(msg: string): void;
    info(msg: string): void;
  };
}

// --- Setup API interface (injected for testing) ---

export interface SetupApi {
  testConnection(): Promise<void>;
  createApp(
    name: string,
  ): Promise<{ app_token: string; table_id: string; url: string }>;
  createTable(appToken: string, name: string): Promise<{ table_id: string }>;
  deleteTable(appToken: string, tableId: string): Promise<void>;
  lookupUserByMobile(phone: string): Promise<string>;
  transferOwnership(appToken: string, openId: string): Promise<void>;
  listTables(appToken: string): Promise<{ table_id: string; name: string }[]>;
  listFields(
    appToken: string,
    tableId: string,
  ): Promise<{ field_name: string; type: number }[]>;
}

// --- Wizard dependencies ---

export interface InitDeps {
  prompts: Prompts;
  createSetupApi(appId: string, appSecret: string): SetupApi;
  checkClaudeCli(): Promise<boolean>;
  homedir(): string;
}

// --- Wizard result ---

export interface WizardResult {
  tracker: Record<string, unknown>;
  workspace: Record<string, unknown>;
  agent: Record<string, unknown>;
  promptTemplate: string;
  credentials?: Record<string, string>;
}

// --- CLI argument types (forward reference) ---

export interface InitArgs {
  nonInteractive?: boolean;
  tracker?: string;
  template?: string;
  approvalPolicy?: string;
  workspaceRoot?: string;
  exportPath?: string;
  importPath?: string;
  dryRun?: boolean;
  appId?: string;
  appSecret?: string;
  appToken?: string;
  tableId?: string;
  gitlabHost?: string;
  gitlabToken?: string;
  projectId?: string;
  activeStates?: string;
  terminalStates?: string;
  githubHost?: string;
  githubToken?: string;
  githubOwner?: string;
  githubRepo?: string;
  workspaceType?: string;
  gitUrl?: string;
  gitPath?: string;
  gitBranch?: string;
  gitRepo?: string;
}

// --- Tracker setup function types ---

export interface TrackerSetupContext {
  prompts: Prompts;
  /** Optional overrides for testing (e.g., mock API factories) */
  testOverrides?: Record<string, unknown>;
  /** Optional CLI args for pre-filling values */
  initArgs?: InitArgs;
}

export interface TrackerSetupResult {
  config: Record<string, unknown>;
  credentials?: Record<string, string>;
}

export type TrackerSetupFn = (ctx: TrackerSetupContext) => Promise<TrackerSetupResult>;

// --- Export/Import types ---

export interface ExportData {
  version: 1;
  exportedAt: string;
  tracker: {
    kind: string;
    config: Record<string, unknown>;
    credentials?: Record<string, string>;
  };
  agent: Record<string, unknown>;
  workspace: Record<string, unknown>;
  polling: Record<string, unknown>;
  promptTemplate: string;
}
