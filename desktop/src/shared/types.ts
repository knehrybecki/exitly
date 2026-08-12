/** Shared domain types for Exitly desktop. */

export type RunMode = "docker" | "cli";

export type StartOptionType = "text" | "number" | "checkbox" | "select";
export type StartOptionApply = "env" | "arg" | "both";

export interface StartOption {
  id: string;
  label: string;
  type: StartOptionType;
  default: string;
  required: boolean;
  apply: StartOptionApply;
  env: string;
  arg: string;
  placeholder: string;
  choices: string[];
}

export interface Country {
  code: string;
  name: string;
}

export interface ProjectCrawler {
  id: string;
  kind: "project";
  name: string;
  path: string;
  country: string;
  runMode: RunMode;
  service: string;
  vpnContainerName: string;
  containerName: string;
  exit: string;
  crawlModel?: string;
  antibotModel?: string;
  workers?: number;
  options?: StartOption[];
  optionValues?: Record<string, string>;
  useHostWg?: boolean;
  cliCommand?: string;
  cliArgs?: string[];
  cliTerminal?: boolean;
  running?: boolean;
  missing?: boolean;
  envReady?: boolean;
  envMissing?: string[];
  envFields?: EnvField[];
  envFieldCount?: number;
}

export interface EnvField {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  value?: string;
  missing?: boolean;
}

export interface OllamaSettings {
  enabled: boolean;
  baseUrl: string;
  models?: string[];
  defaults?: { crawlModel?: string; antibotModel?: string };
}

export interface SerperSettings {
  enabled: boolean;
  apiKey: string;
}

export interface HostWgSettings {
  name: string;
  configured?: boolean;
  confPath?: string;
  configText?: string;
}

export interface Snapshot {
  ok?: boolean;
  error?: string;
  setupNeeded?: boolean;
  countries?: Country[];
  crawlers?: ProjectCrawler[];
  active?: string;
  ollama?: OllamaSettings;
  serper?: SerperSettings;
  hostWg?: HostWgSettings;
  cliShells?: Array<{
    command: string;
    label: string;
    available: boolean;
    resolved?: string;
  }>;
}

export type LogFn = (line: string) => void;

export interface HubCallOpts {
  onLog?: LogFn;
}
