const INTEGRATIONS = Object.freeze({
  meta_ads: {
    tool: "meta_ads_tool",
    requiredGroups: [["META_ACCESS_TOKEN", "META_AD_ACCOUNT_ID"]],
    optional: ["META_ADS_MONITOR_ENABLED", "META_CPM_ALERT_INCREASE_PERCENT", "META_CTR_ALERT_THRESHOLD"],
  },
  vercel: {
    tool: "vercel_tool",
    requiredGroups: [["VERCEL_TOKEN"]],
    optional: ["VERCEL_TEAM_ID", "VERCEL_PROJECTS", "VERCEL_BRIEFING_PROJECTS"],
  },
  supabase: {
    tool: "supabase_tool",
    requiredGroups: [["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], ["SUPABASE_PROJECTS"]],
    optional: [],
  },
  prompt_sell_tool: {
    tool: "prompt_sell_tool",
    requiredGroups: [["GEMINI_API_KEY"]],
    optional: [],
  },
  tiktok_shop_tool: {
    tool: "tiktok_shop_tool",
    requiredGroups: [["GEMINI_API_KEY"]],
    optional: ["TAVILY_API_KEY"],
  },
});

export const BUSINESS_INTEGRATION_NAMES = Object.keys(INTEGRATIONS);

function isPresent(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function getBusinessToolStatus(integrationName) {
  const integration = INTEGRATIONS[integrationName];
  if (!integration) return null;

  const groups = integration.requiredGroups.map((group) => ({
    variables: group,
    missing: group.filter((name) => !isPresent(name)),
  }));

  const satisfiedGroup = groups.find((group) => group.missing.length === 0) || null;

  return {
    tool: integration.tool,
    integration: integrationName,
    configured: satisfiedGroup !== null,
    status: satisfiedGroup !== null ? "configurado" : "credenciais_ausentes",
    missing: satisfiedGroup ? [] : groups[0].missing,
    accepted_credential_sets: integration.requiredGroups,
    optional_present: integration.optional.filter(isPresent),
    checked: "presença de variáveis de ambiente no processo do cérebro — nenhuma chamada de rede foi feita, portanto isto não prova que a credencial é válida nem que o serviço está no ar",
  };
}

export function getAllBusinessToolStatus() {
  return BUSINESS_INTEGRATION_NAMES.map(getBusinessToolStatus);
}
