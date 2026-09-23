export function createWorkspaceActions({
  controller,
  logger = console,
  reportDrawerState,
  validWorkArea,
  windowTrace = null,
}) {
  let retractPromise = null;
  let summonPromise = null;

  async function summon({ monitorId, workArea }, source) {
    await windowTrace?.start(source);
    windowTrace?.workspaceStartRequest(source);
    windowTrace?.enter("workspace", {
      initializationAlreadyRunning: Boolean(summonPromise),
      reason: source,
      source: "workspace-summon",
    });
    let result = null;
    const joinedExisting = Boolean(summonPromise);
    try {
      if (joinedExisting) {
        result = await summonPromise;
        return result;
      }
      summonPromise = (async () => {
        logger.info(`Carnival: summon workspace requested (${source})`);
        const prior = await controller.state();
        windowTrace?.emit("workspace-summon", "WORKSPACE_STATE_AT_ENTRY", {
          auxWindowId: prior.auxWindowId,
          drawerState: prior.drawerState ?? null,
          playhouseWindowId: prior.phWindowId,
          reason: source,
        });
        logger.info(`Carnival: workspace state = ${prior.drawerState ?? "unknown"}`);
        const reconciled = await controller.reconcileWorkspaceState(workArea);
        if (reconciled.actuallyOpen) {
          const active = await controller.activate();
          reportDrawerState(active);
          return active;
        }
        logger.info("Carnival: creating/restoring windows");
        const coldStart = windowTrace?.coldStartContext;
        const state = await controller.summon(workArea, monitorId, {
          allowColdStartPlayhouseAdoption: source === "native hot corner" && coldStart?.eligible === true,
          coldStartCandidateWindowIds: coldStart?.candidateWindowIds ?? [],
          source,
        });
        reportDrawerState(state);
        logger.info(`Carnival: workspace state = ${state.drawerState}`);
        return state;
      })();
      try {
        result = await summonPromise;
        return result;
      } finally {
        summonPromise = null;
      }
    } finally {
      windowTrace?.exit("workspace", {
        auxWindowId: result?.auxWindowId ?? result?.contextWindowId ?? null,
        playhouseWindowId: result?.phWindowId ?? result?.playhouseWindowId ?? null,
        source: "workspace-summon",
      });
    }
  }

  async function retract(source) {
    if (retractPromise) return retractPromise;
    retractPromise = (async () => {
      logger.info(`Carnival: retract workspace requested (${source})`);
      const prior = await controller.state();
      if (prior.drawerState !== "open") return prior;
      const state = await controller.retract();
      reportDrawerState(state);
      logger.info(`Carnival: workspace state = ${state.drawerState}`);
      return state;
    })();
    try {
      return await retractPromise;
    } finally {
      retractPromise = null;
    }
  }

  async function handleNativeMessage(message, port) {
    if (message?.type === "summon" && validWorkArea(message.workArea)) {
      logger.info("Carnival: native summon received");
      port.postMessage({ type: "summonAccepted" });
      await summon({
        monitorId: message.monitorId ?? null,
        workArea: message.workArea,
      }, "native hot corner");
    } else if (message?.type === "retract") {
      await retract("native retract zone");
    }
  }

  return { handleNativeMessage, retract, summon };
}
