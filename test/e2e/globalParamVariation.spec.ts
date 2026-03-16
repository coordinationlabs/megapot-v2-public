import { ethers } from "hardhat";
import DeployHelper from "@utils/deploys";
import { ADDRESS_ZERO } from "@utils/constants";

import {
  getWaffleExpect,
  getAccounts
} from "@utils/test/index";
import { ether, usdc } from "@utils/common"
import { Account } from "@utils/test";

import {
  GuaranteedMinimumPayoutCalculator,
  Jackpot,
  JackpotBridgeManager,
  JackpotLPManager,
  JackpotTicketNFT,
  ReentrantUSDCMock,
  ScaledEntropyProviderMock
} from "@utils/contracts";
import {
  Address,
  DrawingState,
  ExtendedTrackedTicket,
  ReferralScheme,
  Ticket,
} from "@utils/types";
import {
  calculateReferralSchemeId,
  calculatePackedTicket,
  calculateTicketId,
  calculateFinalTierPayout,
  calculateTotalDrawingPayout,
} from "@utils/protocolUtils";
import { ONE_DAY_IN_SECONDS, PRECISE_UNIT } from "@utils/constants";
import { takeSnapshot, SnapshotRestorer, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const expect = getWaffleExpect();

describe("GlobalParameterVariation", () => {
  let owner: Account;
  let user: Account;
  let lpOne: Account;
  let buyerOne: Account;
  let buyerTwo: Account;
  let buyerThree: Account;
  let referrerOne: Account;
  let referrerTwo: Account;
  let referrerThree: Account;
  let relayDepository: Account;

  let jackpot: Jackpot;
  let jackpotLPManager: JackpotLPManager;
  let jackpotNFT: JackpotTicketNFT;
  let payoutCalculator: GuaranteedMinimumPayoutCalculator;
  let jackpotBridgeManager: JackpotBridgeManager;
  let usdcMock: ReentrantUSDCMock;
  let entropyProvider: ScaledEntropyProviderMock;
  let snapshot: SnapshotRestorer;
  let deployer: DeployHelper;

  const drawingDurationInSeconds: bigint = ONE_DAY_IN_SECONDS;
  const normalBallMax: bigint = BigInt(30);
  const bonusballMin: bigint = BigInt(5);
  const bonusballSoftCap: bigint = BigInt(100);
  const bonusballHardCap: bigint = BigInt(150);
  const lpEdgeTarget: bigint = ether(0.3);
  const reserveRatio: bigint = ether(0.2);
  const referralFee: bigint = ether(0.065);
  const referralWinShare: bigint = ether(0.05);
  const protocolFee: bigint = ether(0.01);
  const protocolFeeThreshold: bigint = usdc(2);
  const ticketPrice: bigint = usdc(1);
  const maxReferrers: bigint = BigInt(5);
  const premiumTierWeights = [
    ether(0),
    ether(0.17),
    ether(0),
    ether(0.13),
    ether(0.12),
    ether(0.05),
    ether(0.05),
    ether(0.02),
    ether(0.02),
    ether(0.01),
    ether(0.04),
    ether(0.39),
  ];
  const minPayoutTiers = premiumTierWeights.map((value) => value > 0);
  const minimumPayout: bigint = usdc(1);
  const premiumTierMinAllocation: bigint = ether(.2);

  const entropyFee: bigint = ether(0.00005);
  const entropyBaseGasLimit: bigint = BigInt(1000000);
  const entropyVariableGasLimit: bigint = BigInt(250000);

  before(async () => {
    [
      owner,
      user,
      lpOne,
      buyerOne,
      buyerTwo,
      buyerThree,
      referrerOne,
      referrerTwo,
      referrerThree,
      relayDepository
    ] = await getAccounts();
    deployer = new DeployHelper(owner.wallet);

    usdcMock = await deployer.deployReentrantUSDCMock(usdc(1000000000), "USDC", "USDC");
    await usdcMock.connect(owner.wallet).transfer(lpOne.address, usdc(100000000));
    await usdcMock.connect(owner.wallet).transfer(buyerOne.address, usdc(1000));
    await usdcMock.connect(owner.wallet).transfer(buyerTwo.address, usdc(1000));
    await usdcMock.connect(owner.wallet).transfer(buyerThree.address, usdc(1000));

    jackpot = await deployer.deployJackpot(
      drawingDurationInSeconds,
      normalBallMax,
      bonusballMin,
      bonusballSoftCap,
      bonusballHardCap,
      lpEdgeTarget,
      reserveRatio,
      referralFee,
      referralWinShare,
      ticketPrice,
      maxReferrers,
      entropyBaseGasLimit
    );

    jackpotNFT = await deployer.deployJackpotTicketNFT(await jackpot.getAddress(), ADDRESS_ZERO);
    jackpotLPManager = await deployer.deployJackpotLPManager(await jackpot.getAddress());
    payoutCalculator = await deployer.deployGuaranteedMinimumPayoutCalculator(
      await jackpot.getAddress(),
      minimumPayout,
      premiumTierMinAllocation,
      minPayoutTiers,
      premiumTierWeights
    );

    entropyProvider = await deployer.deployScaledEntropyProviderMock(
      entropyFee,
      await jackpot.getAddress(),
      jackpot.interface.getFunction("scaledEntropyCallback").selector
    );

    await jackpot.connect(owner.wallet).initialize(
      (await usdcMock.getAddress()),
      await jackpotLPManager.getAddress(),
      await jackpotNFT.getAddress(),
      await entropyProvider.getAddress(),
      await payoutCalculator.getAddress(),
      owner.address,
      protocolFee,
      protocolFeeThreshold
    );


    jackpotBridgeManager = await deployer.deployJackpotBridgeManager(
      await jackpot.getAddress(),
      await jackpotNFT.getAddress(),
      await usdcMock.getAddress(),
      relayDepository.address,
      "JackpotBridgeManager",
      "1.0"
    );

    await jackpot.connect(owner.wallet).initializeLPDeposits(usdc(100000000));
    await usdcMock.connect(lpOne.wallet).approve(jackpot.getAddress(), usdc(2000000));
    await jackpot.connect(lpOne.wallet).lpDeposit(usdc(2000000));
    await jackpot.connect(owner.wallet).initializeJackpot(BigInt(await time.latest()) + ONE_DAY_IN_SECONDS);
    
    snapshot = await takeSnapshot();
  });

  afterEach(async () => {
    await snapshot.restore();
  });

  describe("#buyTickets", async () => {
    let subjectTickets: Ticket[];
    let subjectRecipient: Address;
    let subjectReferrers: Address[];
    let subjectReferralSplitBps: bigint[];
    let subjectSource: string;
    let subjectCaller: Account;

    beforeEach(async () => {
      const currentDrawingState: DrawingState = await jackpot.connect(owner.wallet).getDrawingState(BigInt(1));
      subjectTickets = [
        {
          normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)],
          bonusball: currentDrawingState.bonusballMax
        } as Ticket,
        {
          normals: [BigInt(2), BigInt(4), BigInt(6), BigInt(7), normalBallMax],
          bonusball: BigInt(3)
        } as Ticket,
        {
          normals: [BigInt(2), BigInt(4), BigInt(6), BigInt(7), normalBallMax],
          bonusball: BigInt(3)
        } as Ticket,
      ];

      await usdcMock.connect(buyerOne.wallet).approve(jackpot.getAddress(), usdc(10));
      await usdcMock.connect(buyerOne.wallet).approve(jackpotBridgeManager.getAddress(), usdc(10));

      subjectRecipient = buyerOne.address;
      subjectReferrers = [referrerOne.address, referrerTwo.address, referrerThree.address];
      subjectReferralSplitBps = [ether(.3333), ether(.3333), ether(.3334)];
      subjectSource = ethers.encodeBytes32String("test");
      subjectCaller = buyerOne;
    });

    async function subject(): Promise<any> {
      return await jackpot.connect(subjectCaller.wallet).buyTickets(
        subjectTickets,
        subjectRecipient,
        subjectReferrers,
        subjectReferralSplitBps,
        subjectSource
      );
    }

    async function subjectStaticCall(): Promise<any> {
      return await jackpot.connect(subjectCaller.wallet).buyTickets.staticCall(
        subjectTickets,
        subjectRecipient,
        subjectReferrers,
        subjectReferralSplitBps,
        subjectSource
      );
    }

    async function subjectBridgeManagerCall(): Promise<any> {
      return await jackpotBridgeManager.connect(subjectCaller.wallet).buyTickets(
        subjectTickets,
        subjectRecipient,
        subjectReferrers,
        subjectReferralSplitBps,
        subjectSource
      );
    }

    async function buyTicketValidations(): Promise<void> {
      const preBuyerBalance = await usdcMock.balanceOf(buyerOne.address);
      const preContractBalance = await usdcMock.balanceOf(jackpot.getAddress());

      const ticketIds = await subjectStaticCall();
      await subject();

      const expectedTicketIdOne = calculateTicketId(1, 1, calculatePackedTicket(subjectTickets[0], BigInt(normalBallMax)));
      const expectedTicketIdTwo = calculateTicketId(1, 2, calculatePackedTicket(subjectTickets[1], BigInt(normalBallMax)));
      const expectedTicketIdThree = calculateTicketId(1, 3, calculatePackedTicket(subjectTickets[2], BigInt(normalBallMax)));

      const actualDrawingState: DrawingState = await jackpot.getDrawingState(1);
      const postBuyerBalance = await usdcMock.balanceOf(buyerOne.address);
      const postContractBalance = await usdcMock.balanceOf(jackpot.getAddress());
      const packedUserTickets: ExtendedTrackedTicket[] = await jackpotNFT.getUserTickets(buyerOne.address, 1);
      const ticketOneOwner = await jackpotNFT.ownerOf(expectedTicketIdOne);
      const ticketTwoOwner = await jackpotNFT.ownerOf(expectedTicketIdTwo);
      const ticketThreeOwner = await jackpotNFT.ownerOf(expectedTicketIdThree);
      const buyerBalance = await jackpotNFT.balanceOf(buyerOne.address);
      const areTicketsBought = await jackpot.checkIfTicketsBought(1, subjectTickets);
      const ticketOne = await jackpotNFT.tickets(expectedTicketIdOne);
      const ticketTwo = await jackpotNFT.tickets(expectedTicketIdTwo);
      const ticketThree = await jackpotNFT.tickets(expectedTicketIdThree);
      const referrerOneBalance = await jackpot.referralFees(referrerOne.address);
      const referrerTwoBalance = await jackpot.referralFees(referrerTwo.address);
      const referrerThreeBalance = await jackpot.referralFees(referrerThree.address);

      const referralSchemeId = calculateReferralSchemeId(subjectReferrers, subjectReferralSplitBps);
      const referralScheme: ReferralScheme = await jackpot.getReferralScheme(referralSchemeId);

      expect(actualDrawingState.globalTicketsBought).to.eq(BigInt(3));
      expect(actualDrawingState.lpEarnings).to.eq(
        BigInt(subjectTickets.length) * ticketPrice * (PRECISE_UNIT - referralFee) / PRECISE_UNIT
      );

      expect(postBuyerBalance).to.eq(preBuyerBalance - BigInt(subjectTickets.length) * ticketPrice);
      expect(postContractBalance).to.eq(preContractBalance + BigInt(subjectTickets.length) * ticketPrice);

      expect(ticketIds).to.deep.equal([expectedTicketIdOne, expectedTicketIdTwo, expectedTicketIdThree]);

      expect(packedUserTickets[0].ticket.packedTicket).to.equal(calculatePackedTicket(subjectTickets[0], BigInt(normalBallMax)));
      expect(packedUserTickets[1].ticket.packedTicket).to.equal(calculatePackedTicket(subjectTickets[1], BigInt(normalBallMax)));
      expect(packedUserTickets[2].ticket.packedTicket).to.equal(calculatePackedTicket(subjectTickets[2], BigInt(normalBallMax)));
      expect(packedUserTickets[0].normals).to.deep.equal(subjectTickets[0].normals);
      expect(packedUserTickets[1].normals).to.deep.equal(subjectTickets[1].normals);
      expect(packedUserTickets[2].normals).to.deep.equal(subjectTickets[2].normals);
      expect(packedUserTickets[0].bonusball).to.equal(subjectTickets[0].bonusball);
      expect(packedUserTickets[1].bonusball).to.equal(subjectTickets[1].bonusball);
      expect(packedUserTickets[2].bonusball).to.equal(subjectTickets[2].bonusball);

      expect(buyerBalance).to.eq(BigInt(3));
      expect(ticketOneOwner).to.eq(buyerOne.address);
      expect(ticketTwoOwner).to.eq(buyerOne.address);
      expect(ticketThreeOwner).to.eq(buyerOne.address);
      expect(areTicketsBought).to.deep.equal([true, true, true]);

      expect(ticketOne.drawingId).to.eq(1);
      expect(ticketOne.packedTicket).to.eq(calculatePackedTicket(subjectTickets[0], BigInt(normalBallMax)));
      expect(ticketOne.referralScheme).to.eq(calculateReferralSchemeId(subjectReferrers, subjectReferralSplitBps));

      expect(ticketTwo.drawingId).to.eq(1);
      expect(ticketTwo.packedTicket).to.eq(calculatePackedTicket(subjectTickets[1], BigInt(normalBallMax)));

      expect(ticketThree.drawingId).to.eq(1);
      expect(ticketThree.packedTicket).to.eq(calculatePackedTicket(subjectTickets[2], BigInt(normalBallMax)));

      const expectedReferralFee = BigInt(subjectTickets.length) * ticketPrice * referralFee / PRECISE_UNIT;
      expect(referrerOneBalance).to.eq(expectedReferralFee * ether(.3333) / PRECISE_UNIT);
      expect(referrerTwoBalance).to.eq(expectedReferralFee * ether(.3333) / PRECISE_UNIT);
      expect(referrerThreeBalance).to.eq(expectedReferralFee * ether(.3334) / PRECISE_UNIT);

      expect(referralScheme.referrers).to.deep.equal(subjectReferrers);
      expect(referralScheme.referralSplit).to.deep.equal(subjectReferralSplitBps);
    };

    async function bridgeManagerBuyTicketValidations(): Promise<void> {
      const preBuyerBalance = await usdcMock.balanceOf(buyerOne.address);
      const preBridgeManagerBalance = await usdcMock.balanceOf(jackpotBridgeManager.getAddress());
      const preContractBalance = await usdcMock.balanceOf(jackpot.getAddress());

      await subjectBridgeManagerCall();

      const ticketCost = BigInt(subjectTickets.length) * ticketPrice;

      const postBuyerBalance = await usdcMock.balanceOf(buyerOne.address);
      const postBridgeManagerBalance = await usdcMock.balanceOf(jackpotBridgeManager.getAddress());
      const postContractBalance = await usdcMock.balanceOf(jackpot.getAddress());

      expect(postContractBalance).to.eq(preContractBalance + ticketCost);
      expect(postBridgeManagerBalance).to.eq(preBridgeManagerBalance);
      expect(postBuyerBalance).to.eq(preBuyerBalance - ticketCost);
    }
    
    describe("when the global ticket price is changed", async () => {
      beforeEach(async () => {
        await jackpot.connect(owner.wallet).setTicketPrice(usdc(2));
      });

      it("should not effect buyTickets within the same round", async () => {
        await buyTicketValidations();
        // await bridgeManagerBuyTicketValidations();
      });
    });

    describe("when the referral fee is changed", async () => {
      beforeEach(async () => {
        await jackpot.connect(owner.wallet).setReferralFee(ether(0.07));
      });

      it("should not effect buyTickets within the same round", async () => {
        await buyTicketValidations();
        await bridgeManagerBuyTicketValidations();
      });
    });

    describe("when the normal ball max is changed", async () => {
      beforeEach(async () => {
        await jackpot.connect(owner.wallet).setNormalBallMax(BigInt(35));
      });

      it("should not effect buyTickets within the same round", async () => {
        await buyTicketValidations();
      });
    });

    describe("when the lpEdgeTarget is changed", async () => {
      beforeEach(async () => {
        await jackpot.connect(owner.wallet).setLpEdgeTarget(ether(0.4));
      });

      it("should not effect buyTickets within the same round", async () => {
        await buyTicketValidations();
      });
    });
  });

  describe("#claimWinnings", async () => {
    let subjectTicketIds: bigint[];
    let subjectCaller: Account;

    let buyerOneTicketInfo: Ticket[];
    let buyerOneTicketIds: bigint[];

    let buyerTwoTicketInfo: Ticket[];
    let buyerTwoTicketIds: bigint[];

    let buyerThreeTicketInfo: Ticket[];
    let buyerThreeTicketIds: bigint[];

    let winningNumbers: bigint[][];

    beforeEach(async () => {
      await usdcMock.connect(buyerOne.wallet).approve(jackpot.getAddress(), usdc(6));
      await usdcMock.connect(buyerTwo.wallet).approve(jackpot.getAddress(), usdc(5));
      await usdcMock.connect(buyerThree.wallet).approve(jackpot.getAddress(), usdc(5));

      buyerOneTicketInfo = [
        {
          normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)],
          bonusball: BigInt(6)
        } as Ticket,
        {
          normals: [BigInt(6), BigInt(7), BigInt(8), BigInt(9), BigInt(10)],
          bonusball: BigInt(3)
        } as Ticket,
        {
          normals: [BigInt(1), BigInt(2), BigInt(5), BigInt(7), BigInt(9)],
          bonusball: BigInt(6)
        } as Ticket,
      ];
      buyerTwoTicketInfo = [
        {
          normals: [BigInt(6), BigInt(7), BigInt(8), BigInt(9), BigInt(10)],
          bonusball: BigInt(6)
        } as Ticket,
        {
          normals: [BigInt(6), BigInt(7), BigInt(8), BigInt(10), BigInt(normalBallMax)],
          bonusball: BigInt(6)
        } as Ticket,
      ];

      buyerThreeTicketInfo = [
        {
          normals: [BigInt(5), BigInt(7), BigInt(8), BigInt(9), BigInt(10)],
          bonusball: BigInt(3)
        } as Ticket,
      ];

      // buyer one
      buyerOneTicketIds = await jackpot.connect(buyerOne.wallet).buyTickets.staticCall(
        buyerOneTicketInfo,
        buyerOne.address,
        [referrerOne.address, referrerTwo.address, referrerThree.address],
        [ether(.3333), ether(.3333), ether(.3334)],
        ethers.encodeBytes32String("test")
      );

      await jackpot.connect(buyerOne.wallet).buyTickets(
        buyerOneTicketInfo,
        buyerOne.address,
        [referrerOne.address, referrerTwo.address, referrerThree.address],
        [ether(.3333), ether(.3333), ether(.3334)],
        ethers.encodeBytes32String("test")
      );

      // buyer two
      buyerTwoTicketIds = await jackpot.connect(buyerTwo.wallet).buyTickets.staticCall(
        buyerTwoTicketInfo,
        buyerTwo.address,
        [],
        [],
        ethers.encodeBytes32String("test")
      );

      await jackpot.connect(buyerTwo.wallet).buyTickets(
        buyerTwoTicketInfo,
        buyerTwo.address,
        [],
        [],
        ethers.encodeBytes32String("test")
      );

      // buyer three
      buyerThreeTicketIds = await jackpot.connect(buyerThree.wallet).buyTickets.staticCall(
        buyerThreeTicketInfo,
        buyerThree.address,
        [],
        [],
        ethers.encodeBytes32String("test")
      );

      await jackpot.connect(buyerThree.wallet).buyTickets(
        buyerThreeTicketInfo,
        buyerThree.address,
        [],
        [],
        ethers.encodeBytes32String("test")
      );

      await time.increase(drawingDurationInSeconds);
      const drawingState = await jackpot.getDrawingState(1);
      await jackpot.runJackpot({ value: entropyFee + ((entropyBaseGasLimit + entropyVariableGasLimit * drawingState.bonusballMax) * BigInt(1e7)) });

      winningNumbers = [[BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], [BigInt(6)]];
      await entropyProvider.randomnessCallback(winningNumbers);

      subjectTicketIds = [buyerOneTicketIds[0]];
      subjectCaller = buyerOne;
    });

    async function subject(): Promise<any> {
      return await jackpot.connect(subjectCaller.wallet).claimWinnings(subjectTicketIds);
    }

    async function claimWinningsValidations(): Promise<void> {
      const preBuyerBalance = await usdcMock.balanceOf(buyerOne.address);
      const preContractBalance = await usdcMock.balanceOf(await jackpot.getAddress());

      const preReferrerOneFees = await jackpot.referralFees(referrerOne.address);
      const preReferrerTwoFees = await jackpot.referralFees(referrerTwo.address);
      const preReferrerThreeFees = await jackpot.referralFees(referrerThree.address);

      await subject();
      const drawingState = await jackpot.getDrawingState(1);
      const expectedWinningAmount = calculateTotalDrawingPayout(
        drawingState.prizePool,
        drawingState.ballMax,
        drawingState.bonusballMax,
        [BigInt(1), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(1)],
        [BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0)],
        minimumPayout,
        minPayoutTiers,
        premiumTierWeights
      ).tierPayouts[11];
      const expectedReferrerFee = expectedWinningAmount * referralWinShare / PRECISE_UNIT;

      const postBuyerBalance = await usdcMock.balanceOf(buyerOne.address);
      const postContractBalance = await usdcMock.balanceOf(await jackpot.getAddress());

      expect(postBuyerBalance).to.be.equal(preBuyerBalance + expectedWinningAmount - expectedReferrerFee);
      expect(postContractBalance).to.be.equal(preContractBalance - expectedWinningAmount + expectedReferrerFee);

      const postReferrerOneFees = await jackpot.referralFees(referrerOne.address);
      const postReferrerTwoFees = await jackpot.referralFees(referrerTwo.address);
      const postReferrerThreeFees = await jackpot.referralFees(referrerThree.address);

      const expectedReferrerFeeOne = expectedWinningAmount * referralWinShare * ether(.3333) / (PRECISE_UNIT * PRECISE_UNIT);
      const expectedReferrerFeeTwo = expectedWinningAmount * referralWinShare * ether(.3333) / (PRECISE_UNIT * PRECISE_UNIT);
      const expectedReferrerFeeThree = expectedWinningAmount * referralWinShare * ether(.3334) / (PRECISE_UNIT * PRECISE_UNIT);

      expect(postReferrerOneFees).to.be.equal(preReferrerOneFees + expectedReferrerFeeOne);
      expect(postReferrerTwoFees).to.be.equal(preReferrerTwoFees + expectedReferrerFeeTwo);
      expect(postReferrerThreeFees).to.be.equal(preReferrerThreeFees + expectedReferrerFeeThree);
    }

    describe("when the referral win share is changed", async () => {
      beforeEach(async () => {
        await jackpot.connect(owner.wallet).setReferralWinShare(ether(0.1));
      });

      it("should not effect claimWinnings outcomes", async () => {
        await claimWinningsValidations();
      });
    });

    describe("when the payout calculator contract is changed", async () => {
      beforeEach(async () => {
        const newPayoutCalculator = await deployer.deployGuaranteedMinimumPayoutCalculator(
          await jackpot.getAddress(),
          minimumPayout,
          premiumTierMinAllocation,
          minPayoutTiers,
          premiumTierWeights
        );
        await jackpot.setPayoutCalculator(await newPayoutCalculator.getAddress());
      });

      it("should not effect claimWinnings outcomes", async () => {
        await claimWinningsValidations();
      });
    });

    describe("when the payout calculator is updated with a different minimum payout during the drawing", async () => {
      before(async () => {
        await payoutCalculator.connect(owner.wallet).setMinimumPayout(minimumPayout + usdc(1));
      });

      it("should not effect claimWinnings outcomes", async () => {
        await claimWinningsValidations();
      });
    });

    describe("when the payout calculator is updated with a different minPayoutTiers during the drawing", async () => {
      before(async () => {
        await payoutCalculator.connect(owner.wallet).setMinPayoutTiers([
          false, false,  true,  true,  true,  true,
          true,  true,  true,  true,  true,  true
        ]);
      });

      it("should not effect claimWinnings outcomes", async () => {
        await claimWinningsValidations();
      });
    });

    describe("when the payout calculator is updated with a different premiumTierWeights during the drawing", async () => {
      before(async () => {
        await payoutCalculator.connect(owner.wallet).setPremiumTierWeights([
          ether(0),
          ether(0.16),
          ether(0),
          ether(0.14),
          ether(0.11),
          ether(0.06),
          ether(0.04),
          ether(0.03),
          ether(0.02),
          ether(0.01),
          ether(0.03),
          ether(0.40),
        ]);
      });

      it("should not effect claimWinnings outcomes", async () => {
        await claimWinningsValidations();
      });
    });

    describe("when the payout calculator is updated with a different premiumTierMinAllocation during the drawing", async () => {
      before(async () => {
        await payoutCalculator.connect(owner.wallet).setPremiumTierMinAllocation(ether(0.8));
      });

      it("should not effect claimWinnings outcomes", async () => {
        await claimWinningsValidations();
      });
    });
  });
});