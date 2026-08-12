export type Country = {
  code: string;
  name: string;
};

export type CliShell = {
  command: string;
  label: string;
  resolved?: string;
  available?: boolean;
};

export type StartOption = {
  id: string;
  label: string;
  type?: string;
  apply?: string;
  env?: string;
  arg?: string;
  default?: string;
  required?: boolean;
  placeholder?: string;
  choices?: string[];
};

export type EnvField = {
  key: string;
  label: string;
  value?: string;
  secret?: boolean;
  required?: boolean;
  missing?: boolean;
  placeholder?: string;
};

export type ProjectIpInfo = {
  ip?: string;
  country?: string;
  city?: string;
  org?: string;
  via?: string;
  error?: string;
};

export type ProjectItem = {
  id: string;
  kind?: string;
  name: string;
  path?: string;
  running?: boolean;
  runMode?: string;
  country?: string;
  exit?: string;
  crawlModel?: string;
  antibotModel?: string;
  workers?: number;
  cliCommand?: string;
  cliArgs?: string[];
  envReady?: boolean;
  envMissing?: string[];
  envFields?: EnvField[];
  envFieldCount?: number;
  options?: StartOption[];
  optionValues?: Record<string, string>;
  useHostWg?: boolean;
};

export type OllamaConfig = {
  enabled?: boolean;
  ok?: boolean;
  error?: string;
  baseUrl?: string;
  models?: string[];
  defaults?: {
    crawlModel?: string;
    antibotModel?: string;
  };
};

export type SerperConfig = {
  enabled?: boolean;
  configured?: boolean;
  apiKey?: string;
  masked?: string;
};

export type HostWgConfig = {
  name?: string;
  configText?: string;
  configured?: boolean;
  up?: boolean;
  managed?: boolean;
};

export type Snapshot = {
  ok?: boolean;
  error?: string;
  setupNeeded?: boolean;
  active?: string;
  countries?: Country[];
  crawlers?: ProjectItem[];
  ollama?: OllamaConfig;
  serper?: SerperConfig;
  hostWg?: HostWgConfig;
  cliShells?: CliShell[];
  duplicatedProjectId?: string;
  importedProjectId?: string;
};

export type UpdateStatusPayload = {
  state?: string;
  version?: string;
  percent?: number;
  message?: string;
  reason?: string;
};

export type ProjectEnvData = {
  fields?: EnvField[];
  missingRequired?: string[];
  path?: string;
};
