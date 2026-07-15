import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { Client } from "ssh2";

function execViaSSH(host, username, command, { privateKeyPath, password }) {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on("ready", () => {
      conn.exec(command, (error, stream) => {
        if (error) {
          conn.end();
          return reject(error);
        }

        let stdout = "";
        let stderr = "";

        stream
          .on("data", (data) => {
            stdout += data.toString();
          })
          .on("close", (exitCode) => {
            conn.end();
            resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
          });

        stream.stderr.on("data", (data) => {
          stderr += data.toString();
        });
      });
    });

    conn.on("error", (error) => reject(error));

    const connectConfig = { host, username, readyTimeout: 15_000 };
    if (privateKeyPath) {
      connectConfig.privateKey = readFileSync(privateKeyPath);
    } else if (password) {
      connectConfig.password = password;
    } else {
      return reject(new Error("privateKeyPath ou password é obrigatório para os='linux'."));
    }

    conn.connect(connectConfig);
  });
}

function execViaWinRM(host, username, password, command) {
  return new Promise((resolve) => {
    const escapedPassword = password.replace(/"/g, '`"');
    const escapedCommand = command.replace(/"/g, '`"');

    const script = `$securePassword = ConvertTo-SecureString "${escapedPassword}" -AsPlainText -Force
$cred = New-Object System.Management.Automation.PSCredential("${username}", $securePassword)
Invoke-Command -ComputerName "${host}" -Credential $cred -ScriptBlock { ${escapedCommand} }`;

    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => (stdout += data.toString()));
    child.stderr.on("data", (data) => (stderr += data.toString()));
    child.on("close", (code) => resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code }));
    child.on("error", (error) => resolve({ stdout: "", stderr: error.message, exitCode: -1 }));
  });
}

export async function remoteExecute({ host, os, command, username, privateKeyPath, password }) {
  if (os === "windows" && !password) {
    throw new Error("password é obrigatório para os='windows' (usado no PSCredential do WinRM).");
  }
  if (os === "linux" && !privateKeyPath && !password) {
    throw new Error("privateKeyPath ou password é obrigatório para os='linux'.");
  }

  return os === "linux"
    ? await execViaSSH(host, username, command, { privateKeyPath, password })
    : await execViaWinRM(host, username, password, command);
}
