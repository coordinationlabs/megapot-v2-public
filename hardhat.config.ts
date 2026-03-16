import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import "hardhat-abigen";
import { HardhatUserConfig } from "hardhat/config";
import "tsconfig-paths/register";

const pkRaw = process.env.PRIVATE_KEY;
const pk = pkRaw ? (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) : undefined;

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200, // Low runs value for deployment size optimization
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  mocha: {
    timeout: 120000, // 2 minutes timeout for coverage runs
  },
  networks: {
    hardhat: {
      chainId: 31337,
      allowUnlimitedContractSize: true,
      blockGasLimit: 100000000,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      allowUnlimitedContractSize: true,
    },
    base_sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts: pk ? [pk] : [],
      chainId: 84532,
    },
    base: {
      url: process.env.MAINNET_RPC_URL || "https://mainnet.base.org",
      accounts: pk ? [pk] : [],
      chainId: 8453,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    customChains: [
      {
        network: "base_sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org"
        }
      }
    ]
  },
  abigen: {
    outDir: "abi",
    inDir: "contracts",
    includeContracts: ["GuaranteedMinimumPayoutCalculator", "Jackpot", "JackpotBridgeManager", "JackpotLPManager", "JackpotTicketNFT", "ScaledEntropyProvider"],
    excludeContracts: [],
    space: 2,
    autoCompile: true,
  },
};

export default config;
