import { wagmiConnectors } from "./wagmiConnectors";
import { Chain, createClient, fallback, http } from "viem";
import { hardhat, mainnet } from "viem/chains";
import { createConfig } from "wagmi";
import scaffoldConfig, { DEFAULT_ALCHEMY_API_KEY, ScaffoldConfig } from "~~/scaffold.config";
import { getAlchemyHttpUrl } from "~~/utils/scaffold-eth";

const { targetNetworks } = scaffoldConfig;

// We always want to have mainnet enabled (ENS resolution, ETH price, etc). But only once.
export const enabledChains = targetNetworks.find((network: Chain) => network.id === 1)
  ? targetNetworks
  : ([...targetNetworks, mainnet] as const);

export const wagmiConfig = createConfig({
  chains: enabledChains,
  connectors: wagmiConnectors(),
  ssr: true,
  client: ({ chain }) => {
    // Start with Alchemy endpoint (preferred) — no bare http() fallback
    const rpcOverrideUrl = (scaffoldConfig.rpcOverrides as ScaffoldConfig["rpcOverrides"])?.[chain.id];

    let rpcFallbacks: ReturnType<typeof http>[] = [];

    if (rpcOverrideUrl) {
      rpcFallbacks = [http(rpcOverrideUrl)];
    } else {
      const alchemyHttpUrl = getAlchemyHttpUrl(chain.id);
      if (alchemyHttpUrl) {
        const isUsingDefaultKey = scaffoldConfig.alchemyApiKey === DEFAULT_ALCHEMY_API_KEY;
        if (isUsingDefaultKey) {
          // Default key: Alchemy is a lower-priority fallback; use BuidlGuidl RPC for mainnet
          if (chain.id === mainnet.id) {
            rpcFallbacks = [http("https://mainnet.rpc.buidlguidl.com"), http(alchemyHttpUrl)];
          } else {
            rpcFallbacks = [http(alchemyHttpUrl)];
          }
        } else {
          // Custom key: Alchemy first
          if (chain.id === mainnet.id) {
            rpcFallbacks = [http(alchemyHttpUrl), http("https://mainnet.rpc.buidlguidl.com")];
          } else {
            rpcFallbacks = [http(alchemyHttpUrl)];
          }
        }
      } else if (chain.id === mainnet.id) {
        rpcFallbacks = [http("https://mainnet.rpc.buidlguidl.com")];
      }
    }

    return createClient({
      chain,
      transport: fallback(rpcFallbacks),
      ...(chain.id !== (hardhat as Chain).id ? { pollingInterval: scaffoldConfig.pollingInterval } : {}),
    });
  },
});
