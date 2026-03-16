# MegaPot V2 Contracts

MegaPot V2 is a decentralized jackpot protocol where users purchase NFT-based jackpot tickets and liquidity providers fund prize pools. The system uses Pyth Network entropy for provably fair drawings, automatically distributes winnings based on number matches, and includes cross-chain bridge functionality.

## Prerequisites

- Node.js 20+
- Yarn package manager
- Git

## Installation

```bash
git clone git@github.com:coordinationlabs/megapot-v2-public.git
cd megapot-v2-public
yarn install
```

## Development Commands

### Compilation

```bash
# Clean and compile contracts
yarn build

# Compile only
yarn compile

# Clean artifacts and cache
yarn clean
```

### Testing

#### Basic Testing

```bash
# Run all tests
yarn test

# Run tests with fresh compilation
yarn test:clean

# Run tests without compilation (faster)
yarn test:fast
```
### Coverage

#### Full Coverage (Memory Intensive)

```bash
# Run coverage on all contracts (requires 4GB+ memory)
yarn coverage
```

#### Parallel Coverage (Recommended)

For better performance and memory management, run coverage on specific test groups:

```bash
# Library tests
yarn hardhat coverage --testfiles "test/lib/*.spec.ts"

# Core jackpot contract
yarn hardhat coverage --testfiles "test/jackpot.spec.ts"

# Ecosystem contracts (LP Manager, Bridge, NFT)
yarn hardhat coverage --testfiles "{test/jackpotBridgeManager.spec.ts,test/jackpotLPManager.spec.ts,test/jackpotTicketNFT.spec.ts}"

# Utility contracts (Payout Calculator, Entropy Provider)
yarn hardhat coverage --testfiles "{test/guaranteedMinimumPayoutCalculator.spec.ts,test/scaledEntropyProvider.spec.ts}"
```

#### Memory Considerations

For large coverage, you will need to increase Node.js memory:

```bash
NODE_OPTIONS="--max-old-space-size=6144" yarn coverage
```

#### Coverage Configuration

Coverage excludes interface and mock contracts (see `.solcover.js`). The configuration includes:
- Yul optimizer enabled for accurate gas reporting
- 2-minute timeout for complex test scenarios
- Optimized compiler settings for coverage runs

## Project Structure

```
contracts/
├── Jackpot.sol                 # Main jackpot contract
├── JackpotLPManager.sol        # Liquidity provider management
├── JackpotBridgeManager.sol    # Cross-chain bridge functionality
├── JackpotTicketNFT.sol        # Ticket NFT contract
├── GuaranteedMinimumPayoutCalculator.sol  # Prize calculations
├── ScaledEntropyProvider.sol   # Randomness provider
├── TicketAutoCompoundVault.sol # Auto-compound winnings vault
├── interfaces/                 # Contract interfaces
├── lib/                       # Utility libraries
└── mocks/                     # Test mock contracts

test/
├── jackpot.spec.ts            # Main contract tests
├── jackpotLPManager.spec.ts   # LP management tests
├── jackpotBridgeManager.spec.ts # Bridge functionality tests
└── lib/                       # Library tests

utils/
├── deploys.ts                 # Deployment helpers and scripts
├── protocolUtils.ts           # Utilities for interacting with the protocol
├── constants.ts               # Common constants (addresses, config)
├── contracts.ts               # Contract type imports
├── types.ts                   # Shared TypeScript types for protocol objects
├── common/                    # Utilities for blockchain interaction and units
└── test/                      # Fixtures and other utilities for test setup and tear down

```