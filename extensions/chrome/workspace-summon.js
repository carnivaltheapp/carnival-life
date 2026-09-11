export function createWorkspaceActions({ controller, logger = console, reportDrawerState, validWorkArea }) {
  let retractPromise = null;
  let summonPromise = null;

  async function summon({ monitorId, workArea }, source) {
    if (summonPromise) return summonPromise;
    summonPromise = (async () => {
      logger.info(`Carnival: summon workspace requested (${source})`);
      const prior = await controller.state();
      logger.info(`Carnival: workspace state = ${prior.drawerState ?? "unknown"}`);
      const reconciled = await controller.reconcileWorkspaceState(workArea);
      if (reconciled.actuallyOpen) {
        const active = await controller.activate();
        reportDrawerState(active);
        return active;
      }
      logger.info("Carnival: creating/restoring windows");
      const state = await controller.summon(workArea, monitorId);
      reportDrawerState(state);
      logger.info(`Carnival: workspace state = ${state.drawerState}`);
      return state;
    })();
    try {
      return await summonPromise;
    } finally {
      summonPromise = null;
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
