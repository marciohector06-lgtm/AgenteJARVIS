import Docker from "dockerode";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { logger } from "../logger.js";
import { guardExecution } from "../security/guardExecution.js";

const docker = new Docker();

async function ensureImage(image) {
  try {
    await docker.getImage(image).inspect();
  } catch {
    logger.info(`docker_deploy_tool baixando imagem ausente: ${image}`);
    await new Promise((resolve, reject) => {
      docker.pull(image, (err, stream) => {
        if (err) return reject(err);
        docker.modem.followProgress(stream, (err2) => (err2 ? reject(err2) : resolve()));
      });
    });
  }
}

function summarizeContainer(container) {
  return {
    id: container.Id?.slice(0, 12),
    name: container.Names?.[0]?.replace(/^\//, "") || container.Name?.replace(/^\//, ""),
    image: container.Image || container.Config?.Image,
    state: container.State?.Status || container.State,
    status: container.Status,
  };
}

async function listContainers() {
  const containers = await docker.listContainers({ all: true });
  return containers.map(summarizeContainer);
}

async function inspectContainer(containerName) {
  const container = docker.getContainer(containerName);
  const data = await container.inspect();
  return {
    id: data.Id?.slice(0, 12),
    name: data.Name?.replace(/^\//, ""),
    image: data.Config?.Image,
    state: data.State?.Status,
    startedAt: data.State?.StartedAt,
    ports: data.NetworkSettings?.Ports,
  };
}

async function startContainer(containerName) {
  const container = docker.getContainer(containerName);
  await container.start();
  return inspectContainer(containerName);
}

async function stopContainer(containerName) {
  const container = docker.getContainer(containerName);
  await container.stop();
  return inspectContainer(containerName);
}

function parsePortBindings(ports) {
  const exposedPorts = {};
  const portBindings = {};

  for (const mapping of ports || []) {
    const [hostPort, containerPort] = mapping.split(":");
    const key = `${containerPort}/tcp`;
    exposedPorts[key] = {};
    portBindings[key] = [{ HostPort: hostPort }];
  }

  return { exposedPorts, portBindings };
}

async function runContainer(image, containerName, ports) {
  await ensureImage(image);

  const { exposedPorts, portBindings } = parsePortBindings(ports);

  const container = await docker.createContainer({
    Image: image,
    name: containerName,
    ExposedPorts: exposedPorts,
    HostConfig: { PortBindings: portBindings },
  });

  await container.start();
  return inspectContainer(container.id);
}

export const dockerDeployTool = tool(
  async ({ action, containerName, image, ports }) => {
    try {
      if (action === "list") {
        const result = await listContainers();
        logger.info(`docker_deploy_tool action=list total=${result.length}`);
        return JSON.stringify(result);
      }

      if (action === "inspect") {
        if (!containerName) return "containerName é obrigatório para action='inspect'.";
        const result = await inspectContainer(containerName);
        logger.info(`docker_deploy_tool action=inspect containerName=${containerName}`);
        return JSON.stringify(result);
      }

      if (action === "start") {
        if (!containerName) return "containerName é obrigatório para action='start'.";
        return await guardExecution(`Iniciar contêiner Docker "${containerName}"`, { destructive: true }, async () => {
          const result = await startContainer(containerName);
          logger.info(`docker_deploy_tool action=start containerName=${containerName}`);
          return JSON.stringify(result);
        });
      }

      if (action === "stop") {
        if (!containerName) return "containerName é obrigatório para action='stop'.";
        return await guardExecution(`Parar contêiner Docker "${containerName}"`, { destructive: true }, async () => {
          const result = await stopContainer(containerName);
          logger.info(`docker_deploy_tool action=stop containerName=${containerName}`);
          return JSON.stringify(result);
        });
      }

      if (action === "run") {
        if (!image) return "image é obrigatório para action='run'.";
        return await guardExecution(
          `Subir novo contêiner Docker: image="${image}"${containerName ? `, name="${containerName}"` : ""}`,
          { destructive: true },
          async () => {
            const result = await runContainer(image, containerName, ports);
            logger.info(`docker_deploy_tool action=run image=${image} containerName=${containerName || "(auto)"}`);
            return JSON.stringify(result);
          }
        );
      }

      return `Ação "${action}" inválida. Use: list, inspect, start, stop, run.`;
    } catch (error) {
      logger.error(`docker_deploy_tool action=${action} erro=${error.message}`);
      return `Erro ao executar ação "${action}" no Docker: ${error.message}`;
    }
  },
  {
    name: "docker_deploy_tool",
    description:
      "Gerencia contêineres Docker locais via dockerode. Ações: 'list' (lista todos os contêineres), 'inspect' (detalhes de um contêiner), 'start'/'stop' (inicia/para um contêiner existente), 'run' (sobe um novo contêiner a partir de uma imagem, com mapeamento de portas opcional).",
    schema: z.object({
      action: z.enum(["list", "inspect", "start", "stop", "run"]).describe("Ação a executar"),
      containerName: z
        .string()
        .optional()
        .describe("Nome ou ID do contêiner, necessário para inspect/start/stop e opcional em run"),
      image: z.string().optional().describe("Imagem Docker, necessária apenas para action='run' (ex: nginx:latest)"),
      ports: z
        .array(z.string())
        .optional()
        .describe('Mapeamento de portas no formato "hostPort:containerPort", ex: ["8080:80"] (apenas em run)'),
    }),
  }
);
