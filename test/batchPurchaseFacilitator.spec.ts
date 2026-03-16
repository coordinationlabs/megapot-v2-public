import {
  getWaffleExpect,
  getAccounts
} from "@utils/test/index";
import DeployHelper from "@utils/deploys";
import { ether, usdc } from "@utils/common"
import { Account } from "@utils/test";

import {
  BatchPurchaseFacilitator,
  GuaranteedMinimumPayoutCalculator,
  Jackpot,
  JackpotLPManager,
  JackpotTicketNFT,
  ScaledEntropyProviderMock,
  ReentrantUSDCMock
} from "@utils/contracts";
import { Address, BatchExecutionAction, JackpotSystemFixture, Ticket } from "@utils/types";
import { deployJackpotSystem } from "@utils/test/jackpotFixture";
import { ADDRESS_ZERO } from "@utils/constants";
import { takeSnapshot, SnapshotRestorer, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const expect = getWaffleExpect();

describe("BatchPurchaseFacilitator", () => {
  let owner: Account;
  let payer: Account;
  let buyerOne: Account;
  let buyerTwo: Account;
  let buyerThree: Account;
  let referrerOne: Account;
  let referrerTwo: Account;
  let referrerThree: Account;
  let keeper: Account;
  let keeperTwo: Account;

  let jackpotSystem: JackpotSystemFixture;
  let jackpot: Jackpot;
  let jackpotNFT: JackpotTicketNFT;
  let jackpotLPManager: JackpotLPManager;
  let payoutCalculator: GuaranteedMinimumPayoutCalculator;
  let usdcMock: ReentrantUSDCMock;
  let entropyProvider: ScaledEntropyProviderMock;
  let snapshot: SnapshotRestorer;
  let batchPurchaseFacilitator: BatchPurchaseFacilitator;

  let deployer: DeployHelper;

  beforeEach(async () => {
    [
      owner,
      payer,
      buyerOne,
      buyerTwo,
      buyerThree,
      referrerOne,
      referrerTwo,
      referrerThree,
      keeper,
      keeperTwo,
    ] = await getAccounts();
    deployer = new DeployHelper(owner.wallet);

    jackpotSystem = await deployJackpotSystem();
    jackpot = jackpotSystem.jackpot;
    jackpotNFT = jackpotSystem.jackpotNFT;
    jackpotLPManager = jackpotSystem.jackpotLPManager;
    payoutCalculator = jackpotSystem.payoutCalculator;
    usdcMock = jackpotSystem.usdcMock;
    entropyProvider = jackpotSystem.entropyProvider;

    await usdcMock.connect(owner.wallet).transfer(payer.address, usdc(1000000));
  
    await jackpot.connect(owner.wallet).initialize(
        usdcMock.getAddress(),
        await jackpotLPManager.getAddress(),
        await jackpotNFT.getAddress(),
        entropyProvider.getAddress(),
        await payoutCalculator.getAddress(),
        owner.address,
        jackpotSystem.deploymentParams.protocolFee,
        jackpotSystem.deploymentParams.protocolFeeThreshold
    );

    await jackpot.connect(owner.wallet).initializeLPDeposits(usdc(10000000));

    await usdcMock.connect(owner.wallet).approve(jackpot.getAddress(), usdc(1000000));
    await jackpot.connect(owner.wallet).lpDeposit(usdc(1000000));

    batchPurchaseFacilitator = await jackpotSystem.deployer.deployBatchPurchaseFacilitator(
      await jackpot.getAddress(),
      await usdcMock.getAddress(),
      BigInt(2)
    );

    await batchPurchaseFacilitator.connect(owner.wallet).addAllowed(keeper.address);

    snapshot = await takeSnapshot();
  });

  beforeEach(async () => {
    await snapshot.restore();
  });

  describe("#constructor", () => {
    let subjectMinimumTicketCount: bigint;

    beforeEach(async () => {
      subjectMinimumTicketCount = BigInt(2);
    });

    async function subject(): Promise<any> {
      return await deployer.deployBatchPurchaseFacilitator(
        await jackpot.getAddress(),
        await usdcMock.getAddress(),
        subjectMinimumTicketCount
      );
    }

    it("should set the jackpot address correctly", async () => {
      const batchPurchaseFacilitator = await subject();
      expect(await batchPurchaseFacilitator.jackpot()).to.equal(await jackpot.getAddress());
    });

    it("should set the usdc address correctly", async () => {
      const batchPurchaseFacilitator = await subject();
      expect(await batchPurchaseFacilitator.usdc()).to.equal(await usdcMock.getAddress());
    });

    it("should set the minimum ticket count correctly", async () => {
      const batchPurchaseFacilitator = await subject();
      expect(await batchPurchaseFacilitator.minimumTicketCount()).to.equal(BigInt(2));
    });

    describe("when the minimum ticket count is zero", () => {
      beforeEach(async () => {
        subjectMinimumTicketCount = BigInt(0);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "InvalidMinimumTicketCount");
      });
    });
  });

  describe("#createBatchOrder", () => {
    let subjectRecipient: Address;
    let subjectDynamicTicketCount: bigint;
    let subjectStaticTickets: Ticket[];
    let subjectReferrers: Address[];
    let subjectReferralSplits: bigint[];
    let subjectCaller: Account;

    let isInitialized: boolean = true;

    beforeEach(async () => {
      if (isInitialized) {
        await jackpot.connect(owner.wallet).initializeJackpot(BigInt(await time.latest()) + BigInt(jackpotSystem.deploymentParams.drawingDurationInSeconds));
      }

      subjectRecipient = buyerOne.address;
      subjectDynamicTicketCount = BigInt(1);
      subjectStaticTickets = [
        { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], bonusball: BigInt(1) },
      ];
      subjectReferrers = [referrerOne.address, referrerTwo.address, referrerThree.address];
      subjectReferralSplits = [ether(0.3), ether(0.4), ether(0.3)];
      subjectCaller = payer;

      await usdcMock.connect(payer.wallet).approve(batchPurchaseFacilitator.getAddress(), usdc(2));
    });

    async function subject(): Promise<any> {
      return await batchPurchaseFacilitator.connect(subjectCaller.wallet).createBatchOrder(
        subjectRecipient,
        subjectDynamicTicketCount,
        subjectStaticTickets,
        subjectReferrers,
        subjectReferralSplits
      );
    }

    it("should create a batch order successfully", async () => {
      await subject();

      const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(subjectRecipient);
      expect(batchOrder.batchOrder.orderDrawingId).to.equal(await jackpot.currentDrawingId());
      expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(2));
      expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(2));
      expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(2));
      expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(subjectDynamicTicketCount);
      expect(batchOrder.batchOrder.referrers).to.deep.equal(subjectReferrers);
      expect(batchOrder.batchOrder.referralSplit).to.deep.equal(subjectReferralSplits);
      expect(batchOrder.staticTickets.length).to.equal(subjectStaticTickets.length);
      expect(batchOrder.staticTickets[0].normals).to.deep.equal(subjectStaticTickets[0].normals);
      expect(batchOrder.staticTickets[0].bonusball).to.equal(subjectStaticTickets[0].bonusball);
    });

    it("should transfer the total cost from the payer to the contract", async () => {
      const prePayerBalance = await usdcMock.balanceOf(payer.address);
      const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
      
      await subject();

      const postPayerBalance = await usdcMock.balanceOf(payer.address);
      const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());

      expect(postPayerBalance).to.equal(prePayerBalance - usdc(2));
      expect(postContractBalance).to.equal(preContractBalance + usdc(2));
    });

    it("should emit the BatchOrderCreated event correctly", async () => {
      await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderCreated").withArgs(
        subjectCaller.address,
        subjectRecipient,
        await jackpot.currentDrawingId(),
        usdc(2),
        subjectDynamicTicketCount,
        subjectStaticTickets.length
      );
    });

    describe("when the jackpot is locked", () => {
      beforeEach(async () => {
        await jackpot.connect(owner.wallet).lockJackpot();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "JackpotLocked");
      });
    });

    describe("when the referrer count is greater than the current global max referrer count", () => {
      beforeEach(async () => {
        await jackpot.connect(owner.wallet).setMaxReferrers(1);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "TooManyReferrers");
      });
    });

    describe("when the recipient already has an active subscription", () => {
      beforeEach(async () => {
        await subject();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ActiveBatchOrderExists");
      });
    });

    describe("when the recipient is the zero address  ", () => {
      beforeEach(async () => {
        subjectRecipient = ADDRESS_ZERO;
      });

      it("should revert with the ZeroAddress error", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ZeroAddress");
      });
    });

    describe("when the total ticket count is less than the minimum ticket count", () => {
      beforeEach(async () => {
        subjectDynamicTicketCount = BigInt(0);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "InvalidTicketCount");
      });
    });

    describe("when a static ticket has an invalid normal ball count", () => {
      beforeEach(async () => {
        subjectStaticTickets = [
          { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5), BigInt(6)], bonusball: BigInt(1) },
        ];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "InvalidNormalBallCount");
      });
    });

    describe("when a static ticket has a normal ball that is zero", () => {
      beforeEach(async () => {
        subjectStaticTickets = [
          { normals: [BigInt(0), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], bonusball: BigInt(1) },
        ];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "InvalidStaticTicket");
      });
    });

    describe("when a static ticket has a normal ball that is greater than the normal ball max", () => {
      beforeEach(async () => {
        subjectStaticTickets = [
          { 
            normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(31)],
            bonusball: BigInt(1)
          } as Ticket,
        ];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "InvalidStaticTicket");
      });
    });

    describe("when a static ticket has a duplicate normal ball", () => {
      beforeEach(async () => {
        subjectStaticTickets = [
          { 
            normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(3), BigInt(5)],
            bonusball: BigInt(1)
          } as Ticket,
        ];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "RepeatedNormalBall");
      });
    });

    describe("when a static ticket has a zero bonusball", () => {
      beforeEach(async () => {
        subjectStaticTickets = [
          { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], bonusball: BigInt(0) },
        ];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "InvalidStaticTicket");
      });
    });

    describe("when a static ticket has a bonusball that is greater than the bonusball max", () => {
      beforeEach(async () => {
        subjectStaticTickets = [
          { 
            normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)],
            bonusball: (await jackpot.getDrawingState(1)).bonusballMax + BigInt(1)
          } as Ticket,
        ];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "InvalidStaticTicket");
      });
    });

    describe("when the referral split sum is not equal to PRECISE_UNIT", () => {
      beforeEach(async () => {
        subjectReferralSplits = [ether(0.1), ether(0.2), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ReferralSplitSumInvalid");
      });
    });

    describe("when the referral split is greater than PRECISE_UNIT", () => {
      beforeEach(async () => {
        subjectReferralSplits = [ether(0.31), ether(0.4), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ReferralSplitSumInvalid");
      });
    });

    describe("when the referrer count does not match the referral split count", () => {
      beforeEach(async () => {
        subjectReferrers = [referrerOne.address, referrerTwo.address];
        subjectReferralSplits = [ether(0.3), ether(0.4), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ReferralSplitLengthMismatch");
      });
    });

    describe("when the referrer is the zero address", () => {
      beforeEach(async () => {
        subjectReferrers = [ADDRESS_ZERO, referrerTwo.address, referrerThree.address];
        subjectReferralSplits = [ether(0.3), ether(0.4), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ZeroAddress");
      });
    });

    describe("when the referral split is zero", () => {
      beforeEach(async () => {
        subjectReferralSplits = [ether(0), ether(0.4), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "InvalidReferralSplitBps");
      });
    });

    describe("when the jackpot is not initialized (drawingId is 0)", () => {
      before(async () => {
        isInitialized = false;
      });

      after(async () => {
        isInitialized = true;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "JackpotNotInitialized");
      });
    });

    describe("when the reentrancy protection is violated", async () => {
      beforeEach(async () => {
        await usdcMock.setCallbackTarget(await batchPurchaseFacilitator.getAddress());
        const callbackData = batchPurchaseFacilitator.interface.encodeFunctionData(
          "createBatchOrder",
          [
            subjectRecipient,
            subjectDynamicTicketCount,
            subjectStaticTickets,
            subjectReferrers,
            subjectReferralSplits
          ]
        );
        await usdcMock.setCallbackData(callbackData);
        await usdcMock.enableCallback();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ReentrancyGuardReentrantCall");
      });
    });
  });

  context("when the jackpot is initialized", () => {
    beforeEach(async () => {
      await jackpot.connect(owner.wallet).initializeJackpot(BigInt(await time.latest()) + BigInt(jackpotSystem.deploymentParams.drawingDurationInSeconds));
    });

    describe("#cancelBatchOrder", () => {
      let totalCost: bigint;

      let subjectCaller: Account;

      beforeEach(async () => {
        const staticTickets = [
          { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], bonusball: BigInt(1) },
        ];

        totalCost = usdc(2);

        await usdcMock.connect(payer.wallet).approve(batchPurchaseFacilitator.getAddress(), totalCost);
        await batchPurchaseFacilitator.connect(payer.wallet).createBatchOrder(
          buyerOne.address,
          BigInt(1),
          staticTickets,
          [],
          []
        );

        subjectCaller = buyerOne;
      });

      async function subject(): Promise<any> {
        return await batchPurchaseFacilitator.connect(subjectCaller.wallet).cancelBatchOrder();
      }

      it("should cancel the batch order successfully", async () => {
        await subject();

        const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerOne.address);
        expect(batchOrder.batchOrder.remainingUSDC).to.equal(BigInt(0));
        expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(0));
        expect(batchOrder.staticTickets.length).to.equal(0);
      });

      it("should refund the total cost to the recipient", async () => {
        const preRecipientBalance = await usdcMock.balanceOf(buyerOne.address);
        const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());

        await subject();

        const postRecipientBalance = await usdcMock.balanceOf(buyerOne.address);
        const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());

        expect(postRecipientBalance).to.equal(preRecipientBalance + totalCost);
        expect(postContractBalance).to.equal(preContractBalance - totalCost);
      });

      it("should emit the BatchOrderCancelled event correctly", async () => {
        await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderCancelled").withArgs(
          buyerOne.address,
          BatchExecutionAction.CANCEL_USER_REQUESTED,
          totalCost
        );
      });

      it("should emit the BatchOrderRemoved event correctly", async () => {
        await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderRemoved").withArgs(
          buyerOne.address
        );
      });

      describe("when the recipient does not have an active batch order", () => {
        beforeEach(async () => {
          subjectCaller = payer;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "NoActiveBatchOrder");
        });
      });

      describe("when the reentrancy protection is violated", async () => {
        beforeEach(async () => {
          await usdcMock.setCallbackTarget(await batchPurchaseFacilitator.getAddress());
          const callbackData = batchPurchaseFacilitator.interface.encodeFunctionData(
            "cancelBatchOrder",
            []
          );
          await usdcMock.setCallbackData(callbackData);
          await usdcMock.enableCallback();
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ReentrancyGuardReentrantCall");
        });
      });
    });

    describe("#executeBatchOrder", () => {
      let totalCost: bigint;

      let subjectRecipient: Address;
      let subjectMaxTicketsPerBatch: bigint;
      let subjectCaller: Account;

      beforeEach(async () => {
        const staticTickets = [
          { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)], bonusball: BigInt(9) },
          { normals: [BigInt(5), BigInt(6), BigInt(7), BigInt(8), BigInt(9)], bonusball: BigInt(9) },
        ];

        totalCost = usdc(4);

        await usdcMock.connect(payer.wallet).approve(batchPurchaseFacilitator.getAddress(), totalCost);
        await batchPurchaseFacilitator.connect(payer.wallet).createBatchOrder(
          buyerOne.address,
          BigInt(2),
          staticTickets,
          [referrerOne.address, referrerTwo.address, referrerThree.address],
          [ether(0.3), ether(0.4), ether(0.3)]
        );

        subjectRecipient = buyerOne.address;
        subjectMaxTicketsPerBatch = BigInt(1);
        subjectCaller = keeper;
      });

      async function subject(): Promise<any> {
        return await batchPurchaseFacilitator.connect(subjectCaller.wallet).executeBatchOrder(
          subjectRecipient,
          subjectMaxTicketsPerBatch
        );
      }

      it("should correctly update the batch order state", async () => {
        await subject();

        const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerOne.address);

        expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(3));
        expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(3));
        expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(4));
        expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(2));
      });

      it("should correctly transfer the total cost to the jackpot", async () => {
        const preJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
        const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
        await subject();
        const postJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
        const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());

        expect(postJackpotBalance).to.equal(preJackpotBalance + usdc(1));
        expect(postContractBalance).to.equal(preContractBalance - usdc(1));
      });

      it("should emit the BatchOrderExecuted event correctly", async () => {
        const tx = await subject();

        const ticketIds = await jackpotNFT.getUserTickets(buyerOne.address, 1);
        await expect(tx).to.emit(batchPurchaseFacilitator, "BatchOrderExecuted").withArgs(
          buyerOne.address,
          await jackpot.currentDrawingId(),
          ticketIds.map((ticket) => ticket.ticketId),
          BigInt(1),
          BigInt(3),
          usdc(3)
        );
      });

      describe("when the execution action is EXECUTE_FINAL", () => {
        beforeEach(async () => {
          subjectMaxTicketsPerBatch = BigInt(4);
        });

        it("should correctly delete the batch order state", async () => {
          await subject();

          const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerOne.address);
          expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(0));
          expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(0));
        });

        it("should correctly transfer the total cost to the jackpot", async () => {
          const preJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
          const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
          await subject();
          const postJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
          const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
  
          expect(postJackpotBalance).to.equal(preJackpotBalance + usdc(4));
          expect(postContractBalance).to.equal(preContractBalance - usdc(4));
        });

        it("should emit the BatchOrderExecuted event correctly", async () => {
          const tx = await subject();
          const ticketIds = await jackpotNFT.getUserTickets(buyerOne.address, 1);
          await expect(tx).to.emit(batchPurchaseFacilitator, "BatchOrderExecuted").withArgs(
            buyerOne.address,
            await jackpot.currentDrawingId(),
            ticketIds.map((ticket) => ticket.ticketId),
            BigInt(4),
            BigInt(0),
            usdc(0)
          );
        });

        it("should emit the BatchOrderRemoved event correctly", async () => {
          await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderRemoved").withArgs(buyerOne.address);
        });
      });

      describe("when the max tickets per batch is greater than the remaining tickets", () => {
        beforeEach(async () => {
          subjectMaxTicketsPerBatch = BigInt(5);
        });

        it("should correctly delete the batch order state", async () => {
          await subject();

          const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerOne.address);
          expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(0));
          expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(0));
        });

        it("should correctly transfer the total cost to the jackpot", async () => {
          const preJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
          const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
          await subject();
          const postJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
          const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
  
          expect(postJackpotBalance).to.equal(preJackpotBalance + usdc(4));
          expect(postContractBalance).to.equal(preContractBalance - usdc(4));
        });

        it("should emit the BatchOrderExecuted event correctly", async () => {
          const tx = await subject();
          const ticketIds = await jackpotNFT.getUserTickets(buyerOne.address, 1);
          await expect(tx).to.emit(batchPurchaseFacilitator, "BatchOrderExecuted").withArgs(
            buyerOne.address,
            await jackpot.currentDrawingId(),
            ticketIds.map((ticket) => ticket.ticketId),
            BigInt(4),
            BigInt(0),
            usdc(0)
          );
        });

        it("should emit the BatchOrderRemoved event correctly", async () => {
          await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderRemoved").withArgs(buyerOne.address);
        });
      });

      describe("when it's a second execution and only static tickets should be executed", () => {
        beforeEach(async () => {
          await subject();
        });

        it("should correctly delete the batch order state", async () => {
          await subject();

          const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerOne.address);
          expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(2));
          expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(2));
          expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(4));
          expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(2));
        });

        it("should correctly transfer the total cost to the jackpot", async () => {
          const preJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
          const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
          await subject();
          const postJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
          const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
  
          expect(postJackpotBalance).to.equal(preJackpotBalance + usdc(1));
          expect(postContractBalance).to.equal(preContractBalance - usdc(1));
        });

        it("should emit the BatchOrderExecuted event correctly", async () => {
          const tx = await subject();
          const ticketIds = (await jackpotNFT.getUserTickets(buyerOne.address, 1)).slice(1, 2);
          await expect(tx).to.emit(batchPurchaseFacilitator, "BatchOrderExecuted").withArgs(
            buyerOne.address,
            await jackpot.currentDrawingId(),
            ticketIds.map((ticket) => ticket.ticketId),
            BigInt(1),
            BigInt(2),
            usdc(2)
          );
        });
      });

      describe("when it's a second execution and only dynamic tickets should be executed", () => {
        beforeEach(async () => {
          subjectMaxTicketsPerBatch = BigInt(2);
          await subject();
        });

        it("should correctly delete the batch order state", async () => {
          await subject();

          const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerOne.address);
          expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(0));
          expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(0));
        });

        it("should correctly transfer the total cost to the jackpot", async () => {
          const preJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
          const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
          await subject();
          const postJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
          const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
  
          expect(postJackpotBalance).to.equal(preJackpotBalance + usdc(2));
          expect(postContractBalance).to.equal(preContractBalance - usdc(2));
        });

        it("should emit the BatchOrderExecuted event correctly", async () => {
          const tx = await subject();
          const ticketIds = (await jackpotNFT.getUserTickets(buyerOne.address, 1)).slice(2,4);
          await expect(tx).to.emit(batchPurchaseFacilitator, "BatchOrderExecuted").withArgs(
            buyerOne.address,
            await jackpot.currentDrawingId(),
            ticketIds.map((ticket) => ticket.ticketId),
            BigInt(2),
            BigInt(0),
            usdc(0)
          );
        });
      });

      describe("when some of the dynamic tickets have been executed before", () => {
        beforeEach(async () => {
          subjectMaxTicketsPerBatch = BigInt(3);
          await subject();
        });

        it("should correctly delete the batch order state", async () => {
          await subject();

          const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerOne.address);
          expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(0));
          expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(0));
        });

        it("should correctly transfer the total cost to the jackpot", async () => {
          const preJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
          const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
          await subject();
          const postJackpotBalance = await usdcMock.balanceOf(jackpot.getAddress());
          const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
  
          expect(postJackpotBalance).to.equal(preJackpotBalance + usdc(1));
          expect(postContractBalance).to.equal(preContractBalance - usdc(1));
        });

        it("should emit the BatchOrderExecuted event correctly", async () => {
          const tx = await subject();
          const ticketIds = (await jackpotNFT.getUserTickets(buyerOne.address, 1)).slice(3,4);
          await expect(tx).to.emit(batchPurchaseFacilitator, "BatchOrderExecuted").withArgs(
            buyerOne.address,
            await jackpot.currentDrawingId(),
            ticketIds.map((ticket) => ticket.ticketId),
            BigInt(1),
            BigInt(0),
            usdc(0)
          );
        });
      });

      describe("when the execution action is CANCEL_DRAWING_LOCKED", () => {
        beforeEach(async () => {
          await jackpot.connect(owner.wallet).lockJackpot();
        });

        it("should correctly delete the batch order state", async () => {
          await subject();

          const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerOne.address);
          expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(0));
          expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(0));
        });

        it("should correctly transfer the total cost to the recipient", async () => {
          const preRecipientBalance = await usdcMock.balanceOf(buyerOne.address);
          const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
          await subject();
          const postRecipientBalance = await usdcMock.balanceOf(buyerOne.address);
          const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());

          expect(postRecipientBalance).to.equal(preRecipientBalance + usdc(4));
          expect(postContractBalance).to.equal(preContractBalance - usdc(4));
        });

        it("should emit the BatchOrderCancelled event correctly", async () => {
          await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderCancelled").withArgs(
            buyerOne.address,
            BatchExecutionAction.CANCEL_DRAWING_LOCKED,
            usdc(4)
          );
        });

        it("should emit the BatchOrderRemoved event correctly", async () => {
          await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderRemoved").withArgs(buyerOne.address);
        });
      });

      describe("when the execution action is CANCEL_WRONG_DRAWING", () => {
        beforeEach(async () => {
          await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));
          const drawingState = await jackpot.getDrawingState(1);
          await jackpot.connect(owner.wallet).runJackpot(
            { value: jackpotSystem.deploymentParams.entropyFee + ((jackpotSystem.deploymentParams.entropyBaseGasLimit + jackpotSystem.deploymentParams.entropyVariableGasLimit * drawingState.bonusballMax) * BigInt(1e7)) }
          );
          await entropyProvider.connect(owner.wallet).randomnessCallback([[BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], [BigInt(2)]]);
        });

        it("should correctly delete the batch order state", async () => {
          await subject();

          const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerOne.address);
          expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(0));
          expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(0));
        });

        it("should correctly transfer the total cost to the recipient", async () => {
          const preRecipientBalance = await usdcMock.balanceOf(buyerOne.address);
          const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
          await subject();
          const postRecipientBalance = await usdcMock.balanceOf(buyerOne.address);
          const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());

          expect(postRecipientBalance).to.equal(preRecipientBalance + usdc(4));
          expect(postContractBalance).to.equal(preContractBalance - usdc(4));
        });

        it("should emit the BatchOrderCancelled event correctly", async () => {
          await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderCancelled").withArgs(
            buyerOne.address,
            BatchExecutionAction.CANCEL_WRONG_DRAWING,
            usdc(4)
          );
        });

        it("should emit the BatchOrderRemoved event correctly", async () => {
          await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderRemoved").withArgs(buyerOne.address);
        });
      });

      describe("when the execution action is CANCEL_TOO_MANY_REFERRERS", () => {
        beforeEach(async () => {
          await jackpot.connect(owner.wallet).setMaxReferrers(1);
        });

        it("should correctly delete the batch order state", async () => {
          await subject();

          const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerOne.address);
          expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(0));
          expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(0));
          expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(0));
        });

        it("should correctly transfer the total cost to the recipient", async () => {
          const preRecipientBalance = await usdcMock.balanceOf(buyerOne.address);
          const preContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());
          await subject();
          const postRecipientBalance = await usdcMock.balanceOf(buyerOne.address);
          const postContractBalance = await usdcMock.balanceOf(batchPurchaseFacilitator.getAddress());

          expect(postRecipientBalance).to.equal(preRecipientBalance + usdc(4));
          expect(postContractBalance).to.equal(preContractBalance - usdc(4));
        });

        it("should emit the BatchOrderCancelled event correctly", async () => {
          await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderCancelled").withArgs(
            buyerOne.address,
            BatchExecutionAction.CANCEL_TOO_MANY_REFERRERS,
            usdc(4)
          );
        });

        it("should emit the BatchOrderRemoved event correctly", async () => {
          await expect(subject()).to.emit(batchPurchaseFacilitator, "BatchOrderRemoved").withArgs(buyerOne.address);
        });
      });

      describe("when the caller is not the keeper", () => {
        beforeEach(async () => {
          subjectCaller = buyerOne;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "NotAllowed");
        });
      });

      describe("when the recipient does not have an active batch order", () => {
        beforeEach(async () => {
          subjectRecipient = buyerTwo.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "NoActiveBatchOrder");
        });
      });

      describe("when the reentrancy protection is violated", async () => {
        beforeEach(async () => {
          await usdcMock.setCallbackTarget(await batchPurchaseFacilitator.getAddress());
          const callbackData = batchPurchaseFacilitator.interface.encodeFunctionData(
            "executeBatchOrder",
            [subjectRecipient, subjectMaxTicketsPerBatch]
          );
          await usdcMock.setCallbackData(callbackData);
          await usdcMock.enableCallback();
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ReentrancyGuardReentrantCall");
        });
      });
    });

    describe("#getBatchOrderActions", () => {
      let subjectRecipients: Address[];
      let subjectMaxTicketsPerBatch: bigint;

      beforeEach(async () => {
        const staticTickets = [
          { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)], bonusball: BigInt(9) },
          { normals: [BigInt(5), BigInt(6), BigInt(7), BigInt(8), BigInt(9)], bonusball: BigInt(9) },
        ];

        const totalCost = usdc(8);

        await usdcMock.connect(payer.wallet).approve(batchPurchaseFacilitator.getAddress(), totalCost);
        await batchPurchaseFacilitator.connect(payer.wallet).createBatchOrder(
          buyerOne.address,
          BigInt(2),
          staticTickets,
          [referrerOne.address, referrerTwo.address, referrerThree.address],
          [ether(0.3), ether(0.4), ether(0.3)]
        );

        await batchPurchaseFacilitator.connect(payer.wallet).createBatchOrder(
          buyerTwo.address,
          BigInt(4),
          [],
          [],
          []
        );

        subjectRecipients = [buyerOne.address, buyerTwo.address];
        subjectMaxTicketsPerBatch = BigInt(1);
      });

      async function subject(): Promise<any> {
        return await batchPurchaseFacilitator.getBatchOrderActions(subjectRecipients, subjectMaxTicketsPerBatch);
      }

      it("should return the correct execution actions", async () => {
        const actions = await subject();
        expect(actions).to.deep.equal([BatchExecutionAction.EXECUTE_PARTIAL, BatchExecutionAction.EXECUTE_PARTIAL]);
      });

      describe("when the recipients have different execution actions", () => {
        beforeEach(async () => {
          await batchPurchaseFacilitator.connect(keeper.wallet).executeBatchOrder(buyerOne.address, BigInt(2));
          subjectMaxTicketsPerBatch = BigInt(2);
        });

        it("should return the correct execution actions", async () => {
          const actions = await subject();
          expect(actions).to.deep.equal([BatchExecutionAction.EXECUTE_FINAL, BatchExecutionAction.EXECUTE_PARTIAL]);
        });
      });

      describe("when max referrers is exceeded", () => {
        beforeEach(async () => {
          await jackpot.connect(owner.wallet).setMaxReferrers(1);
        });

        it("should return the correct execution actions", async () => {
          const actions = await subject();
          expect(actions).to.deep.equal([BatchExecutionAction.CANCEL_TOO_MANY_REFERRERS, BatchExecutionAction.EXECUTE_PARTIAL]);
        });
      });

      describe("when the drawing is locked", () => {
        beforeEach(async () => {
          await jackpot.connect(owner.wallet).lockJackpot();
        });

        it("should return the correct execution actions", async () => {
          const actions = await subject();
          expect(actions).to.deep.equal([BatchExecutionAction.CANCEL_DRAWING_LOCKED, BatchExecutionAction.CANCEL_DRAWING_LOCKED]);
        });
      });

      describe("when the recipient does not have an active batch order", () => {
        beforeEach(async () => {
          subjectRecipients = [buyerOne.address, buyerTwo.address, buyerThree.address];
        });

        it("should return the correct execution actions", async () => {
          const actions = await subject();
          expect(actions).to.deep.equal(
            [BatchExecutionAction.EXECUTE_PARTIAL, BatchExecutionAction.EXECUTE_PARTIAL, BatchExecutionAction.CANCEL_WRONG_DRAWING]
          );
        });
      });

      describe("when the drawing is not the current drawing", () => {
        beforeEach(async () => {
          await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));
          const drawingState = await jackpot.getDrawingState(1);
          await jackpot.connect(owner.wallet).runJackpot(
            { value: jackpotSystem.deploymentParams.entropyFee + ((jackpotSystem.deploymentParams.entropyBaseGasLimit + jackpotSystem.deploymentParams.entropyVariableGasLimit * drawingState.bonusballMax) * BigInt(1e7)) }
          );
          await entropyProvider.connect(owner.wallet).randomnessCallback([[BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], [BigInt(2)]]);
        });

        it("should return the correct execution actions", async () => {
          const actions = await subject();
          expect(actions).to.deep.equal([BatchExecutionAction.CANCEL_WRONG_DRAWING, BatchExecutionAction.CANCEL_WRONG_DRAWING]);
        });
      });
    });

    describe("#setMinimumTicketCount", () => {
      let subjectMinimumTicketCount: bigint;
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectMinimumTicketCount = BigInt(5);
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return await batchPurchaseFacilitator.connect(subjectCaller.wallet).setMinimumTicketCount(subjectMinimumTicketCount);
      }

      it("should set the minimum ticket count correctly", async () => {
        await subject();

        const newMinimumTicketCount = await batchPurchaseFacilitator.minimumTicketCount();
        expect(newMinimumTicketCount).to.equal(subjectMinimumTicketCount);
      });

      describe("when caller is not the owner", () => {
        beforeEach(async () => {
          subjectCaller = buyerOne;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "OwnableUnauthorizedAccount");
        });
      });
    });

    describe("#addAllowed", () => {
      let subjectAllowed: Address;
      let subjectCaller: Account;
  
      beforeEach(async () => {
        subjectAllowed = keeperTwo.address;
        subjectCaller = owner;
      });
  
      async function subject(): Promise<any> {
        return await batchPurchaseFacilitator.connect(subjectCaller.wallet).addAllowed(subjectAllowed);
      }
  
      it("should add the keeper correctly", async () => {
        await subject();
  
        const isAllowed = await batchPurchaseFacilitator.isAllowed(subjectAllowed);
        const keepers = await batchPurchaseFacilitator.getAllowed();
  
        expect(isAllowed).to.be.true;
        expect(keepers).to.contain(subjectAllowed);
      });
  
      it("should emit the AllowedAdded event correctly", async () => {
        await expect(subject()).to.emit(batchPurchaseFacilitator, "AllowedAdded").withArgs(subjectAllowed);
      });
  
      describe("when the keeper is already added", () => {
        beforeEach(async () => {
          subjectAllowed = keeper.address;
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "AllowedAlreadyAdded");
        });
      });
  
      describe("when the keeper is the zero address", () => {
        beforeEach(async () => {
          subjectAllowed = ADDRESS_ZERO;
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ZeroAddress");
        });
      });
  
      describe("when the caller is not the owner", () => {
        beforeEach(async () => {
          subjectCaller = payer;
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "OwnableUnauthorizedAccount");
        });
      });
    });
  
    describe("#removeAllowed", () => {
      let subjectAllowed: Address;
      let subjectCaller: Account;
  
      beforeEach(async () => {
        subjectAllowed = keeper.address;
        subjectCaller = owner;
      });
  
      async function subject(): Promise<any> {
        return await batchPurchaseFacilitator.connect(subjectCaller.wallet).removeAllowed(subjectAllowed);
      }
  
      it("should remove the keeper correctly", async () => {
        await subject();
  
        const isAllowed = await batchPurchaseFacilitator.isAllowed(subjectAllowed);
        const keepers = await batchPurchaseFacilitator.getAllowed();
  
        expect(isAllowed).to.be.false;
        expect(keepers).to.not.contain(subjectAllowed);
      });
  
      it("should emit the AllowedRemoved event correctly", async () => {
        await expect(subject()).to.emit(batchPurchaseFacilitator, "AllowedRemoved").withArgs(subjectAllowed);
      });
  
      describe("when the keeper is already removed", () => {
        beforeEach(async () => {
          subjectAllowed = keeperTwo.address;
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "AllowedNotFound");
        });
      });
  
      describe("when the keeper is the zero address", () => {
        beforeEach(async () => {
          subjectAllowed = ADDRESS_ZERO;
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "ZeroAddress");
        });
      });
  
      describe("when the caller is not the owner", () => {
        beforeEach(async () => {
          subjectCaller = payer;
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(batchPurchaseFacilitator, "OwnableUnauthorizedAccount");
        });
      });
    });
  });
});