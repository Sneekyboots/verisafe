/**
 * Verisafe API Type Definitions
 */

// ─────────────────────────────────────────────────────────────────────────
// Health & Status
// ─────────────────────────────────────────────────────────────────────────

export interface HealthResponse {
  status: "ok" | "degraded";
  chain: {
    id: number;
    block: number;
  };
  oracle: {
    price: string;
    fresh: boolean;
    age: string;
    zkVerified: boolean;
  } | { error: string };
  circuits: {
    wasm: boolean;
    zkey: boolean;
  };
  contracts: {
    oracleV1: string;
    oracleV2: string;
    vaultFactory: string;
    creditNFT: string;
    liquidationEngine: string;
  };
  ts: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Oracle Prices
// ─────────────────────────────────────────────────────────────────────────

export interface PriceResponse {
  price: number;
  priceRaw: string;
  priceUSD: string;
  timestamp: number;
  age: number;
  commitment: string;
}

export interface ProofResponse {
  proof: string;
  input: string[];
}

// ─────────────────────────────────────────────────────────────────────────
// Vault Operations
// ─────────────────────────────────────────────────────────────────────────

export interface VaultState {
  owner: string;
  collateral: string;
  debt: string;
  lastUpdate: number;
}

export interface CreateVaultRequest {
  owner: string;
  collateralAmount: string;
}

export interface CreateVaultResponse {
  vaultId: string;
  tx: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Client Helper
// ─────────────────────────────────────────────────────────────────────────

export default class VerisafeClient {
  private baseUrl: string;
  private adminKey?: string;

  constructor(baseUrl = "https://stakra-backend.onrender.com", adminKey?: string) {
    this.baseUrl = baseUrl;
    this.adminKey = adminKey;
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: any,
    adminOnly = false
  ): Promise<T> {
    const headers: HeadersInit = { "Content-Type": "application/json" };

    if (adminOnly || body) {
      if (!this.adminKey) throw new Error("Admin key required");
      headers["x-admin-key"] = this.adminKey;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        `API Error: ${response.status} - ${JSON.stringify(data)}`
      );
    }

    return data as T;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Public Methods
  // ─────────────────────────────────────────────────────────────────────

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/health");
  }

  async getPrice(): Promise<PriceResponse> {
    return this.request<PriceResponse>("GET", "/oracle/price");
  }

  async getProof(): Promise<ProofResponse> {
    return this.request<ProofResponse>("GET", "/oracle/proof");
  }

  async getVault(vaultId: string): Promise<VaultState> {
    return this.request<VaultState>("GET", `/vault/${vaultId}`);
  }

  async createVault(request: CreateVaultRequest): Promise<CreateVaultResponse> {
    return this.request<CreateVaultResponse>(
      "POST",
      "/vault",
      request,
      false
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // Admin Methods
  // ─────────────────────────────────────────────────────────────────────

  async submitPrice(price: number): Promise<{ tx: string }> {
    return this.request<{ tx: string }>(
      "POST",
      "/admin/oracle/submit",
      { price },
      true
    );
  }

  async submitProof(proof: string, input: string[]): Promise<{ tx: string }> {
    return this.request<{ tx: string }>(
      "POST",
      "/admin/oracle/verify",
      { proof, input },
      true
    );
  }
}
