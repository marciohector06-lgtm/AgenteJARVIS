export class JarvisBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "JarvisBlockedError";
    this.reason = reason;
  }
}

export class JarvisBackendError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "JarvisBackendError";
    this.status = status;
  }
}

export interface BackendClientOptions {
  baseUrl?: string;
  devicePin?: string;
  staticToken?: string;
  defaultTimeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://127.0.0.1:4000";
const DEFAULT_TIMEOUT_MS = 30_000;

export class JarvisBackendClient {
  private readonly baseUrl: string;
  private readonly devicePin: string;
  private readonly staticToken: string;
  private readonly defaultTimeoutMs: number;
  private cachedToken: string | null = null;

  constructor(options: BackendClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.devicePin = options.devicePin ?? "";
    this.staticToken = options.staticToken ?? "";
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (this.staticToken) this.cachedToken = this.staticToken;
  }

  private async mintToken(): Promise<string> {
    if (this.staticToken) return this.staticToken;

    if (!this.devicePin) {
      throw new JarvisBackendError(
        401,
        "Sem credencial: defina JARVIS_DEVICE_PIN (trocado por JWT em POST /auth/token) ou JARVIS_API_TOKEN com um JWT já emitido."
      );
    }

    const response = await fetch(`${this.baseUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ devicePin: this.devicePin }),
      signal: AbortSignal.timeout(this.defaultTimeoutMs),
    });

    if (!response.ok) {
      throw new JarvisBackendError(response.status, `Falha ao autenticar em /auth/token (HTTP ${response.status}).`);
    }

    const body = (await response.json()) as { token?: string };
    if (!body.token) throw new JarvisBackendError(500, "/auth/token respondeu sem o campo token.");

    this.cachedToken = body.token;
    return body.token;
  }

  private async getToken(): Promise<string> {
    if (this.cachedToken) return this.cachedToken;
    return this.mintToken();
  }

  async request<T = unknown>(
    path: string,
    init: RequestInit = {},
    options: { timeoutMs?: number; retryOnUnauthorized?: boolean } = {}
  ): Promise<T> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const retryOnUnauthorized = options.retryOnUnauthorized ?? true;
    const token = await this.getToken();

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new JarvisBackendError(
        503,
        `Não foi possível falar com o jarvis_backend em ${this.baseUrl}${path}: ${detail}. Confirme que o processo jarvis-server está no ar.`
      );
    }

    if (response.status === 401 && retryOnUnauthorized && !this.staticToken) {
      this.cachedToken = null;
      return this.request<T>(path, init, { timeoutMs, retryOnUnauthorized: false });
    }

    const rawBody = await response.text();
    let parsedBody: unknown = {};
    if (rawBody) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = { raw: rawBody };
      }
    }

    if (response.status === 409) {
      const blocked = parsedBody as { reason?: string };
      throw new JarvisBlockedError(blocked.reason ?? "Ação bloqueada pela camada de segurança do JARVIS.");
    }

    if (!response.ok) {
      const failure = parsedBody as { error?: string };
      throw new JarvisBackendError(response.status, failure.error ?? `HTTP ${response.status} em ${path}.`);
    }

    return parsedBody as T;
  }
}
