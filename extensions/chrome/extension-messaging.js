(() => {
  const RECOVERY_MESSAGE = "Carnival extension was reloaded. Refresh PlayHouse.";
  const reportedFailures = new Set();

  function failure(code, message) {
    return { code, message, ok: false };
  }

  function fromError(error) {
    const message = typeof error?.message === "string" ? error.message : "";
    if (/extension context invalidated/i.test(message)) {
      return failure("EXTENSION_CONTEXT_UNAVAILABLE", RECOVERY_MESSAGE);
    }
    return failure("RUNTIME_MESSAGE_FAILED", message || "Carnival extension request failed.");
  }

  function normalizeResponse(response) {
    if (response === undefined) {
      return failure("MISSING_RESPONSE", "Carnival extension returned no response.");
    }
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      return failure("MALFORMED_RESPONSE", "Carnival extension returned an invalid response.");
    }
    return { ok: true, response };
  }

  function send(message) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime || typeof runtime.sendMessage !== "function") {
      return Promise.resolve(failure("EXTENSION_CONTEXT_UNAVAILABLE", RECOVERY_MESSAGE));
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      try {
        const pending = runtime.sendMessage(message, (response) => {
          let lastError;
          try {
            lastError = runtime.lastError;
          } catch (error) {
            finish(fromError(error));
            return;
          }
          finish(lastError ? fromError(lastError) : normalizeResponse(response));
        });
        if (pending && typeof pending.then === "function") {
          pending.then(
            (response) => finish(normalizeResponse(response)),
            (error) => finish(fromError(error)),
          );
        }
      } catch (error) {
        finish(fromError(error));
      }
    });
  }

  function reportFailureOnce(label, result) {
    if (result?.ok !== false) return;
    const key = `${result.code}:${result.message}`;
    if (reportedFailures.has(key)) return;
    reportedFailures.add(key);
    console.warn(`${label}: ${result.message}`, { code: result.code });
  }

  globalThis.CarnivalExtensionMessaging = Object.freeze({
    RECOVERY_MESSAGE,
    reportFailureOnce,
    send,
  });
})();
