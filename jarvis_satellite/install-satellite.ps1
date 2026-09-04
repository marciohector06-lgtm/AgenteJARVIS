<#
.SYNOPSIS
  Instala o jarvis_satellite num PC Windows (ex: PC de consultório) e
  configura pra subir sozinho no boot, sem precisar logar no Windows.

.DESCRIPTION
  Equivalente Windows do install.sh (que é pra Linux/Raspberry Pi). Instala
  Node.js e Tailscale via winget, clona o monorepo do jarvis, instala as
  dependências, configura o .env se ainda não existir, e sobe o satélite via
  PM2 com "pm2-windows-startup" (que é o gap que o Linux "pm2 startup" não
  cobre no Windows).

.PARAMETER RepoUrl
  URL do repositório git do monorepo jarvis (contém jarvis_satellite e
  jarvis_shared).

.PARAMETER InstallPath
  Pasta onde o monorepo será clonado.

.PARAMETER TailscaleAuthKey
  Authkey do Tailscale (gerada em login.tailscale.com/admin/settings/keys,
  ou via tailscale_manager_tool no cérebro). Sem isso, "tailscale up" precisa
  de login interativo no navegador — não dá pra automatizar 100%.

.EXAMPLE
  .\install-satellite.ps1 -TailscaleAuthKey "tskey-auth-xxxxx"
#>

param(
  [string]$RepoUrl = "https://github.com/marciohector06-lgtm/AgenteJARVIS.git",
  [string]$InstallPath = "C:\jarvis",
  [string]$TailscaleAuthKey = ""
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Test-CommandExists($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

if (-not (Test-CommandExists "winget")) {
  Write-Error "winget não encontrado. Instale o 'App Installer' pela Microsoft Store antes de continuar."
  exit 1
}

Write-Step "Instalando Node.js LTS (silencioso)..."
if (-not (Test-CommandExists "node")) {
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
} else {
  Write-Host "Node.js já instalado, pulando."
}

Write-Step "Instalando Git (silencioso)..."
if (-not (Test-CommandExists "git")) {
  winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
} else {
  Write-Host "Git já instalado, pulando."
}

Write-Step "Instalando Tailscale (silencioso)..."
if (-not (Test-CommandExists "tailscale")) {
  winget install --id tailscale.tailscale -e --silent --accept-package-agreements --accept-source-agreements
  Start-Sleep -Seconds 5
} else {
  Write-Host "Tailscale já instalado, pulando."
}

Write-Step "Autenticando no Tailscale..."
if ($TailscaleAuthKey) {
  tailscale up --authkey=$TailscaleAuthKey --hostname=$env:COMPUTERNAME --accept-routes
} else {
  Write-Warning "Nenhuma -TailscaleAuthKey informada — abrindo login interativo no navegador (não é totalmente silencioso)."
  tailscale up --hostname=$env:COMPUTERNAME --accept-routes
}

Write-Step "Clonando o repositório em $InstallPath..."
if (-not (Test-Path $InstallPath)) {
  git clone $RepoUrl $InstallPath
} else {
  Write-Host "Pasta $InstallPath já existe — rodando 'git pull' em vez de clonar."
  Push-Location $InstallPath
  git pull
  Pop-Location
}

$satellitePath = Join-Path $InstallPath "jarvis_satellite"
$sharedPath = Join-Path $InstallPath "jarvis_shared"

Write-Step "Instalando dependências (jarvis_shared)..."
Push-Location $sharedPath
npm install --omit=dev
Pop-Location

Write-Step "Instalando dependências (jarvis_satellite)..."
Push-Location $satellitePath
npm install --omit=dev

$envPath = Join-Path $satellitePath ".env"
$envExamplePath = Join-Path $satellitePath ".env.example"

if (-not (Test-Path $envPath)) {
  Write-Step "Nenhum .env encontrado — copiando .env.example. EDITE antes de continuar."
  Copy-Item $envExamplePath $envPath
  Write-Host ""
  Write-Host "Edite $envPath com:" -ForegroundColor Yellow
  Write-Host "  - SATELLITE_ID, SATELLITE_NAME, SATELLITE_LOCATION"
  Write-Host "  - SATELLITE_TOKEN (openssl rand -hex 24, ou gere um GUID)"
  Write-Host "  - SATELLITE_HOST (IP Tailscale 100.x.x.x deste PC + porta)"
  Write-Host "  - BRAIN_URL (URL Tailscale do cérebro)"
  Write-Host "  - SATELLITE_REGISTRATION_SECRET (idêntico ao do cérebro)"
  Write-Host ""
  Write-Host "Depois rode este script de novo pra continuar (Node/Tailscale/PM2 não serão reinstalados)."
  Pop-Location
  exit 0
}

Write-Step "Instalando PM2 e pm2-windows-startup globalmente..."
if (-not (Test-CommandExists "pm2")) {
  npm install -g pm2
}
npm install -g pm2-windows-startup

Write-Step "Subindo o satélite via PM2..."
pm2 start src/index.js --name "jarvis-satellite" --cwd $satellitePath
pm2 save

Write-Step "Configurando PM2 pra iniciar sozinho no boot do Windows (pm2-windows-startup)..."
pm2-startup install
pm2 save

Pop-Location

Write-Host ""
Write-Host "==> Pronto. Verifique com: pm2 logs jarvis-satellite" -ForegroundColor Green
