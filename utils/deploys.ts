import { Signer } from "ethers";

import {
  BatchPurchaseFacilitator,
  EntropyCallbackMock,
  EntropyMock,
  ETHRejectingContract,
  FisherYatesWithRejectionTester,
  GuaranteedMinimumPayoutCalculator,
  Jackpot,
  JackpotAutoSubscription,
  JackpotBridgeManager,
  JackpotLPManager,
  JackpotTicketNFT,
  AllowedManagerMock,
  BuyTicketsHelpersTester,
  JackpotRandomTicketBuyer,
  MockDepository,
  MockJackpot,
  MockTicketArt,
  ReentrantUSDCMock,
  ScaledEntropyProvider,
  ScaledEntropyProviderMock,
  TicketAutoCompoundVault,
  TicketComboTrackerTester,
  TicketNFTArt,
  TicketPickerTester,
  UintCastsTester,
  USDCMock,
} from "./contracts";

import {
  BatchPurchaseFacilitator__factory,
  GuaranteedMinimumPayoutCalculator__factory,
  Jackpot__factory,
  JackpotAutoSubscription__factory,
  JackpotBridgeManager__factory,
  JackpotLPManager__factory,
  JackpotTicketNFT__factory,
  JackpotRandomTicketBuyer__factory,
  ScaledEntropyProvider__factory,
  TicketAutoCompoundVault__factory,
} from "../typechain-types/factories/contracts";

import { TicketNFTArt__factory } from "../typechain-types/factories/contracts/nftArt";
import {FisherYatesRejection__factory } from "../typechain-types/factories/contracts/lib/FisherYatesWithRejection.sol";

import {
  EntropyCallbackMock__factory,
  EntropyMock__factory,
  ETHRejectingContract__factory,
  FisherYatesWithRejectionTester__factory,
  AllowedManagerMock__factory,
  BuyTicketsHelpersTester__factory,
  MockDepository__factory,
  MockJackpot__factory,
  MockTicketArt__factory,
  ReentrantUSDCMock__factory,
  ScaledEntropyProviderMock__factory,
  TicketComboTrackerTester__factory,
  TicketPickerTester__factory,
  UintCastsTester__factory,
  USDCMock__factory,
} from "../typechain-types/factories/contracts/mocks";
import { Address } from "./types";

export default class DeployHelper {
    private _deployerSigner: Signer;
  
    constructor(deployerSigner: Signer) {
      this._deployerSigner = deployerSigner;
    }
  
    public async deployUSDCMock(mintAmount: bigint, name: string, symbol: string): Promise<USDCMock> {
      return await new USDCMock__factory(this._deployerSigner).deploy(mintAmount, name, symbol);
    }

    public async deployReentrantUSDCMock(mintAmount: bigint, name: string, symbol: string): Promise<ReentrantUSDCMock> {
      return await new ReentrantUSDCMock__factory(this._deployerSigner).deploy(mintAmount, name, symbol);
    }

    public async deployScaledEntropyProviderMock(
      fee: bigint,
      callback: string,
      selector: string
    ): Promise<ScaledEntropyProviderMock> {
      return await new ScaledEntropyProviderMock__factory(this._deployerSigner).deploy(fee, callback, selector);
    }

    public async deployJackpot(
        drawingDurationInSeconds: bigint,
        normalBallMax: bigint,
        bonusballMin: bigint,
        bonusballSoftCap: bigint,
        bonusballHardCap: bigint,
        lpEdgeTarget: bigint,
        reserveRatio: bigint,
        referralFeeBps: bigint,
        referralWinShareBps: bigint,
        ticketPrice: bigint,
        maxReferrers: bigint,
        entropyBaseGasLimit: bigint
    ): Promise<Jackpot> {
      return await new Jackpot__factory(this._deployerSigner).deploy(
        drawingDurationInSeconds,
        normalBallMax,
        bonusballMin,
        bonusballSoftCap,
        bonusballHardCap,
        lpEdgeTarget,
        reserveRatio,
        referralFeeBps,
        referralWinShareBps,
        ticketPrice,
        maxReferrers,
        entropyBaseGasLimit
      );
    }

    public async deployJackpotLPManager(jackpot: Address): Promise<JackpotLPManager> {
      return await new JackpotLPManager__factory(this._deployerSigner).deploy(jackpot);
    }

    public async deployJackpotTicketNFT(jackpot: Address, ticketArt: Address): Promise<JackpotTicketNFT> {
      return await new JackpotTicketNFT__factory(this._deployerSigner).deploy(jackpot, ticketArt);
    }

    public async deployJackpotBridgeManager(
      jackpot: Address,
      jackpotTicketNFT: Address,
      usdc: Address,
      relayDepository: Address,
      name: string,
      version: string
    ): Promise<JackpotBridgeManager> {
      return await new JackpotBridgeManager__factory(this._deployerSigner).deploy(
        jackpot,
        jackpotTicketNFT,
        usdc,
        relayDepository,
        name,
        version
      );
    }

    public async deployJackpotAutoSubscription(
      jackpot: Address,
      usdc: Address,
      batchPurchaseFacilitator: Address
    ): Promise<JackpotAutoSubscription> {
      const fisherYatesLibrary = await new FisherYatesRejection__factory(this._deployerSigner).deploy();
      return await new JackpotAutoSubscription__factory(
        {
          "contracts/lib/FisherYatesWithRejection.sol:FisherYatesRejection": await fisherYatesLibrary.getAddress()
        },
        this._deployerSigner
      ).deploy(jackpot, usdc, batchPurchaseFacilitator);
    }

