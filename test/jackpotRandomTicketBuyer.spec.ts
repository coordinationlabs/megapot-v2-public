import { ethers } from "hardhat";

import { getWaffleExpect, getAccounts } from "@utils/test/index";
import { ether, usdc } from "@utils/common";
import { Account } from "@utils/test";

import {
  Jackpot,
  JackpotRandomTicketBuyer,
  JackpotLPManager,
  JackpotTicketNFT,
  GuaranteedMinimumPayoutCalculator,
  ReentrantUSDCMock,
  ScaledEntropyProviderMock,
} from "@utils/contracts";
import { Address, JackpotSystemFixture } from "@utils/types";
import { deployJackpotSystem } from "@utils/test/jackpotFixture";
import { takeSnapshot, SnapshotRestorer, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { ADDRESS_ZERO } from "@utils/constants";

const expect = getWaffleExpect();

describe("JackpotRandomTicketBuyer", () => {
  let owner: Account;
  let payer: Account;
  let recipient: Account;

  let jackpotSystem: JackpotSystemFixture;
  let jackpot: Jackpot;
  let jackpotNFT: JackpotTicketNFT;
  let jackpotLPManager: JackpotLPManager;
  let payoutCalculator: GuaranteedMinimumPayoutCalculator;
  let usdcMock: ReentrantUSDCMock;
  let entropyProvider: ScaledEntropyProviderMock;
  let snapshot: SnapshotRestorer;
  let randomBuyer: JackpotRandomTicketBuyer;

  beforeEach(async () => {
    [owner, payer, recipient] = await getAccounts();

    jackpotSystem = await deployJackpotSystem();
    jackpot = jackpotSystem.jackpot;
    jackpotNFT = jackpotSystem.jackpotNFT;
    jackpotLPManager = jackpotSystem.jackpotLPManager;
    payoutCalculator = jackpotSystem.payoutCalculator;
    usdcMock = jackpotSystem.usdcMock;
    entropyProvider = jackpotSystem.entropyProvider;

    // Fund payer
    await usdcMock.connect(owner.wallet).transfer(payer.address, usdc(1_000_000));

    // Initialize jackpot and seed LP pool
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
    await jackpot.connect(owner.wallet).initializeLPDeposits(usdc(10_000_000));
    await usdcMock.connect(owner.wallet).approve(jackpot.getAddress(), usdc(1_000_000));
    await jackpot.connect(owner.wallet).lpDeposit(usdc(1_000_000));

    // Initialize first drawing
    await jackpot.connect(owner.wallet).initializeJackpot(BigInt(await time.latest()) + jackpotSystem.deploymentParams.drawingDurationInSeconds);

    // Deploy buyer
    randomBuyer = await jackpotSystem.deployer.deployJackpotRandomTicketBuyer(
      await jackpot.getAddress(),
      await usdcMock.getAddress()
    );

    snapshot = await takeSnapshot();
  });

  beforeEach(async () => {
    await snapshot.restore();
  });

  describe("#constructor", () => {
    it("sets jackpot and usdc addresses", async () => {
      expect(await randomBuyer.jackpot()).to.eq(await jackpot.getAddress());
      expect(await randomBuyer.usdc()).to.eq(await usdcMock.getAddress());
    });
  });

  describe("#buyTickets", () => {
    let subjectCount: bigint;
    let subjectRecipient: Address;
    let subjectReferrers: Address[];
    let subjectReferralSplits: bigint[];
    let subjectSource: string;

    beforeEach(async () => {
      subjectCount = BigInt(3);
      subjectRecipient = recipient.address;
      subjectReferrers = [];
      subjectReferralSplits = [];
      subjectSource = "random-buyer";

      // Payer approves buyer contract
      await usdcMock.connect(payer.wallet).approve(randomBuyer.getAddress(), usdc(1_000_000));
    });

    async function subjectStatic() {
      const ticketIds = await randomBuyer.connect(payer.wallet).buyTickets.staticCall(
        subjectCount,
        subjectRecipient,
        subjectReferrers, 
        subjectReferralSplits, 
        ethers.encodeBytes32String(subjectSource)
      );

      return ticketIds;
    }

    async function subject() {
      return await randomBuyer.connect(payer.wallet).buyTickets(
        subjectCount,
        subjectRecipient,
        subjectReferrers, 
        subjectReferralSplits, 
        ethers.encodeBytes32String(subjectSource)
      );
    }

    it("should increment the nonce", async () => {
      const before = await randomBuyer.nonce();
      await subject();
      const after = await randomBuyer.nonce();
      expect(after).to.eq(before + BigInt(1));
    });

    it("should transfer the exact amount of USDC from the payer to the buyer", async () => {
      const preBuyerBalance = await usdcMock.balanceOf(payer.address);
      const preJackpotBalance = await usdcMock.balanceOf(await jackpot.getAddress());

      await subject();

      const postBuyerBalance = await usdcMock.balanceOf(payer.address);
      const postJackpotBalance = await usdcMock.balanceOf(await jackpot.getAddress());

      const expectedTotalCost = subjectCount * await jackpot.ticketPrice();
      
      expect(postBuyerBalance).to.eq(preBuyerBalance - expectedTotalCost);
      expect(postJackpotBalance).to.eq(preJackpotBalance + expectedTotalCost);
    });
    
    it("mints the requested number of tickets to the recipient", async () => {
      await subject();
      const tickets = await jackpotNFT.getUserTickets(subjectRecipient, BigInt(1));
      expect(tickets.length).to.eq(Number(subjectCount));
    });

    it("should emit the correct RandomTicketsBought event", async () => {
      const expectedTotalCost = subjectCount * await jackpot.ticketPrice();
      const tx = await subject();
      const receipt = await tx.wait();
      const event = receipt?.logs.find(log => log.fragment?.name === "RandomTicketsBought");
    
      expect(event?.args?.recipient).to.equal(subjectRecipient);
      expect(event?.args?.drawingId).to.equal(await jackpot.currentDrawingId());
      expect(event?.args?.count).to.equal(subjectCount);
      expect(event?.args?.cost).to.equal(expectedTotalCost);
      expect(event?.args?.ticketIds).to.have.length(Number(subjectCount));
    });

    describe("when the recipient is the zero address", () => {
      beforeEach(async () => {
        subjectRecipient = ADDRESS_ZERO;
      });

      it("reverts", async () => {
        await expect(subject()).to.be.revertedWithCustomError(randomBuyer, "InvalidRecipient");
      });
    });

    describe("when the count is zero", () => {
      beforeEach(async () => {
        subjectCount = BigInt(0);
      });

      it("reverts", async () => {
        await expect(subject()).to.be.revertedWithCustomError(randomBuyer, "InvalidTicketCount");
      });
    });

    describe("when the reentrancy protection is violated", async () => {
      beforeEach(async () => {
        await usdcMock.setCallbackTarget(await randomBuyer.getAddress());
        const callbackData = randomBuyer.interface.encodeFunctionData(
          "buyTickets",
          [
            subjectCount,
            subjectRecipient,
            subjectReferrers, 
            subjectReferralSplits,
            ethers.encodeBytes32String(subjectSource)
          ]
        );
        await usdcMock.setCallbackData(callbackData);
        await usdcMock.enableCallback();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(randomBuyer, "ReentrancyGuardReentrantCall");
      });
    });
  });
});

