/** IPC channel names and payload shapes. */

export const Ipc = {
  hub: {
    getAppInfo: "hub:getAppInfo",
    getSnapshot: "hub:getSnapshot",
    getOllama: "hub:getOllama",
    setOllama: "hub:setOllama",
    checkOllama: "hub:checkOllama",
    getSerper: "hub:getSerper",
    setSerper: "hub:setSerper",
    checkSerper: "hub:checkSerper",
    getHostWg: "hub:getHostWg",
    setHostWg: "hub:setHostWg",
    testHostWg: "hub:testHostWg",
    testProjectMcp: "hub:testProjectMcp",
    setProjectUseHostWg: "hub:setProjectUseHostWg",
    setProjectCliShell: "hub:setProjectCliShell",
    setupEnv: "hub:setupEnv",
    connect: "hub:connect",
    disconnect: "hub:disconnect",
    refreshIp: "hub:refreshIp",
    checkProjectIp: "hub:checkProjectIp",
    createProject: "hub:createProject",
    registerProject: "hub:registerProject",
    duplicateProject: "hub:duplicateProject",
    exportProject: "hub:exportProject",
    importProject: "hub:importProject",
    setCrawlerExit: "hub:setCrawlerExit",
    setProjectModels: "hub:setProjectModels",
    getProjectEnv: "hub:getProjectEnv",
    setProjectEnv: "hub:setProjectEnv",
    openInCursor: "hub:openInCursor",
    pickProjectParent: "hub:pickProjectParent",
    pickExistingProject: "hub:pickExistingProject",
    removeCrawler: "hub:removeCrawler",
    startCrawler: "hub:startCrawler",
    setProjectStartOptions: "hub:setProjectStartOptions",
    stopCrawler: "hub:stopCrawler",
    getProjectLogs: "hub:getProjectLogs",
    followProjectLogs: "hub:followProjectLogs",
    stopProjectLogs: "hub:stopProjectLogs",
    pickEnvHelp: "hub:pickEnvHelp",
  },
  update: {
    check: "update:check",
    download: "update:download",
    install: "update:install",
  },
  push: {
    hubLog: "hub:log",
    projectLog: "project:log",
    updateStatus: "update:status",
  },
} as const;

export type UpdateStatusPayload = {
  state:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  version?: string;
  releaseNotes?: string;
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
  message?: string;
};

export type ProjectLogPayload = { id: string; line: string };
