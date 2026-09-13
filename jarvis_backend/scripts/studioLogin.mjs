import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createHumanBrowser, findSystemChrome, sleep } from "../src/studio/browser.js";
import { saveSession, sessionStatus, sessionPath } from "../src/studio/session.js";

const MINING_ACCOUNT = process.env.STUDIO_MINING_ACCOUNT || "@shopblunt";

async function waitForEnter(message) {
  const rl = createInterface({ input: stdin, output: stdout });
  await rl.question(message);
  rl.close();
}

async function detectLoggedAccount(page) {
  try {
    await page.goto("https://www.tiktok.com/foryou", { waitUntil: "domcontentloaded", timeout: 45_000 });
    await sleep(5000);

    return page.evaluate(() => {
      const profileLink = document.querySelector('[data-e2e="nav-profile"]')?.getAttribute("href") || "";
      const loginButton = document.querySelector('[data-e2e="top-login-button"]');
      return { handle: profileLink.replace(/^\//, ""), stillLoggedOut: Boolean(loginButton) };
    });
  } catch {
    return { handle: "", stillLoggedOut: true };
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║  LOGIN DA CONTA DE MINERAÇÃO — Studio / JARVIS              ║
╚══════════════════════════════════════════════════════════════╝

Conta esperada: ${MINING_ACCOUNT}

Esta sessão é usada SÓ para pesquisar vídeos e minerar ganchos.
Nada é publicado por ela. A conta que publica (@sodre.luxe) não
entra neste fluxo e continua fora da raspagem.

Vou abrir uma janela do Chrome. VOCÊ faz o login com as suas
mãos — eu não digito nem leio sua senha. Quando terminar e a
sua timeline estiver na tela, volte aqui e aperte ENTER.
`);

  const executablePath = findSystemChrome();
  if (executablePath) {
    console.log(`Usando o Chrome instalado na máquina: ${executablePath}\n`);
  } else {
    console.log("Chrome do sistema não encontrado — usando o Chromium do puppeteer.\n");
  }

  const { browser, page } = await createHumanBrowser({ headless: false, executablePath });

  try {
    await page.goto("https://www.tiktok.com/login", { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {
      console.log("A navegação inicial demorou, mas a janela deve estar aberta mesmo assim.");
    });

    await waitForEnter("Aperte ENTER depois de concluir o login no TikTok... ");

    const { handle, stillLoggedOut } = await detectLoggedAccount(page);

    if (stillLoggedOut) {
      console.log("\n⚠️  O TikTok ainda mostra o botão de entrar — o login não foi concluído.");
      console.log("    Nada foi salvo. Rode o comando de novo quando estiver logado.\n");
      return;
    }

    const account = handle || MINING_ACCOUNT;
    const { path, cookieCount } = await saveSession(page, account);

    console.log(`\n✅ Sessão salva: ${cookieCount} cookies da conta ${account}`);
    console.log(`   Arquivo: ${path}`);
    console.log("   Fica fora do Git (studio-data/ está no .gitignore).");
    console.log("\n   Trate esse arquivo como senha: quem tiver ele entra na conta.\n");
  } finally {
    await browser.close().catch(() => {});
  }
}

if (process.argv[2] === "--status") {
  const status = sessionStatus();
  console.log(status.present ? JSON.stringify(status, null, 2) : `Nenhuma sessão salva em ${sessionPath()}`);
} else {
  main().catch((error) => {
    console.error(`Falhou: ${error.message}`);
    process.exit(1);
  });
}
