const AUTHORIZE_TIMEOUT_MS = 125_000;

export function createRemoteGuard({ brainUrl, satelliteId, satelliteToken }) {
  async function requestAuthorization(description) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AUTHORIZE_TIMEOUT_MS);

    try {
      const response = await fetch(`${brainUrl}/satellite/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: satelliteId, token: satelliteToken, description }),
        signal: controller.signal,
      });

      if (!response.ok) {
        console.error(`[satellite] cérebro recusou autorização (HTTP ${response.status}) para: ${description}`);
        return false;
      }

      const payload = await response.json();
      return Boolean(payload.approved);
    } catch (error) {
      console.error(`[satellite] falha ao pedir autorização ao cérebro: ${error.message}`);
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return async function guardExecutionRemote(description, { destructive = false } = {}, executeFn) {
    if (destructive) {
      console.warn(`[satellite] comando destrutivo aguardando autorização do cérebro: "${description}"`);
      const approved = await requestAuthorization(description);

      if (!approved) {
        console.warn(`[satellite] comando destrutivo NEGADO/expirado: "${description}"`);
        return { blocked: true, message: "Ação bloqueada: confirmação negada, expirada ou kill switch ativo no cérebro." };
      }

      console.log(`[satellite] comando destrutivo CONFIRMADO: "${description}"`);
    }

    return { blocked: false, result: await executeFn() };
  };
}
