import { ethers } from "hardhat";

import {
  getWaffleExpect,
  getAccounts
} from "@utils/test/index";
import { ether, usdc } from "@utils/common";
import { Account } from "@utils/test";

import {
  BatchPurchaseFacilitator,
  GuaranteedMinimumPayoutCalculator,
  Jackpot,
  JackpotLPManager,
  JackpotTicketNFT,
  ReentrantUSDCMock,
  ScaledEntropyProviderMock,
  TicketAutoCompoundVault,
} from "@utils/contracts";
import {
  Address,
  JackpotSystemFixture,
  Ticket,
} from "@utils/types";
import { deployJackpotSystem } from "@utils/test/jackpotFixture";
import { ADDRESS_ZERO, PRECISE_UNIT } from "@utils/constants";
import { takeSnapshot, SnapshotRestorer, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const expect = getWaffleExpect();

describe("TicketAutoCompoundVault", () => {
  // Accounts
  let owner: Account;
  let userOne: Account;
  let userTwo: Account;
  let userThree: Account;
  let referrerOne: Account;
  let referrerTwo: Account;
  let keeper: Account;

  // Contracts
  let jackpotSystem: JackpotSystemFixture;
  let jackpot: Jackpot;
  let jackpotNFT: JackpotTicketNFT;
  let jackpotLPManager: JackpotLPManager;
  let payoutCalculator: GuaranteedMinimumPayoutCalculator;
  let usdcMock: ReentrantUSDCMock;
  let entropyProvider: ScaledEntropyProviderMock;
  let ticketAutoCompoundVault: TicketAutoCompoundVault;
  let batchPurchaseFacilitator: BatchPurchaseFacilitator;

  let snapshot: SnapshotRestorer;

  // Test constants
  const MINIMUM_BATCH_TICKET_COUNT = BigInt(100);

  before(async () => {
    // Get accounts
    [
      owner,
      userOne,
      userTwo,
      userThree,
      referrerOne,
      referrerTwo,
      keeper,
    ] = await getAccounts();

    // Deploy jackpot system using fixture
    jackpotSystem = await deployJackpotSystem();
    jackpot = jackpotSystem.jackpot;
    jackpotNFT = jackpotSystem.jackpotNFT;
    jackpotLPManager = jackpotSystem.jackpotLPManager;
    payoutCalculator = jackpotSystem.payoutCalculator;
    usdcMock = jackpotSystem.usdcMock;
    entropyProvider = jackpotSystem.entropyProvider;

    // Transfer USDC to test users
    await usdcMock.connect(owner.wallet).transfer(userOne.address, usdc(10000));
    await usdcMock.connect(owner.wallet).transfer(userTwo.address, usdc(10000));

    // Initialize jackpot
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

    // Initialize LP deposits and add liquidity
    await jackpot.connect(owner.wallet).initializeLPDeposits(usdc(10000000));
    await usdcMock.connect(owner.wallet).approve(jackpot.getAddress(), usdc(2000000));
    await jackpot.connect(owner.wallet).lpDeposit(usdc(2000000));

    // Deploy BatchPurchaseFacilitator
    batchPurchaseFacilitator = await jackpotSystem.deployer.deployBatchPurchaseFacilitator(
      await jackpot.getAddress(),
      await usdcMock.getAddress(),
      MINIMUM_BATCH_TICKET_COUNT
    );

    // Add keeper to batch facilitator
    await batchPurchaseFacilitator.connect(owner.wallet).addAllowed(keeper.address);

    // Deploy TicketAutoCompoundVault
    ticketAutoCompoundVault = await jackpotSystem.deployer.deployTicketAutoCompoundVault(
      await jackpot.getAddress(),
      await jackpotNFT.getAddress(),
      await usdcMock.getAddress(),
      await batchPurchaseFacilitator.getAddress()
    );

    // Set tier 1 (bonusball only) premium weight to 0, add it to tier 11 (jackpot)
    // This makes tier 1 payout only $1 minimum, which after 5% referralWinShare = $0.95 < $1 ticket
    const newWeights: [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] = [
      PRECISE_UNIT * BigInt(0) / BigInt(100),    // tier 0: 0%
      PRECISE_UNIT * BigInt(0) / BigInt(100),    // tier 1: 0% (was 17%)
      PRECISE_UNIT * BigInt(0) / BigInt(100),    // tier 2: 0%
      PRECISE_UNIT * BigInt(13) / BigInt(100),   // tier 3: 13%
      PRECISE_UNIT * BigInt(12) / BigInt(100),   // tier 4: 12%
      PRECISE_UNIT * BigInt(5) / BigInt(100),    // tier 5: 5%
      PRECISE_UNIT * BigInt(5) / BigInt(100),    // tier 6: 5%
      PRECISE_UNIT * BigInt(2) / BigInt(100),    // tier 7: 2%
      PRECISE_UNIT * BigInt(2) / BigInt(100),    // tier 8: 2%
      PRECISE_UNIT * BigInt(1) / BigInt(100),    // tier 9: 1%
      PRECISE_UNIT * BigInt(4) / BigInt(100),    // tier 10: 4%
      PRECISE_UNIT * BigInt(56) / BigInt(100),   // tier 11: 56% (was 39%, added 17%)
    ];
    await payoutCalculator.connect(owner.wallet).setPremiumTierWeights(newWeights);

    snapshot = await takeSnapshot();
  });

  beforeEach(async () => {
    await snapshot.restore();
  });

  describe("#constructor", () => {
    it("should set the jackpot address correctly", async () => {
      const actualJackpot = await ticketAutoCompoundVault.jackpot();
      expect(actualJackpot).to.equal(await jackpot.getAddress());
    });

    it("should set the jackpotNFT address correctly", async () => {
      const actualJackpotNFT = await ticketAutoCompoundVault.jackpotNFT();
      expect(actualJackpotNFT).to.equal(await jackpotNFT.getAddress());
    });

    it("should set the usdc address correctly", async () => {
      const actualUsdc = await ticketAutoCompoundVault.usdc();
      expect(actualUsdc).to.equal(await usdcMock.getAddress());
    });

    it("should set the batchFacilitator address correctly", async () => {
      const actualBatchFacilitator = await ticketAutoCompoundVault.batchFacilitator();
      expect(actualBatchFacilitator).to.equal(await batchPurchaseFacilitator.getAddress());
    });

    context("constructor validation", () => {
      let subjectJackpot: Address;
      let subjectJackpotNFT: Address;
      let subjectUsdc: Address;
      let subjectBatchFacilitator: Address;

      beforeEach(async () => {
        subjectJackpot = await jackpot.getAddress();
        subjectJackpotNFT = await jackpotNFT.getAddress();
        subjectUsdc = await usdcMock.getAddress();
        subjectBatchFacilitator = await batchPurchaseFacilitator.getAddress();
      });

      async function subject(): Promise<any> {
        return jackpotSystem.deployer.deployTicketAutoCompoundVault(
          subjectJackpot,
          subjectJackpotNFT,
          subjectUsdc,
          subjectBatchFacilitator
        );
      }

      describe("when jackpot is zero address", () => {
        beforeEach(async () => {
          subjectJackpot = ADDRESS_ZERO;
        });

        it("should revert with ZeroAddress", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpot, "ZeroAddress");
        });
      });

      describe("when jackpotNFT is zero address", () => {
        beforeEach(async () => {
          subjectJackpotNFT = ADDRESS_ZERO;
        });

        it("should revert with ZeroAddress", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpot, "ZeroAddress");
        });
      });

      describe("when usdc is zero address", () => {
        beforeEach(async () => {
          subjectUsdc = ADDRESS_ZERO;
        });

        it("should revert with ZeroAddress", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpot, "ZeroAddress");
        });
      });

      describe("when batchFacilitator is zero address", () => {
        beforeEach(async () => {
          subjectBatchFacilitator = ADDRESS_ZERO;
        });

        it("should revert with ZeroAddress", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpot, "ZeroAddress");
        });
      });
    });
  });

  context("when the jackpot is initialized", () => {
    beforeEach(async () => {
      // Initialize jackpot drawing
      await jackpot.connect(owner.wallet).initializeJackpot(
        BigInt(await time.latest()) + jackpotSystem.deploymentParams.drawingDurationInSeconds
      );
    });

    /**
     * Helper: Buy tickets that will win when we set the winning numbers
     */
    async function buyTickets(
      buyer: Account,
      ticketCount: number,
      winningNormals: bigint[],
      winningBonusball: bigint
    ): Promise<bigint[]> {
      const tickets: Ticket[] = [];
      for (let i = 0; i < ticketCount; i++) {
        tickets.push({
          normals: winningNormals,
          bonusball: winningBonusball
        });
      }

      await usdcMock.connect(buyer.wallet).approve(
        jackpot.getAddress(),
        usdc(ticketCount)
      );

      const ticketIds = await jackpot.connect(buyer.wallet).buyTickets.staticCall(
        tickets,
        buyer.address,
        [],
        [],
        ethers.encodeBytes32String("test")
      );

      await jackpot.connect(buyer.wallet).buyTickets(
        tickets,
        buyer.address,
        [],
        [],
        ethers.encodeBytes32String("test")
      );

      // Spread into new array to avoid ethers read-only Result object
      return [...ticketIds];
    }

    /**
     * Helper: Complete a drawing with specific winning numbers
     */
    async function completeDrawingWithWinners(
      winningNormals: bigint[],
      winningBonusball: bigint
    ): Promise<void> {
      // Advance time past drawing
      await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));

      // Get drawing state for entropy calculation
      const drawingId = await jackpot.currentDrawingId();
      const drawingState = await jackpot.getDrawingState(drawingId);

      // Run jackpot
      await jackpot.connect(owner.wallet).runJackpot({
        value: jackpotSystem.deploymentParams.entropyFee +
          ((jackpotSystem.deploymentParams.entropyFee + BigInt(500000) * drawingState.bonusballMax) * BigInt(1e7))
      });

      // Provide randomness callback with winning numbers
      await entropyProvider.connect(owner.wallet).randomnessCallback([
        winningNormals,
        [winningBonusball]
      ]);
    }

    /**
     * Helper: Calculate expected values for a compound operation
     */
    async function getCompoundExpectations(ticketIds: bigint[]) {
      const tierIds = await jackpot.getTicketTierIds(ticketIds);
      const referralWinShare = jackpotSystem.deploymentParams.referralWinShare;

      // Sum payouts across all tickets (may have different tiers)
      let usdcClaimed = BigInt(0);
      for (let i = 0; i < ticketIds.length; i++) {
        const ticketInfo = await jackpotNFT.getTicketInfo(ticketIds[i]);
        const tierPayouts = await jackpot.getDrawingTierPayouts(ticketInfo.drawingId);
        const tierPayout = tierPayouts[Number(tierIds[i])];
        usdcClaimed += tierPayout - (tierPayout * referralWinShare / PRECISE_UNIT);
      }

      const drawingState = await jackpot.getDrawingState(await jackpot.currentDrawingId());
      const ticketPrice = drawingState.ticketPrice;

      const ticketsToBuy = usdcClaimed / ticketPrice;
      const usdcSpent = ticketsToBuy * ticketPrice;
      const usdcRemaining = usdcClaimed - usdcSpent;
      const useBatchPurchase = ticketsToBuy >= MINIMUM_BATCH_TICKET_COUNT;

      return {
        usdcClaimed,
        ticketPrice,
        ticketsToBuy,
        usdcSpent,
        usdcRemaining,
        useBatchPurchase
      };
    }

    describe("#depositAndCompound", () => {
      let subjectTicketIds: bigint[];
      let subjectReferrers: Address[];
      let subjectReferralSplit: bigint[];
      let subjectCaller: Account;
      let losingTicketId: bigint;

      // Winning numbers for testing (can be overridden in nested describes via before())
      const winningNormals = [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)];
      const winningBonusball = BigInt(6);
      const losingNormals = [BigInt(10), BigInt(11), BigInt(12), BigInt(13), BigInt(14)];
      const losingBonusball = BigInt(1);
      let ticketNormals = winningNormals;

      beforeEach(async () => {
        // Buy tickets with ticketNormals (may differ from winningNormals for partial match tests)
        subjectTicketIds = await buyTickets(userOne, 1, ticketNormals, winningBonusball);

        // Buy a ticket for userTwo in the same drawing (for ownership tests)
        const userTwoNormals = [BigInt(20), BigInt(21), BigInt(22), BigInt(23), BigInt(24)];
        await buyTickets(userTwo, 1, userTwoNormals, winningBonusball);

        // Buy a losing ticket for userOne (for mixed winning/losing tests)
        const losingTicketIds = await buyTickets(userOne, 1, losingNormals, losingBonusball);
        losingTicketId = losingTicketIds[0];

        // Complete the drawing so tickets become claimable
        await completeDrawingWithWinners(winningNormals, winningBonusball);

        // Approve vault to transfer NFTs
        await jackpotNFT.connect(userOne.wallet).setApprovalForAll(
          await ticketAutoCompoundVault.getAddress(),
          true
        );

        subjectCaller = userOne;
        subjectReferrers = [];
        subjectReferralSplit = [];
      });


      async function subject(): Promise<any> {
        return await ticketAutoCompoundVault
          .connect(subjectCaller.wallet)
          .depositAndCompound(subjectTicketIds, subjectReferrers, subjectReferralSplit);
      }

      describe("when using no purchase path", () => {
        before(() => {
          // Use non-matching normals so ticket only matches bonusball (tier 1)
          // Tier 1 now pays $1 minimum, which after 5% referralWinShare = $0.95 < $1 ticket
          ticketNormals = [BigInt(10), BigInt(11), BigInt(12), BigInt(13), BigInt(14)];
        });

        after(() => {
          ticketNormals = winningNormals;
        });

        it("should emit Compounded with zero tickets bought", async () => {
          const expectations = await getCompoundExpectations(subjectTicketIds);

          // Verify this is actually no purchase path
          expect(expectations.ticketsToBuy).to.equal(BigInt(0), "Test setup should result in no purchase");
          expect(expectations.usdcClaimed).to.be.lessThan(expectations.ticketPrice);

          await expect(subject())
            .to.emit(ticketAutoCompoundVault, "Compounded")
            .withArgs(
              userOne.address,
              BigInt(subjectTicketIds.length),
              expectations.usdcClaimed,
              BigInt(0), // ticketsToBuy
              BigInt(0), // usdcSpent
              expectations.usdcClaimed, // all goes to pending
              false, // useBatchPurchase
              subjectReferrers,
              subjectReferralSplit
            );
        });

        it("should set userPendingUSDC to full claimed amount", async () => {
          const expectations = await getCompoundExpectations(subjectTicketIds);

          await subject();

          const pendingUSDC = await ticketAutoCompoundVault.getUserPendingUSDC(userOne.address);
          expect(pendingUSDC).to.equal(expectations.usdcClaimed);
        });

        it("should NOT increment ticketPickerNonce", async () => {
          const nonceBefore = await ticketAutoCompoundVault.ticketPickerNonce();

          await subject();

          const nonceAfter = await ticketAutoCompoundVault.ticketPickerNonce();
          expect(nonceAfter).to.equal(nonceBefore);
        });
      });

      describe("when using direct purchase path", () => {
        before(() => {
          // Use 1 matching normal + bonusball (tier 3) for small but purchasable payout
          ticketNormals = [BigInt(1), BigInt(11), BigInt(12), BigInt(13), BigInt(14)];
        });

        after(() => {
          ticketNormals = winningNormals;
        });

        it("should emit Compounded with correct parameters", async () => {
          const expectations = await getCompoundExpectations(subjectTicketIds);

          // Verify this is actually direct purchase path
          expect(expectations.useBatchPurchase).to.equal(false, "Test setup should result in direct purchase");

          await expect(subject())
            .to.emit(ticketAutoCompoundVault, "Compounded")
            .withArgs(
              userOne.address,
              BigInt(subjectTicketIds.length),
              expectations.usdcClaimed,
              expectations.ticketsToBuy,
              expectations.usdcSpent,
              expectations.usdcRemaining,
              expectations.useBatchPurchase,
              subjectReferrers,
              subjectReferralSplit
            );
        });

        it("should set userPendingUSDC to the remainder", async () => {
          const expectations = await getCompoundExpectations(subjectTicketIds);

          await subject();

          const actualPendingUSDC = await ticketAutoCompoundVault.getUserPendingUSDC(userOne.address);
          expect(actualPendingUSDC).to.equal(expectations.usdcRemaining);
        });

        it("should increment ticketPickerNonce", async () => {
          const nonceBefore = await ticketAutoCompoundVault.ticketPickerNonce();

          await subject();

          const nonceAfter = await ticketAutoCompoundVault.ticketPickerNonce();
          expect(nonceAfter).to.equal(nonceBefore + BigInt(1));
        });

        it("should mint new ticket NFTs to the user", async () => {
          const expectations = await getCompoundExpectations(subjectTicketIds);
          const balanceBefore = await jackpotNFT.balanceOf(userOne.address);

          await subject();

          const balanceAfter = await jackpotNFT.balanceOf(userOne.address);
          // User loses 1 ticket (compounded) but gains ticketsToBuy new tickets
          expect(balanceAfter).to.equal(balanceBefore - BigInt(1) + expectations.ticketsToBuy);
        });

        it("should hold the remainder USDC in the vault", async () => {
          const vaultBalanceBefore = await usdcMock.balanceOf(await ticketAutoCompoundVault.getAddress());

          await subject();

          const vaultBalanceAfter = await usdcMock.balanceOf(await ticketAutoCompoundVault.getAddress());
          const userPendingUSDC = await ticketAutoCompoundVault.getUserPendingUSDC(userOne.address);

          // Vault balance increase should equal the user's pending USDC
          expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(userPendingUSDC);
        });

        describe("when referrers are provided", () => {
          beforeEach(async () => {
            subjectReferrers = [referrerOne.address, referrerTwo.address];
            subjectReferralSplit = [PRECISE_UNIT / BigInt(2), PRECISE_UNIT / BigInt(2)];
          });

          it("should apply referrers to ticket purchase", async () => {
            await expect(subject())
              .to.emit(jackpot, "ReferralFeeCollected")
              .withArgs(referrerOne.address, (value: bigint) => value > BigInt(0));
          });
        });
      });

      describe("when using batch purchase path", () => {
        // Default setup uses jackpot-winning tickets (tier 0) which gives large payout

        it("should emit Compounded with correct parameters", async () => {
          const expectations = await getCompoundExpectations(subjectTicketIds);

          // Verify this is actually batch purchase path
          expect(expectations.useBatchPurchase).to.equal(true, "Test setup should result in batch purchase");

          await expect(subject())
            .to.emit(ticketAutoCompoundVault, "Compounded")
            .withArgs(
              userOne.address,
              BigInt(subjectTicketIds.length),
              expectations.usdcClaimed,
              expectations.ticketsToBuy,
              expectations.usdcSpent,
              expectations.usdcRemaining,
              expectations.useBatchPurchase,
              subjectReferrers,
              subjectReferralSplit
            );
        });

        it("should NOT increment ticketPickerNonce", async () => {
          const nonceBefore = await ticketAutoCompoundVault.ticketPickerNonce();

          await subject();

          const nonceAfter = await ticketAutoCompoundVault.ticketPickerNonce();
          expect(nonceAfter).to.equal(nonceBefore);
        });

        it("should create an active batch order for the user", async () => {
          expect(await batchPurchaseFacilitator.hasActiveBatchOrder(userOne.address)).to.equal(false);

          await subject();

          expect(await batchPurchaseFacilitator.hasActiveBatchOrder(userOne.address)).to.equal(true);
        });

        it("should create batch order with correct ticket count", async () => {
          const expectations = await getCompoundExpectations(subjectTicketIds);

          await subject();

          const batchOrderInfo = await batchPurchaseFacilitator.getBatchOrderInfo(userOne.address);
          expect(batchOrderInfo.batchOrder.remainingTickets).to.equal(expectations.ticketsToBuy);
        });

        it("should transfer USDC to the batch facilitator", async () => {
          const expectations = await getCompoundExpectations(subjectTicketIds);
          const facilitatorBalanceBefore = await usdcMock.balanceOf(await batchPurchaseFacilitator.getAddress());

          await subject();

          const facilitatorBalanceAfter = await usdcMock.balanceOf(await batchPurchaseFacilitator.getAddress());
          expect(facilitatorBalanceAfter - facilitatorBalanceBefore).to.equal(expectations.usdcSpent);
        });

        describe("when referrers are provided", () => {
          beforeEach(async () => {
            subjectReferrers = [referrerOne.address, referrerTwo.address];
            subjectReferralSplit = [PRECISE_UNIT / BigInt(2), PRECISE_UNIT / BigInt(2)];
          });

          it("should apply referrers to batch order", async () => {
            await subject();

            const batchOrderInfo = await batchPurchaseFacilitator.getBatchOrderInfo(userOne.address);
            expect(batchOrderInfo.batchOrder.referrers).to.deep.equal([referrerOne.address, referrerTwo.address]);
          });
        });
      });

      describe("when compounding multiple tickets with different tier payouts", () => {
        beforeEach(async () => {
          // Buy one jackpot-winning ticket (all normals + bonusball)
          const jackpotTicketIds = await buyTickets(userOne, 1, winningNormals, winningBonusball);

          // Buy one bonusball-only ticket (non-matching normals)
          const bonusballOnlyNormals = [BigInt(10), BigInt(11), BigInt(12), BigInt(13), BigInt(14)];
          const bonusballOnlyTicketIds = await buyTickets(userOne, 1, bonusballOnlyNormals, winningBonusball);

          // Complete the drawing
          await completeDrawingWithWinners(winningNormals, winningBonusball);

          // Compound both tickets together
          subjectTicketIds = [jackpotTicketIds[0], bonusballOnlyTicketIds[0]];
        });

        it("should set pending USDC to remainder from summed tier payouts", async () => {
          const expectations = await getCompoundExpectations(subjectTicketIds);

          await subject();

          const pendingUSDC = await ticketAutoCompoundVault.getUserPendingUSDC(userOne.address);
          expect(pendingUSDC).to.equal(expectations.usdcRemaining);
        });

        it("should create batch order with correct parameters", async () => {
          const expectations = await getCompoundExpectations(subjectTicketIds);
          const currentDrawingId = await jackpot.currentDrawingId();

          await subject();

          const batchOrderInfo = await batchPurchaseFacilitator.getBatchOrderInfo(userOne.address);
          expect(batchOrderInfo.batchOrder.orderDrawingId).to.equal(currentDrawingId);
          expect(batchOrderInfo.batchOrder.remainingTickets).to.equal(expectations.ticketsToBuy);
          expect(batchOrderInfo.batchOrder.totalTicketsOrdered).to.equal(expectations.ticketsToBuy);
          expect(batchOrderInfo.batchOrder.dynamicTicketCount).to.equal(expectations.ticketsToBuy);
          expect(batchOrderInfo.batchOrder.remainingUSDC).to.equal(expectations.usdcSpent);
          expect(batchOrderInfo.staticTickets.length).to.equal(0);
        });
      });

      describe("when a mix of winning and losing tickets is passed", () => {
        beforeEach(async () => {
          // Use the winning ticket from parent setup and the losing ticket
          subjectTicketIds = [subjectTicketIds[0], losingTicketId];
        });

        it("should succeed using only the winning ticket's payout", async () => {
          // Get expected payout from only the winning ticket
          const winningTicketIds = [subjectTicketIds[0]];
          const expectations = await getCompoundExpectations(winningTicketIds);

          await expect(subject())
            .to.emit(ticketAutoCompoundVault, "Compounded")
            .withArgs(
              userOne.address,
              BigInt(2), // Both tickets claimed
              expectations.usdcClaimed, // Only winning ticket contributes
              expectations.ticketsToBuy,
              expectations.usdcSpent,
              expectations.usdcRemaining,
              expectations.useBatchPurchase,
              subjectReferrers,
              subjectReferralSplit
            );
        });
      });

      describe("when user has pending USDC from previous compound", () => {
        let pendingUSDCAfterFirst: bigint;
        let secondTicketIds: bigint[];

        before(() => {
          // Use bonusball-only match for smaller payout (direct purchase path)
          ticketNormals = [BigInt(10), BigInt(11), BigInt(12), BigInt(13), BigInt(14)];
        });

        after(() => {
          ticketNormals = winningNormals;
        });

        beforeEach(async () => {
          // First compound leaves a remainder
          await ticketAutoCompoundVault.connect(userOne.wallet).depositAndCompound(subjectTicketIds, [], []);
          pendingUSDCAfterFirst = await ticketAutoCompoundVault.getUserPendingUSDC(userOne.address);

          // Buy more tickets for second compound
          secondTicketIds = await buyTickets(userOne, 1, ticketNormals, winningBonusball);
          await completeDrawingWithWinners(winningNormals, winningBonusball);

          subjectTicketIds = secondTicketIds;
        });

        it("should use accumulated pending USDC for ticket purchase", async () => {
          expect(pendingUSDCAfterFirst).to.be.greaterThan(BigInt(0));
          
          const expectations = await getCompoundExpectations(subjectTicketIds);
          const totalUSDC = expectations.usdcClaimed + pendingUSDCAfterFirst;
          const expectedTicketsToBuy = totalUSDC / expectations.ticketPrice;
          const expectedUsdcSpent = expectedTicketsToBuy * expectations.ticketPrice;
          const expectedRemaining = totalUSDC - expectedUsdcSpent;

          await subject();

          // Verify pending USDC updated correctly
          const finalPendingUSDC = await ticketAutoCompoundVault.getUserPendingUSDC(userOne.address);
          expect(finalPendingUSDC).to.equal(expectedRemaining);
        });
      });

      describe("when user already has active batch order", () => {
        beforeEach(async () => {
          // First compound creates a batch order
          await ticketAutoCompoundVault.connect(userOne.wallet).depositAndCompound(subjectTicketIds, [], []);

          // Buy more jackpot-winning tickets for second compound attempt
          subjectTicketIds = await buyTickets(userOne, 1, winningNormals, winningBonusball);
          await completeDrawingWithWinners(winningNormals, winningBonusball);
        });

        it("should revert with ActiveBatchOrderExists", async () => {
          await expect(subject()).to.be.revertedWithCustomError(
            ticketAutoCompoundVault,
            "ActiveBatchOrderExists"
          );
        });
      });

      describe("when ticket array is empty", () => {
        beforeEach(async () => {
          subjectTicketIds = [];
        });

        it("should revert with EmptyTicketArray", async () => {
          await expect(subject()).to.be.revertedWithCustomError(
            ticketAutoCompoundVault,
            "EmptyTicketArray"
          );
        });
      });

      describe("when ticket is not owned by caller but caller does have a ticket in the same drawing", () => {
        beforeEach(async () => {
          // userTwo tries to compound userOne's tickets
          subjectCaller = userTwo;

          // Approve vault for userTwo (but they don't own the tickets)
          await jackpotNFT.connect(userTwo.wallet).setApprovalForAll(
            await ticketAutoCompoundVault.getAddress(),
            true
          );
        });

        it("should revert with NotTicketOwner on jackpotNFT", async () => {
          await expect(subject()).to.be.revertedWithCustomError(
            jackpotNFT,
            "TransferFromIncorrectOwner"
          );
        });
      });

      describe("when ticket is not owned by caller and caller doesn't have a ticket in the drawing", () => {
        beforeEach(async () => {
          // userThree tries to compound userOne's tickets
          subjectCaller = userThree;

          // Approve vault for userThree (but they don't own the tickets)
          await jackpotNFT.connect(userThree.wallet).setApprovalForAll(
            await ticketAutoCompoundVault.getAddress(),
            true
          );
        });

        it("should revert with NotTicketOwner on jackpotNFT", async () => {
          await expect(subject()).to.be.revertedWithCustomError(
            jackpotNFT,
            "NotTicketOwner"
          );
        });
      });

      describe("when ticket drawing is not completed", () => {
        beforeEach(async () => {
          // Buy new tickets in the current (incomplete) drawing
          await usdcMock.connect(userOne.wallet).approve(jackpot.getAddress(), usdc(1));
          const newTicketIds = await jackpot.connect(userOne.wallet).buyTickets.staticCall(
            [{ normals: winningNormals, bonusball: winningBonusball }],
            userOne.address,
            [],
            [],
            ethers.encodeBytes32String("test")
          );
          await jackpot.connect(userOne.wallet).buyTickets(
            [{ normals: winningNormals, bonusball: winningBonusball }],
            userOne.address,
            [],
            [],
            ethers.encodeBytes32String("test")
          );

          // Spread into new array to avoid ethers read-only Result object
          subjectTicketIds = [...newTicketIds];
        });

        it("should revert with TicketFromFutureDrawing", async () => {
          await expect(subject()).to.be.revertedWithCustomError(
            jackpot,
            "TicketFromFutureDrawing"
          );
        });
      });

      describe("when no winning ticket is passed (zero payout)", () => {
        beforeEach(async () => {
          // Buy tickets with different numbers (non-winning)
          const losingNormals = [BigInt(10), BigInt(11), BigInt(12), BigInt(13), BigInt(14)];
          const losingBonusball = BigInt(1);

          await usdcMock.connect(userOne.wallet).approve(jackpot.getAddress(), usdc(1));
          const losingTicketIds = await jackpot.connect(userOne.wallet).buyTickets.staticCall(
            [{ normals: losingNormals, bonusball: losingBonusball }],
            userOne.address,
            [],
            [],
            ethers.encodeBytes32String("test")
          );
          await jackpot.connect(userOne.wallet).buyTickets(
            [{ normals: losingNormals, bonusball: losingBonusball }],
            userOne.address,
            [],
            [],
            ethers.encodeBytes32String("test")
          );

          // Complete another drawing with original winning numbers (so these tickets lose)
          await completeDrawingWithWinners(winningNormals, winningBonusball);

          // Spread into new array to avoid ethers read-only Result object
          subjectTicketIds = [...losingTicketIds];
        });

        it("should revert with TicketNotWinner", async () => {
          await expect(subject()).to.be.revertedWithCustomError(
            ticketAutoCompoundVault,
            "InvalidClaimedAmount"
          );
        });
      });

      describe("when jackpot is locked", () => {
        beforeEach(async () => {
          // Advance time and run jackpot to lock it
          await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));
          const drawingId = await jackpot.currentDrawingId();
          const drawingState = await jackpot.getDrawingState(drawingId);
          await jackpot.connect(owner.wallet).runJackpot({
            value: jackpotSystem.deploymentParams.entropyFee +
              ((jackpotSystem.deploymentParams.entropyFee + BigInt(500000) * drawingState.bonusballMax) * BigInt(1e7))
          });
          // Don't call randomnessCallback, leaving jackpot locked
        });

        it("should revert with JackpotLocked", async () => {
          await expect(subject()).to.be.revertedWithCustomError(
            jackpot,
            "JackpotLocked"
          );
        });
      });

      describe("when reentrancy is attempted", () => {
        beforeEach(async () => {
          // Configure USDC mock to call back into depositAndCompound during transfer
          await usdcMock.setCallbackTarget(await ticketAutoCompoundVault.getAddress());
          const callbackData = ticketAutoCompoundVault.interface.encodeFunctionData(
            "depositAndCompound",
            [subjectTicketIds, [], []]
          );
          await usdcMock.setCallbackData(callbackData);
          await usdcMock.enableCallback();
        });

        it("should revert with ReentrancyGuardReentrantCall", async () => {
          await expect(subject()).to.be.revertedWithCustomError(
            ticketAutoCompoundVault,
            "ReentrancyGuardReentrantCall"
          );
        });
      });

      describe("when referrer arrays have mismatched lengths", () => {
        beforeEach(async () => {
          subjectReferrers = [referrerOne.address];
          subjectReferralSplit = [PRECISE_UNIT / BigInt(2), PRECISE_UNIT / BigInt(2)];
        });

        it("should revert with ReferralSplitLengthMismatch", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpot, "ReferralSplitLengthMismatch");
        });
      });

      describe("when too many referrers are provided", () => {
        beforeEach(async () => {
          // maxReferrers is 5, so provide 6
          const accounts = await getAccounts();
          subjectReferrers = [
            accounts[0].address,
            accounts[1].address,
            accounts[2].address,
            accounts[3].address,
            accounts[4].address,
            accounts[5].address,
          ];
          subjectReferralSplit = [
            ether(0.16),
            ether(0.16),
            ether(0.17),
            ether(0.17),
            ether(0.17),
            ether(0.17),
          ];
        });

        it("should revert with TooManyReferrers", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpot, "TooManyReferrers");
        });
      });

      describe("when referral splits do not sum to PRECISE_UNIT", () => {
        beforeEach(async () => {
          subjectReferrers = [referrerOne.address, referrerTwo.address];
          subjectReferralSplit = [ether(0.4), ether(0.4)]; // Sums to 0.8, not 1.0
        });

        it("should revert with ReferralSplitSumInvalid", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpot, "ReferralSplitSumInvalid");
        });
      });

      describe("when referrer is zero address", () => {
        beforeEach(async () => {
          subjectReferrers = [ADDRESS_ZERO, referrerTwo.address];
          subjectReferralSplit = [PRECISE_UNIT / BigInt(2), PRECISE_UNIT / BigInt(2)];
        });

        it("should revert with ZeroAddress", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpot, "ZeroAddress");
        });
      });
    });

    describe("#getUserPendingUSDC", () => {
      it("should return 0 for user with no pending USDC", async () => {
        const pendingUSDC = await ticketAutoCompoundVault.getUserPendingUSDC(userOne.address);
        expect(pendingUSDC).to.equal(BigInt(0));
      });
    });

  });

  describe("#setBatchPurchaseFacilitator", () => {
    let subjectBatchPurchaseFacilitator: Address;
    let subjectCaller: Account;

    beforeEach(async () => {
      subjectBatchPurchaseFacilitator = await batchPurchaseFacilitator.getAddress();
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return await ticketAutoCompoundVault
        .connect(subjectCaller.wallet)
        .setBatchPurchaseFacilitator(subjectBatchPurchaseFacilitator);
    }

    it("should set the batch purchase facilitator correctly", async () => {
      await subject();

      const actualFacilitator = await ticketAutoCompoundVault.batchFacilitator();
      expect(actualFacilitator).to.equal(subjectBatchPurchaseFacilitator);
    });

    it("should emit BatchPurchaseFacilitatorUpdated event", async () => {
      await expect(subject())
        .to.emit(ticketAutoCompoundVault, "BatchPurchaseFacilitatorUpdated")
        .withArgs(subjectBatchPurchaseFacilitator);
    });

    describe("when address is zero", () => {
      beforeEach(async () => {
        subjectBatchPurchaseFacilitator = ADDRESS_ZERO;
      });

      it("should revert with ZeroAddress", async () => {
        await expect(subject()).to.be.revertedWithCustomError(
          jackpot, // JackpotErrors is used
          "ZeroAddress"
        );
      });
    });

    describe("when caller is not owner", () => {
      beforeEach(async () => {
        subjectCaller = userOne;
      });

      it("should revert with OwnableUnauthorizedAccount", async () => {
        await expect(subject()).to.be.revertedWithCustomError(
          ticketAutoCompoundVault,
          "OwnableUnauthorizedAccount"
        );
      });
    });
  });

});