    public async deployGuaranteedMinimumPayoutCalculator(
      jackpot: Address,
      minimumPayout: bigint,
      premiumTierMinAllocation: bigint,
      minPayoutTiers: boolean[],
      premiumTierWeights: bigint[]
    ): Promise<GuaranteedMinimumPayoutCalculator> {
      return await new GuaranteedMinimumPayoutCalculator__factory(this._deployerSigner).deploy(
        jackpot,
        minimumPayout,
        premiumTierMinAllocation,
        minPayoutTiers,
        premiumTierWeights
      );
    }

    public async deployMockDepository(usdc: Address): Promise<MockDepository> {
      return await new MockDepository__factory(this._deployerSigner).deploy(usdc);
    }

    public async deployFisherYatesWithRejectionTester(): Promise<FisherYatesWithRejectionTester> {
      // Deploy the library first
      const fisherYatesLibrary = await new FisherYatesRejection__factory(this._deployerSigner).deploy();
      
      return await new FisherYatesWithRejectionTester__factory(
        {
          "contracts/lib/FisherYatesWithRejection.sol:FisherYatesRejection": await fisherYatesLibrary.getAddress()
        },
        this._deployerSigner
      ).deploy();
    }

    public async deployEntropyMock(fee: bigint): Promise<EntropyMock> {
      return await new EntropyMock__factory(this._deployerSigner).deploy(fee);
    }

    public async deployEntropyCallbackMock(): Promise<EntropyCallbackMock> {
      return await new EntropyCallbackMock__factory(this._deployerSigner).deploy();
    }

    public async deployTicketComboTrackerTester(): Promise<TicketComboTrackerTester> {
      return await new TicketComboTrackerTester__factory(this._deployerSigner).deploy();
    }

    public async deployUintCastsTester(): Promise<UintCastsTester> {
      return await new UintCastsTester__factory(this._deployerSigner).deploy();
    }

    public async deployScaledEntropyProvider(
      entropyAddress: string,
      entropyProviderAddress: string
    ): Promise<ScaledEntropyProvider> {
      // Deploy the library first
      const fisherYatesLibrary = await new FisherYatesRejection__factory(this._deployerSigner).deploy();
      
      return await new ScaledEntropyProvider__factory(
        {
          "contracts/lib/FisherYatesWithRejection.sol:FisherYatesRejection": await fisherYatesLibrary.getAddress()
        },
        this._deployerSigner
      ).deploy(entropyAddress, entropyProviderAddress);
    }

    public async deployMockJackpot(): Promise<MockJackpot> {
      return await new MockJackpot__factory(this._deployerSigner).deploy();
    }

    public async deployETHRejectingContract(): Promise<ETHRejectingContract> {
      return await new ETHRejectingContract__factory(this._deployerSigner).deploy();
    }

  public async deployTicketPickerTester(): Promise<TicketPickerTester> {
      const fisherYatesLibrary = await new FisherYatesRejection__factory(this._deployerSigner).deploy();
      return await new TicketPickerTester__factory(
        {
          "contracts/lib/FisherYatesWithRejection.sol:FisherYatesRejection": await fisherYatesLibrary.getAddress()
        },
        this._deployerSigner
      ).deploy();
    }

    public async deployAllowedManagerMock(): Promise<AllowedManagerMock> {
      return await new AllowedManagerMock__factory(this._deployerSigner).deploy();
    }

    public async deployBatchPurchaseFacilitator(jackpot: Address, usdc: Address, minimumTicketCount: bigint): Promise<BatchPurchaseFacilitator> {
      const fisherYatesLibrary = await new FisherYatesRejection__factory(this._deployerSigner).deploy();
      return await new BatchPurchaseFacilitator__factory(
        {
          "contracts/lib/FisherYatesWithRejection.sol:FisherYatesRejection": await fisherYatesLibrary.getAddress()
        },
        this._deployerSigner
      ).deploy(jackpot, usdc, minimumTicketCount);
    }

    public async deployBuyTicketsHelpersTester(): Promise<BuyTicketsHelpersTester> {
      return await new BuyTicketsHelpersTester__factory(this._deployerSigner).deploy();
    }

  public async deployJackpotRandomTicketBuyer(
    jackpot: Address,
    usdc: Address
  ): Promise<JackpotRandomTicketBuyer> {
    const fisherYatesLibrary = await new FisherYatesRejection__factory(this._deployerSigner).deploy();
    return await new JackpotRandomTicketBuyer__factory(
      {
        "contracts/lib/FisherYatesWithRejection.sol:FisherYatesRejection": await fisherYatesLibrary.getAddress()
      },
      this._deployerSigner
    ).deploy(
      jackpot,
      usdc
    );
  }

  public async deployTicketNFTArt(jackpot: Address): Promise<TicketNFTArt> {
    return await new TicketNFTArt__factory(this._deployerSigner).deploy(jackpot);
  }

  public async deployMockTicketArt(): Promise<MockTicketArt> {
    return await new MockTicketArt__factory(this._deployerSigner).deploy();
  }

  public async deployTicketAutoCompoundVault(
    jackpot: Address,
    jackpotNFT: Address,
    usdc: Address,
    batchPurchaseFacilitator: Address
  ): Promise<TicketAutoCompoundVault> {
    const fisherYatesLibrary = await new FisherYatesRejection__factory(this._deployerSigner).deploy();
    return await new TicketAutoCompoundVault__factory(
      {
        "contracts/lib/FisherYatesWithRejection.sol:FisherYatesRejection": await fisherYatesLibrary.getAddress()
      },
      this._deployerSigner
    ).deploy(jackpot, jackpotNFT, usdc, batchPurchaseFacilitator);
  }
}
