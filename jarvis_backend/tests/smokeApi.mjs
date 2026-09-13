const BASE = process.env.SMOKE_BASE_URL || "http://127.0.0.1:4099";
const PIN = process.env.SMOKE_DEVICE_PIN || "999111";

const resultados = [];

async function chamar(metodo, caminho, { token, corpo } = {}) {
  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const texto = await resposta.text();
  let json;
  try {
    json = JSON.parse(texto);
  } catch {
    json = { raw: texto.slice(0, 200) };
  }
  return { status: resposta.status, json };
}

function verificar(nome, condicao, detalhe) {
  resultados.push({ nome, ok: Boolean(condicao), detalhe });
  const marca = condicao ? "PASSOU" : "FALHOU";
  console.log(`${marca}  ${nome}${condicao ? "" : `  -> ${detalhe}`}`);
}

const saude = await chamar("GET", "/api/v1/health");
verificar("health responde sem autenticacao", saude.status === 200 && saude.json.ok === true, JSON.stringify(saude.json));

const semToken = await chamar("GET", "/api/v1/network/clinics");
verificar("rota protegida recusa requisicao sem token", semToken.status === 401, `status ${semToken.status}`);

const pinErrado = await chamar("POST", "/auth/token", { corpo: { devicePin: "000000" } });
verificar("PIN errado e recusado", pinErrado.status === 401, `status ${pinErrado.status}`);

const login = await chamar("POST", "/auth/token", { corpo: { devicePin: PIN } });
verificar("PIN correto devolve token", login.status === 200 && Boolean(login.json.token), JSON.stringify(login.json));
const token = login.json.token;

const tokenFalso = await chamar("GET", "/api/v1/network/clinics", { token: "token.invalido.aqui" });
verificar("token invalido e recusado", tokenFalso.status === 401, `status ${tokenFalso.status}`);

const clinicas = await chamar("GET", "/api/v1/network/clinics", { token });
verificar(
  "status das clinicas responde com estrutura",
  clinicas.status === 200 && Array.isArray(clinicas.json.clinics) && clinicas.json.clinics.length === 1,
  JSON.stringify(clinicas.json).slice(0, 200)
);
verificar(
  "falha do tailscale e reportada em vez de fingir que caiu",
  clinicas.json.tailscaleError !== undefined,
  JSON.stringify(clinicas.json).slice(0, 200)
);

const catalogo = await chamar("GET", "/api/v1/network/commands", { token });
verificar(
  "catalogo de comandos e exposto sem vazar o powershell",
  catalogo.status === 200 &&
    catalogo.json.commands.length > 0 &&
    catalogo.json.commands.every((c) => !("powershell" in c)),
  JSON.stringify(catalogo.json).slice(0, 200)
);

const negocio = await chamar("GET", "/api/v1/business/status/vercel", { token });
verificar(
  "status de negocio admite que so checa variavel de ambiente",
  negocio.status === 200 && /nenhuma chamada de rede/.test(negocio.json.checked || ""),
  JSON.stringify(negocio.json).slice(0, 200)
);

const negocioInvalido = await chamar("GET", "/api/v1/business/status/inexistente", { token });
verificar("integracao desconhecida e recusada", negocioInvalido.status === 400, `status ${negocioInvalido.status}`);

const memoria = await chamar("POST", "/api/v1/memory/search", { token, corpo: { query: "orcamento" } });
verificar(
  "busca de memoria degrada com elegancia sem o chroma",
  memoria.status === 200 && Array.isArray(memoria.json.documents),
  JSON.stringify(memoria.json).slice(0, 200)
);

const comandoInvalido = await chamar("POST", "/api/v1/network/remote-command", {
  token,
  corpo: { clinic: "consultorio-teste", command_id: "rm -rf /" },
});
verificar(
  "command_id fora do catalogo e recusado",
  comandoInvalido.status === 400 && Array.isArray(comandoInvalido.json.allowed),
  JSON.stringify(comandoInvalido.json).slice(0, 200)
);

const clinicaInvalida = await chamar("POST", "/api/v1/network/remote-command", {
  token,
  corpo: { clinic: "clinica-que-nao-existe", command_id: "disk_free" },
});
verificar("clinica fora da configuracao e recusada", clinicaInvalida.status === 404, `status ${clinicaInvalida.status}`);

const destrutivoSemConfirmar = await chamar("POST", "/api/v1/network/remote-command", {
  token,
  corpo: { clinic: "consultorio-teste", command_id: "restart_print_spooler" },
});
verificar(
  "comando destrutivo sem confirmacao e BLOQUEADO pelo guard do cerebro",
  destrutivoSemConfirmar.status === 409 && destrutivoSemConfirmar.json.blocked === true,
  `status ${destrutivoSemConfirmar.status} ${JSON.stringify(destrutivoSemConfirmar.json).slice(0, 200)}`
);

const whatsapp = await chamar("GET", "/api/v1/whatsapp/status", { token });
verificar(
  "ponte de whatsapp ausente e reportada com motivo claro",
  whatsapp.status === 503 && /jarvis-whatsapp|BRIDGE_TOKEN/.test(whatsapp.json.error || ""),
  `status ${whatsapp.status} ${JSON.stringify(whatsapp.json).slice(0, 200)}`
);

const falhas = resultados.filter((r) => !r.ok);
console.log(`\n${resultados.length - falhas.length}/${resultados.length} verificacoes passaram`);
process.exit(falhas.length === 0 ? 0 : 1);
