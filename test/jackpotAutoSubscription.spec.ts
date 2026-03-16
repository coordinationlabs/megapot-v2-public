import {
  getWaffleExpect,
  getAccounts
} from "@utils/test/index";
import { ether, usdc } from "@utils/common"
import { Account } from "@utils/test";

import {
  BatchPurchaseFacilitator,
  GuaranteedMinimumPayoutCalculator,
  Jackpot,
  JackpotAutoSubscription,
  JackpotLPManager,
  JackpotTicketNFT,
  ScaledEntropyProviderMock,
  ReentrantUSDCMock
} from "@utils/contracts";
import { Address, ExecutionAction, JackpotSystemFixture, Ticket } from "@utils/types";
import { deployJackpotSystem } from "@utils/test/jackpotFixture";
import { ADDRESS_ZERO } from "@utils/constants";
import { takeSnapshot, SnapshotRestorer, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const expect = getWaffleExpect();

describe("JackpotAutoSubscription", () => {
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
  let jackpotAutoSubscription: JackpotAutoSubscription;
  let batchPurchaseFacilitator: BatchPurchaseFacilitator;

  before(async () => {
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
      BigInt(5)
    );

    jackpotAutoSubscription = await jackpotSystem.deployer.deployJackpotAutoSubscription(
      await jackpot.getAddress(),
      await usdcMock.getAddress(),
      await batchPurchaseFacilitator.getAddress()
    );

    await jackpotAutoSubscription.connect(owner.wallet).addAllowed(keeper.address);

    snapshot = await takeSnapshot();
  });

  beforeEach(async () => {
    await snapshot.restore();
  });

  describe("#constructor", () => {
    it("should set the jackpot address correctly", async () => {
      expect(await jackpotAutoSubscription.jackpot()).to.equal(await jackpot.getAddress());
    });

    it("should set the usdc address correctly", async () => {
      expect(await jackpotAutoSubscription.usdc()).to.equal(await usdcMock.getAddress());
    });
  });

  describe("#createSubscription", () => {
    let isInitialized: boolean = true;

    let subjectRecipient: Address;
    let subjectTotalDays: bigint;
    let subjectDynamicTicketCount: bigint;
    let subjectStaticTickets: Ticket[];
    let subjectReferrers: Address[];
    let subjectReferralSplits: bigint[];
    let subjectCaller: Account;

    beforeEach(async () => {
      if (isInitialized) {
        await jackpot.connect(owner.wallet).initializeJackpot(BigInt(await time.latest()) + BigInt(jackpotSystem.deploymentParams.drawingDurationInSeconds));
      }

      subjectRecipient = buyerOne.address;
      subjectTotalDays = BigInt(10);
      subjectDynamicTicketCount = BigInt(1);
      subjectStaticTickets = [
        { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], bonusball: BigInt(1) },
      ];
      subjectReferrers = [referrerOne.address, referrerTwo.address, referrerThree.address];
      subjectReferralSplits = [ether(0.3), ether(0.4), ether(0.3)];
      subjectCaller = payer;

      await usdcMock.connect(payer.wallet).approve(jackpotAutoSubscription.getAddress(), usdc(2) * subjectTotalDays);
    });

    async function subject(): Promise<any> {
      return await jackpotAutoSubscription.connect(subjectCaller.wallet).createSubscription(
        subjectRecipient,
        subjectTotalDays,
        subjectDynamicTicketCount,
        subjectStaticTickets,
        subjectReferrers,
        subjectReferralSplits
      );
    }

    it("should create a subscription correctly", async () => {
      await subject();

      const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectRecipient);
      const actualSubscription = actualSubscriptionInfo.subscription;
      const actualStaticTickets: Ticket[] = actualSubscriptionInfo.staticTickets;
      expect(actualSubscription.remainingUSDC).to.equal(subjectTotalDays * usdc(2));
      expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(0));
      expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(1));
      expect(actualSubscription.dynamicTicketCount).to.equal(BigInt(1));
      expect(actualSubscription.referrers).to.deep.equal(subjectReferrers);
      expect(actualSubscription.referralSplit).to.deep.equal(subjectReferralSplits);
      expect(actualStaticTickets.length).to.equal(subjectStaticTickets.length);
      for (let i = 0; i < subjectStaticTickets.length; i++) {
        expect(actualStaticTickets[i].normals).to.deep.equal(subjectStaticTickets[i].normals);
        expect(actualStaticTickets[i].bonusball).to.equal(subjectStaticTickets[i].bonusball);
      }
    });

    it("should transfer the total cost from the payer to the contract", async () => {
      const prePayerBalance = await usdcMock.balanceOf(payer.address);
      const preContractBalance = await usdcMock.balanceOf(jackpotAutoSubscription.getAddress());
      const totalCost = subjectTotalDays * usdc(2);
      
      await subject();

      const postPayerBalance = await usdcMock.balanceOf(payer.address);
      const postContractBalance = await usdcMock.balanceOf(jackpotAutoSubscription.getAddress());

      expect(postPayerBalance).to.equal(prePayerBalance - totalCost);
      expect(postContractBalance).to.equal(preContractBalance + totalCost);
    });

    it("should emit the SubscriptionCreated event correctly", async () => {
      await expect(subject()).to.emit(jackpotAutoSubscription, "SubscriptionCreated").withArgs(
        subjectCaller.address,
        subjectRecipient,
        subjectTotalDays * usdc(2),
        subjectTotalDays,
        BigInt(0),
        subjectDynamicTicketCount,
        subjectStaticTickets.length,
        usdc(1)
      );
    });

    describe("when the global ticket price has changed", () => {
      beforeEach(async () => {
        await jackpot.connect(owner.wallet).setTicketPrice(usdc(2));
        await usdcMock.connect(payer.wallet).approve(jackpotAutoSubscription.getAddress(), usdc(4) * subjectTotalDays);
      });

      it("should create a subscription correctly", async () => {
        await subject();
  
        const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectRecipient);
        const actualSubscription = actualSubscriptionInfo.subscription;

        expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(1));
      });

      it("should emit the SubscriptionCreated event correctly", async () => {
        await expect(subject()).to.emit(jackpotAutoSubscription, "SubscriptionCreated").withArgs(
          subjectCaller.address,
          subjectRecipient,
          subjectTotalDays * usdc(4),
          subjectTotalDays,
          BigInt(1),
          subjectDynamicTicketCount,
          subjectStaticTickets.length,
          usdc(2)
        );
      });
    });

    describe("when the referrer count is greater than the current global max referrer count", () => {
      beforeEach(async () => {
        await jackpot.connect(owner.wallet).setMaxReferrers(1);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "TooManyReferrers");
      });
    });

    describe("when the recipient already has an active subscription", () => {
      beforeEach(async () => {
        await subject();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ActiveSubscriptionExists");
      });
    });

    describe("when the recipient is the zero address  ", () => {
      beforeEach(async () => {
        subjectRecipient = ADDRESS_ZERO;
      });

      it("should revert with the ZeroAddress error", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ZeroAddress");
      });
    });

    describe("when the total days is 0", () => {
      beforeEach(async () => {
        subjectTotalDays = BigInt(0);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "InvalidDuration");
      });
    });

    describe("when the total ticket count is 0", () => {
      beforeEach(async () => {
        subjectDynamicTicketCount = BigInt(0);
        subjectStaticTickets = [];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "InvalidTicketCount");
      });
    });

    describe("when a static ticket has an invalid normal ball count", () => {
      beforeEach(async () => {
        subjectStaticTickets = [
          { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5), BigInt(6)], bonusball: BigInt(1) },
        ];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "InvalidNormalBallCount");
      });
    });

    describe("when a static ticket has a normal ball that is zero", () => {
      beforeEach(async () => {
        subjectStaticTickets = [
          { normals: [BigInt(0), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], bonusball: BigInt(1) },
        ];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "InvalidStaticTicket");
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
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "InvalidStaticTicket");
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
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "RepeatedNormalBall");
      });
    });

    describe("when a static ticket has a zero bonusball", () => {
      beforeEach(async () => {
        subjectStaticTickets = [
          { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], bonusball: BigInt(0) },
        ];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "InvalidStaticTicket");
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
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "InvalidStaticTicket");
      });
    });

    describe("when the referral split sum is not equal to PRECISE_UNIT", () => {
      beforeEach(async () => {
        subjectReferralSplits = [ether(0.1), ether(0.2), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ReferralSplitSumInvalid");
      });
    });

    describe("when the referral split is greater than PRECISE_UNIT", () => {
      beforeEach(async () => {
        subjectReferralSplits = [ether(0.31), ether(0.4), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ReferralSplitSumInvalid");
      });
    });

    describe("when the referrer count does not match the referral split count", () => {
      beforeEach(async () => {
        subjectReferrers = [referrerOne.address, referrerTwo.address];
        subjectReferralSplits = [ether(0.3), ether(0.4), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ReferralSplitLengthMismatch");
      });
    });

    describe("when the referrer is the zero address", () => {
      beforeEach(async () => {
        subjectReferrers = [ADDRESS_ZERO, referrerTwo.address, referrerThree.address];
        subjectReferralSplits = [ether(0.3), ether(0.4), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ZeroAddress");
      });
    });

    describe("when the referral split is zero", () => {
      beforeEach(async () => {
        subjectReferralSplits = [ether(0), ether(0.4), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "InvalidReferralSplitBps");
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
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "JackpotNotInitialized");
      });
    });

    describe("when the reentrancy protection is violated", async () => {
      beforeEach(async () => {
        await usdcMock.setCallbackTarget(await jackpotAutoSubscription.getAddress());
        const callbackData = jackpotAutoSubscription.interface.encodeFunctionData(
          "createSubscription",
          [
            subjectRecipient,
            subjectTotalDays,
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
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ReentrancyGuardReentrantCall");
      });
    });
  });

  context("when the jackpot is initialized", () => {
    beforeEach(async () => {
      await jackpot.connect(owner.wallet).initializeJackpot(BigInt(await time.latest()) + BigInt(jackpotSystem.deploymentParams.drawingDurationInSeconds));
    });

    describe("#cancelSubscription", () => {
      let totalCost: bigint;
  
      let subjectCaller: Account;
  
      beforeEach(async () => {
        const staticTickets = [
          { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], bonusball: BigInt(1) },
        ];
  
        const totalDays = BigInt(10);
        totalCost = totalDays * usdc(2);
        await usdcMock.connect(payer.wallet).approve(jackpotAutoSubscription.getAddress(), totalCost);
        await jackpotAutoSubscription.connect(payer.wallet).createSubscription(
          buyerOne.address,
          totalDays,
          BigInt(1),
          staticTickets,
          [referrerOne.address, referrerTwo.address, referrerThree.address],
          [ether(0.3), ether(0.4), ether(0.3)]
        );
  
        subjectCaller = buyerOne;
      });
  
      async function subject(): Promise<any> {
        return await jackpotAutoSubscription.connect(subjectCaller.wallet).cancelSubscription();
      }
  
      it("should cancel the subscription correctly", async () => {
        await subject();
        const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectCaller.address);
        const actualSubscription = actualSubscriptionInfo.subscription;
        const actualStaticTickets: Ticket[] = actualSubscriptionInfo.staticTickets;
  
        expect(actualSubscription.remainingUSDC).to.equal(BigInt(0));
        expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(0));
        expect(actualSubscription.dynamicTicketCount).to.equal(BigInt(0));
        expect(actualSubscription.referrers).to.deep.equal([]);
        expect(actualSubscription.referralSplit).to.deep.equal([]);
        expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(0));
        expect(actualStaticTickets.length).to.equal(0);
      });
  
      it("should transfer the remaining USDC to the recipient", async () => {
        const preRecipientBalance = await usdcMock.balanceOf(subjectCaller.address);
        await subject();
        const postRecipientBalance = await usdcMock.balanceOf(subjectCaller.address);
        expect(postRecipientBalance).to.equal(preRecipientBalance + totalCost);
      });
  
      it("should emit the SubscriptionCancelled event correctly", async () => {
        await expect(subject()).to.emit(jackpotAutoSubscription, "SubscriptionCancelled").withArgs(
          subjectCaller.address,
          ExecutionAction.CANCEL_USER_REQUESTED,
          totalCost
        );
      });
  
      describe("when the reentrancy protection is violated", async () => {
        beforeEach(async () => {
          await usdcMock.setCallbackTarget(await jackpotAutoSubscription.getAddress());
          const callbackData = jackpotAutoSubscription.interface.encodeFunctionData(
            "cancelSubscription",
            []
          );
          await usdcMock.setCallbackData(callbackData);
          await usdcMock.enableCallback();
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ReentrancyGuardReentrantCall");
        });
      });
  
      describe("when the recipient does not have an active subscription", () => {
        beforeEach(async () => {
          await jackpotAutoSubscription.connect(subjectCaller.wallet).cancelSubscription();
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "NoActiveSubscription");
        });
      });
    });
  
    describe("#executeSubscriptions", () => {
      let totalCost: bigint;
      let updateTicketPrice: boolean = false;
  
      let subjectSubscriptions: Address[];
      let subjectCaller: Account;
  
      beforeEach(async () => {
        const staticTickets = [
          { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)], bonusball: BigInt(9) },
        ];
        
        if (updateTicketPrice) {
          await jackpot.setTicketPrice(usdc(.5));
        }

        const totalDays = BigInt(2);
        totalCost = totalDays * usdc(2);
        await usdcMock.connect(payer.wallet).approve(jackpotAutoSubscription.getAddress(), totalCost * BigInt(2));
        await jackpotAutoSubscription.connect(payer.wallet).createSubscription(
          buyerOne.address,
          totalDays,
          BigInt(1),
          staticTickets,
          [referrerOne.address, referrerTwo.address, referrerThree.address],
          [ether(0.3), ether(0.4), ether(0.3)]
        );
  
        subjectSubscriptions = [buyerOne.address];
        subjectCaller = keeper;
      });
  
      async function subject(): Promise<any> {
        return await jackpotAutoSubscription.connect(subjectCaller.wallet).executeSubscriptions(subjectSubscriptions);
      }
  
      it("should update subscription state correctly", async () => {
        await subject();
        const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
        const actualSubscription = actualSubscriptionInfo.subscription;
  
        expect(actualSubscription.remainingUSDC).to.equal(totalCost - usdc(2));
        expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(1));
        expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(1));
      });
  
      it("should generate one static ticket and one dynamic ticket", async () => {
        await subject();
        const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 1);
  
        expect(ticketInfo.length).to.equal(2);
        expect(ticketInfo[0].normals).to.deep.equal([BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)]);
        expect(ticketInfo[0].bonusball).to.equal(BigInt(9));
      });
  
      it("the correct amount of usdc should be transferred to the jackpot", async () => {
        const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
  
        await subject();
        
        const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
  
        expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(2));
      });
  
      it("should emit the SubscriptionExecuted event correctly", async () => {
        const tx = await subject();
        const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 1);
  
        await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionExecuted").withArgs(
          buyerOne.address,
          BigInt(1),
          ticketInfo.map((ticket) => ticket.ticketId),
          BigInt(1),
          BigInt(1)
        );
      });

      describe("when no dynamic tickets are passed", () => {
        beforeEach(async () => {
          const staticTickets = [
            { normals: [BigInt(5), BigInt(6), BigInt(3), BigInt(4), BigInt(29)], bonusball: BigInt(9) },
          ];

          await jackpotAutoSubscription.connect(payer.wallet).createSubscription(
            buyerTwo.address,
            BigInt(2),
            BigInt(0),
            staticTickets,
            [referrerOne.address, referrerTwo.address, referrerThree.address],
            [ether(0.3), ether(0.4), ether(0.3)]
          );

          subjectSubscriptions = [buyerTwo.address];
        });
  
        it("should update subscription state correctly", async () => {
          await subject();
          const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          const actualSubscription = actualSubscriptionInfo.subscription;
    
          expect(actualSubscription.remainingUSDC).to.equal(usdc(1));
          expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(1));
          expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(1));
        });
    
        it("should generate one static ticket", async () => {
          await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerTwo.address, 1);
    
          expect(ticketInfo.length).to.equal(1);
          expect(ticketInfo[0].normals).to.deep.equal([BigInt(3), BigInt(4), BigInt(5), BigInt(6), BigInt(29)]);
          expect(ticketInfo[0].bonusball).to.equal(BigInt(9));
        });
    
        it("the correct amount of usdc should be transferred to the jackpot", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(1));
        });
    
        it("should emit the SubscriptionExecuted event correctly", async () => {
          const tx = await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerTwo.address, 1);
    
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionExecuted").withArgs(
            buyerTwo.address,
            BigInt(1),
            ticketInfo.map((ticket) => ticket.ticketId),
            BigInt(0),
            BigInt(1)
          );
        });
      });

      describe("when no static tickets are passed", () => {
        beforeEach(async () => {
          await jackpotAutoSubscription.connect(payer.wallet).createSubscription(
            buyerTwo.address,
            BigInt(2),
            BigInt(1),
            [],
            [referrerOne.address, referrerTwo.address, referrerThree.address],
            [ether(0.3), ether(0.4), ether(0.3)]
          );

          subjectSubscriptions = [buyerTwo.address];
        });
  
        it("should update subscription state correctly", async () => {
          await subject();
          const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          const actualSubscription = actualSubscriptionInfo.subscription;
    
          expect(actualSubscription.remainingUSDC).to.equal(usdc(1));
          expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(1));
          expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(1));
        });
    
        it("should generate one dynamic ticket", async () => {
          await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerTwo.address, 1);
    
          expect(ticketInfo.length).to.equal(1);
        });
    
        it("the correct amount of usdc should be transferred to the jackpot", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(1));
        });
    
        it("should emit the SubscriptionExecuted event correctly", async () => {
          const tx = await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerTwo.address, 1);
    
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionExecuted").withArgs(
            buyerTwo.address,
            BigInt(1),
            ticketInfo.map((ticket) => ticket.ticketId),
            BigInt(1),
            BigInt(0)
          );
        });
      });

      describe("when the total ticket count is greater than the batch purchase facilitator minimum ticket count limit", () => {
        beforeEach(async () => {
          await usdcMock.connect(payer.wallet).approve(jackpotAutoSubscription.getAddress(), usdc(15));
          await jackpotAutoSubscription.connect(payer.wallet).createSubscription(
            buyerTwo.address,
            BigInt(2),
            BigInt(6),
            [],
            [],
            []
          );

          subjectSubscriptions = [buyerTwo.address];
        });

        it("should update subscription state correctly", async () => {
          await subject();
          const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          const actualSubscription = actualSubscriptionInfo.subscription;
    
          expect(actualSubscription.remainingUSDC).to.equal(usdc(6));
          expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(1));
          expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(1));
        });
    
        it("the correct amount of usdc should be transferred to the batch purchase facilitator", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
          const preBatchPurchaseFacilitatorBalance = await usdcMock.balanceOf(await batchPurchaseFacilitator.getAddress());
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
          const postBatchPurchaseFacilitatorBalance = await usdcMock.balanceOf(await batchPurchaseFacilitator.getAddress());
    
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(6));
          expect(postBatchPurchaseFacilitatorBalance).to.equal(preBatchPurchaseFacilitatorBalance + usdc(6));
        });

        it("should create a batch order successfully", async () => {
          await subject();
    
          const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerTwo.address);
          expect(batchOrder.batchOrder.orderDrawingId).to.equal(await jackpot.currentDrawingId());
          expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(6));
          expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(6));
          expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(6));
          expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(6));
          expect(batchOrder.batchOrder.referrers).to.deep.equal([]);
          expect(batchOrder.batchOrder.referralSplit).to.deep.equal([]);
          expect(batchOrder.staticTickets.length).to.equal(0);
        });

        it("should emit the SubscriptionRoutedToBatch event correctly", async () => {
          const tx = await subject();
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionRoutedToBatch").withArgs(
            buyerTwo.address,
            await jackpot.currentDrawingId(),
            BigInt(6),
            BigInt(0),
            usdc(6)
          );
        });
      });

      describe("when the total ticket count is equal to batch purchase facilitator minimum ticket count and includes static tickets", () => {
        beforeEach(async () => {
          const staticTickets = [
            { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)], bonusball: BigInt(9) },
          ];

          await usdcMock.connect(payer.wallet).approve(jackpotAutoSubscription.getAddress(), usdc(15));
          await jackpotAutoSubscription.connect(payer.wallet).createSubscription(
            buyerTwo.address,
            BigInt(2),
            BigInt(4),
            staticTickets,
            [],
            []
          );

          subjectSubscriptions = [buyerTwo.address];
        });

        it("should update subscription state correctly", async () => {
          await subject();
          const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          const actualSubscription = actualSubscriptionInfo.subscription;
    
          expect(actualSubscription.remainingUSDC).to.equal(usdc(5));
          expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(1));
          expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(1));
        });
    
        it("the correct amount of usdc should be transferred to the batch purchase facilitator", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
          const preBatchPurchaseFacilitatorBalance = await usdcMock.balanceOf(await batchPurchaseFacilitator.getAddress());
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
          const postBatchPurchaseFacilitatorBalance = await usdcMock.balanceOf(await batchPurchaseFacilitator.getAddress());
    
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(5));
          expect(postBatchPurchaseFacilitatorBalance).to.equal(preBatchPurchaseFacilitatorBalance + usdc(5));
        });

        it("should create a batch order successfully", async () => {
          await subject();
    
          const batchOrder = await batchPurchaseFacilitator.getBatchOrderInfo(buyerTwo.address);
          expect(batchOrder.batchOrder.orderDrawingId).to.equal(await jackpot.currentDrawingId());
          expect(batchOrder.batchOrder.remainingUSDC).to.equal(usdc(5));
          expect(batchOrder.batchOrder.remainingTickets).to.equal(BigInt(5));
          expect(batchOrder.batchOrder.totalTicketsOrdered).to.equal(BigInt(5));
          expect(batchOrder.batchOrder.dynamicTicketCount).to.equal(BigInt(4));
          expect(batchOrder.batchOrder.referrers).to.deep.equal([]);
          expect(batchOrder.batchOrder.referralSplit).to.deep.equal([]);
          expect(batchOrder.staticTickets.length).to.equal(1);
          expect(batchOrder.staticTickets[0].normals).to.deep.equal([BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)]);
          expect(batchOrder.staticTickets[0].bonusball).to.equal(BigInt(9));
        });

        it("should emit the SubscriptionRoutedToBatch event correctly", async () => {
          const tx = await subject();
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionRoutedToBatch").withArgs(
            buyerTwo.address,
            await jackpot.currentDrawingId(),
            BigInt(4),
            BigInt(1),
            usdc(5)
          );
        });
      });

      describe("when the execution action is EXECUTE_AND_CLOSE", () => {
        beforeEach(async () => {
          await subject();
  
          await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));
          const drawingState = await jackpot.getDrawingState(1);
          await jackpot.connect(owner.wallet).runJackpot(
            { value: jackpotSystem.deploymentParams.entropyFee + ((jackpotSystem.deploymentParams.entropyBaseGasLimit + jackpotSystem.deploymentParams.entropyVariableGasLimit * drawingState.bonusballMax) * BigInt(1e7)) }
          );
          await entropyProvider.connect(owner.wallet).randomnessCallback([[BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], [BigInt(2)]]);
        });
  
        it("should clear the subscription state correctly", async () => {
          await subject();
          const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          const actualSubscription = actualSubscriptionInfo.subscription;
    
          expect(actualSubscription.remainingUSDC).to.equal(BigInt(0));
          expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(0));
          expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(0));
        });
    
        it("the correct amount of usdc should be transferred to the jackpot", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(2));
        });
  
        it("should generate one static ticket and one dynamic ticket", async () => {
          await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 2);
  
          expect(ticketInfo.length).to.equal(2);
          expect(ticketInfo[0].normals).to.deep.equal([BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)]);
          expect(ticketInfo[0].bonusball).to.equal(BigInt(9));
        });
    
        it("should emit the SubscriptionExecuted event correctly", async () => {
          const tx = await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 2);
    
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionExecuted").withArgs(
            buyerOne.address,
            BigInt(2),
            ticketInfo.map((ticket) => ticket.ticketId),
            BigInt(1),
            BigInt(1)
          );
        });
  
        it("should emit the SubscriptionRemoved event correctly", async () => {
          await expect(subject()).to.emit(jackpotAutoSubscription, "SubscriptionRemoved").withArgs(buyerOne.address);
        });
      });
  
      describe("when multiple subscriptions are passed", () => {
        beforeEach(async () => {
          const staticTickets = [
            { normals: [BigInt(6), BigInt(7), BigInt(8), BigInt(9), BigInt(10)], bonusball: BigInt(4) },
          ];
    
          const totalDays = BigInt(2);
          const totalCostBuyerTwo = totalDays * usdc(2);
          await usdcMock.connect(payer.wallet).approve(jackpotAutoSubscription.getAddress(), totalCostBuyerTwo);
          await jackpotAutoSubscription.connect(payer.wallet).createSubscription(
            buyerTwo.address,
            totalDays,
            BigInt(1),
            staticTickets,
            [],
            []
          );
  
          subjectSubscriptions = [buyerOne.address, buyerTwo.address];
        });
  
        it("should update subscription state correctly", async () => {
          await subject();
          const actualSubscriptionOneInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          const actualSubscriptionOne = actualSubscriptionOneInfo.subscription;
          const actualSubscriptionTwoInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[1]);
          const actualSubscriptionTwo = actualSubscriptionTwoInfo.subscription;
    
          expect(actualSubscriptionOne.remainingUSDC).to.equal(totalCost - usdc(2));
          expect(actualSubscriptionOne.lastExecutedDrawing).to.equal(BigInt(1));
          expect(actualSubscriptionOne.subscribedTicketPrice).to.equal(usdc(1));
          expect(actualSubscriptionTwo.remainingUSDC).to.equal(totalCost - usdc(2));
          expect(actualSubscriptionTwo.lastExecutedDrawing).to.equal(BigInt(1));
          expect(actualSubscriptionTwo.subscribedTicketPrice).to.equal(usdc(1));
        });
    
        it("should generate one static ticket and one dynamic ticket", async () => {
          await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 1);
          const ticketInfoTwo = await jackpotNFT.getUserTickets(buyerTwo.address, 1);
    
          expect(ticketInfo.length).to.equal(2);
          expect(ticketInfo[0].normals).to.deep.equal([BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)]);
          expect(ticketInfo[0].bonusball).to.equal(BigInt(9));
          expect(ticketInfoTwo.length).to.equal(2);
          expect(ticketInfoTwo[0].normals).to.deep.equal([BigInt(6), BigInt(7), BigInt(8), BigInt(9), BigInt(10)]);
          expect(ticketInfoTwo[0].bonusball).to.equal(BigInt(4));
        });
    
        it("the correct amount of usdc should be transferred to the jackpot", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(2) - usdc(2));
        });
    
        it("should emit the SubscriptionExecuted event correctly", async () => {
          const tx = await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 1);
          const ticketInfoTwo = await jackpotNFT.getUserTickets(buyerTwo.address, 1);
  
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionExecuted").withArgs(
            buyerOne.address,
            BigInt(1),
            ticketInfo.map((ticket) => ticket.ticketId),
            BigInt(1),
            BigInt(1)
          );
  
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionExecuted").withArgs(
            buyerTwo.address,
            BigInt(1),
            ticketInfoTwo.map((ticket) => ticket.ticketId),
            BigInt(1),
            BigInt(1)
          );
        });
      });

      describe("when multiple subscriptions are passed but one is not active", () => {
        beforeEach(async () => {  
          subjectSubscriptions = [buyerOne.address, buyerThree.address];
        });
  
        it("should update subscription state correctly", async () => {
          await subject();
          const actualSubscriptionOneInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          const actualSubscriptionOne = actualSubscriptionOneInfo.subscription;
    
          expect(actualSubscriptionOne.remainingUSDC).to.equal(totalCost - usdc(2));
          expect(actualSubscriptionOne.lastExecutedDrawing).to.equal(BigInt(1));
          expect(actualSubscriptionOne.subscribedTicketPrice).to.equal(usdc(1));
        });
    
        it("should generate one static ticket and one dynamic ticket", async () => {
          await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 1);
    
          expect(ticketInfo.length).to.equal(2);
          expect(ticketInfo[0].normals).to.deep.equal([BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)]);
          expect(ticketInfo[0].bonusball).to.equal(BigInt(9));
        });
    
        it("the correct amount of usdc should be transferred to the jackpot", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(2));
        });
    
        it("should emit the SubscriptionExecuted event correctly", async () => {
          const tx = await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 1);
          const ticketInfoTwo = await jackpotNFT.getUserTickets(buyerTwo.address, 1);
  
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionExecuted").withArgs(
            buyerOne.address,
            BigInt(1),
            ticketInfo.map((ticket) => ticket.ticketId),
            BigInt(1),
            BigInt(1)
          );
  
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionSkipped").withArgs(
            buyerThree.address,
            BigInt(1),
            ExecutionAction.SKIP_NO_ACTIVE_SUBSCRIPTION
          );
        });
      });
  
      describe("when the one of the normal balls is greater than the normal ball max", () => {
        beforeEach(async () => {
          await subject();
          await jackpot.setNormalBallMax(BigInt(25));
          await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));
          const drawingState = await jackpot.getDrawingState(1);
          await jackpot.connect(owner.wallet).runJackpot(
            { value: jackpotSystem.deploymentParams.entropyFee + ((jackpotSystem.deploymentParams.entropyBaseGasLimit + jackpotSystem.deploymentParams.entropyVariableGasLimit * drawingState.bonusballMax) * BigInt(1e7)) }
          );
          await entropyProvider.connect(owner.wallet).randomnessCallback([[BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], [BigInt(2)]]);
        });
  
        it("the correct amount of usdc should be transferred to the jackpot", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(2));
        });
  
        it("should generate two dynamic tickets", async () => {
          await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 2);
  
          expect(ticketInfo.length).to.equal(2);
          expect(ticketInfo[0].normals).to.not.deep.equal([BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)]);
          expect(ticketInfo[1].normals).to.not.deep.equal([BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)]);
        });
    
        it("should emit the SubscriptionExecuted event correctly", async () => {
          const tx = await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 2);
    
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionExecuted").withArgs(
            buyerOne.address,
            BigInt(2),
            ticketInfo.map((ticket) => ticket.ticketId),
            BigInt(2),
            BigInt(0)
          );
        });
      });
  
      describe("when the one of the bonusballs is greater than the bonusball max", () => {
        beforeEach(async () => {
          await subject();
          await jackpot.setNormalBallMax(BigInt(35));
          await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));
          const drawingState = await jackpot.getDrawingState(1);
          await jackpot.connect(owner.wallet).runJackpot(
            { value: jackpotSystem.deploymentParams.entropyFee + ((jackpotSystem.deploymentParams.entropyBaseGasLimit + jackpotSystem.deploymentParams.entropyVariableGasLimit * drawingState.bonusballMax) * BigInt(1e7)) }
          );
          await entropyProvider.connect(owner.wallet).randomnessCallback([[BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], [BigInt(2)]]);
        });
  
        it("the correct amount of usdc should be transferred to the jackpot", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
    
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(2));
        });
  
        it("should generate two dynamic tickets", async () => {
          await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 2);
  
          expect(ticketInfo.length).to.equal(2);
          expect(ticketInfo[0].normals).to.not.deep.equal([BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)]);
          expect(ticketInfo[1].normals).to.not.deep.equal([BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)]);
        });
    
        it("should emit the SubscriptionExecuted event correctly", async () => {
          const tx = await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerOne.address, 2);
    
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionExecuted").withArgs(
            buyerOne.address,
            BigInt(2),
            ticketInfo.map((ticket) => ticket.ticketId),
            BigInt(2),
            BigInt(0)
          );
        });
      });
  
      describe("when the ticket price changed for the current drawing", () => {
        beforeEach(async () => {
          await subject();
          await jackpot.setTicketPrice(usdc(3));
          await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));
          const drawingState = await jackpot.getDrawingState(1);
          await jackpot.connect(owner.wallet).runJackpot(
            { value: jackpotSystem.deploymentParams.entropyFee + ((jackpotSystem.deploymentParams.entropyBaseGasLimit + jackpotSystem.deploymentParams.entropyVariableGasLimit * drawingState.bonusballMax) * BigInt(1e7)) }
          );
          await entropyProvider.connect(owner.wallet).randomnessCallback([[BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], [BigInt(2)]]);
        });
  
        it("should clear the subscription state correctly", async () => {
          await subject();
          const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          const actualSubscription = actualSubscriptionInfo.subscription;
    
          expect(actualSubscription.remainingUSDC).to.equal(BigInt(0));
          expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(0));
          expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(0));
        });
    
        it("the correct amount of usdc should be transferred to the user", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
          const preUserBalance = await usdcMock.balanceOf(buyerOne.address);
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
          const postUserBalance = await usdcMock.balanceOf(buyerOne.address);
    
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(2));
          expect(postUserBalance).to.equal(preUserBalance + usdc(2));
        });
    
        it("should emit the SubscriptionCancelled event correctly", async () => {
          await expect(subject()).to.emit(jackpotAutoSubscription, "SubscriptionCancelled").withArgs(
            buyerOne.address,
            ExecutionAction.CANCEL_PRICE_CHANGE,
            usdc(2)
          );
        });
      });

      describe("when the max referrer count is exceeded by a prior subscription", () => {
        beforeEach(async () => {
          await jackpot.connect(owner.wallet).setMaxReferrers(1);
          subjectSubscriptions = [buyerOne.address];
        });
  
        it("should clear the subscription state correctly", async () => {
          await subject();
          const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          const actualSubscription = actualSubscriptionInfo.subscription;
    
          expect(actualSubscription.remainingUSDC).to.equal(BigInt(0));
          expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(0));
          expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(0));
        });
    
        it("the correct amount of usdc should be transferred to the user", async () => {
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
          const preUserBalance = await usdcMock.balanceOf(buyerOne.address);
    
          await subject();
          
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
          const postUserBalance = await usdcMock.balanceOf(buyerOne.address);
          
          // Full refund of sub since no execution ever took place
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - usdc(4));
          expect(postUserBalance).to.equal(preUserBalance + usdc(4));
        });
    
        it("should emit the SubscriptionCancelled event correctly", async () => {
          await expect(subject()).to.emit(jackpotAutoSubscription, "SubscriptionCancelled").withArgs(
            buyerOne.address,
            ExecutionAction.CANCEL_TOO_MANY_REFERREES,
            usdc(4) // Full refund of sub since no execution ever took place
          );
        });
      });

      describe("when the total ticket count is equal to the batch purchase facilitator minimum ticket count limit but there is an active batch order", () => {
        beforeEach(async () => {
          const staticTickets = [
            { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)], bonusball: BigInt(9) },
          ];

          await usdcMock.connect(payer.wallet).approve(jackpotAutoSubscription.getAddress(), usdc(15));
          await jackpotAutoSubscription.connect(payer.wallet).createSubscription(
            buyerTwo.address,
            BigInt(2),
            BigInt(4),
            staticTickets,
            [],
            []
          );

          subjectSubscriptions = [buyerTwo.address];

          await usdcMock.connect(payer.wallet).approve(batchPurchaseFacilitator.getAddress(), usdc(10));
          await batchPurchaseFacilitator.connect(payer.wallet).createBatchOrder(
            buyerTwo.address,
            BigInt(10),
            [],
            [],
            []
          );
        });

        it("should skip the subscription and not update any state", async () => {
          const preActualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
  
          await subject();
  
          const postActualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          expect(postActualSubscriptionInfo.subscription.lastExecutedDrawing).to.equal(preActualSubscriptionInfo.subscription.lastExecutedDrawing);
          expect(postActualSubscriptionInfo.subscription.remainingUSDC).to.equal(preActualSubscriptionInfo.subscription.remainingUSDC);
          expect(postActualSubscriptionInfo.subscription.subscribedTicketPrice).to.equal(preActualSubscriptionInfo.subscription.subscribedTicketPrice);
        });
  
        it("should emit the SubscriptionSkipped event correctly", async () => {
          await expect(subject()).to.emit(jackpotAutoSubscription, "SubscriptionSkipped").withArgs(
            subjectSubscriptions[0], 
            BigInt(1),
            ExecutionAction.SKIP_ACTIVE_BATCH_ORDER
          );
        });
      });
  
      describe("when the subscription has already been executed this drawing", () => {
        beforeEach(async () => {
          await subject();
        });
  
        it("should skip the subscription and not update any state", async () => {
          const preActualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
  
          await subject();
  
          const postActualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          expect(postActualSubscriptionInfo.subscription.lastExecutedDrawing).to.equal(preActualSubscriptionInfo.subscription.lastExecutedDrawing);
          expect(postActualSubscriptionInfo.subscription.remainingUSDC).to.equal(preActualSubscriptionInfo.subscription.remainingUSDC);
          expect(postActualSubscriptionInfo.subscription.subscribedTicketPrice).to.equal(preActualSubscriptionInfo.subscription.subscribedTicketPrice);
        });
  
        it("should emit the SubscriptionSkipped event correctly", async () => {
          await expect(subject()).to.emit(jackpotAutoSubscription, "SubscriptionSkipped").withArgs(
            subjectSubscriptions[0], 
            BigInt(1),
            ExecutionAction.SKIP_ALREADY_EXECUTED
          );
        });
      });

      describe("when a new subscription is created with a different ticket price", () => {
        before(async () => {
          updateTicketPrice = true;
        });

        after(async () => {
          updateTicketPrice = false;
        });
  
        it("should skip the subscription and not update any state", async () => {
          const preActualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
  
          await subject();
  
          const postActualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          expect(postActualSubscriptionInfo.subscription.lastExecutedDrawing).to.equal(preActualSubscriptionInfo.subscription.lastExecutedDrawing);
          expect(postActualSubscriptionInfo.subscription.remainingUSDC).to.equal(preActualSubscriptionInfo.subscription.remainingUSDC);
          expect(postActualSubscriptionInfo.subscription.subscribedTicketPrice).to.equal(preActualSubscriptionInfo.subscription.subscribedTicketPrice);
        });
  
        it("should emit the SubscriptionSkipped event correctly", async () => {
          await expect(subject()).to.emit(jackpotAutoSubscription, "SubscriptionSkipped").withArgs(
            subjectSubscriptions[0], 
            BigInt(1),
            ExecutionAction.SKIP_ALREADY_EXECUTED
          );
        });
      });
  
      describe("when the the passed address has no active subscription", () => {
        beforeEach(async () => {
          subjectSubscriptions = [buyerTwo.address];
        });
  
        it("should skip the subscription and not update any state", async () => {
          const preActualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
  
          await subject();
  
          const postActualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          expect(postActualSubscriptionInfo.subscription.lastExecutedDrawing).to.equal(preActualSubscriptionInfo.subscription.lastExecutedDrawing);
          expect(postActualSubscriptionInfo.subscription.remainingUSDC).to.equal(preActualSubscriptionInfo.subscription.remainingUSDC);
          expect(postActualSubscriptionInfo.subscription.subscribedTicketPrice).to.equal(preActualSubscriptionInfo.subscription.subscribedTicketPrice);
        });
  
        it("should emit the SubscriptionSkipped event correctly", async () => {
          await expect(subject()).to.emit(jackpotAutoSubscription, "SubscriptionSkipped").withArgs(
            subjectSubscriptions[0],
            BigInt(1),
            ExecutionAction.SKIP_NO_ACTIVE_SUBSCRIPTION
          );
        });
      });

      describe("executing two orders one that is being cancelled and one that is being executed", () => {
        beforeEach(async () => {
          await jackpot.setTicketPrice(usdc(3));
          await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));
          const drawingState = await jackpot.getDrawingState(1);
          await jackpot.connect(owner.wallet).runJackpot(
            { value: jackpotSystem.deploymentParams.entropyFee + ((jackpotSystem.deploymentParams.entropyBaseGasLimit + jackpotSystem.deploymentParams.entropyVariableGasLimit * drawingState.bonusballMax) * BigInt(1e7)) }
          );
          await entropyProvider.connect(owner.wallet).randomnessCallback([[BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], [BigInt(2)]]);

          await usdcMock.connect(payer.wallet).approve(jackpotAutoSubscription.getAddress(), usdc(6));
          await jackpotAutoSubscription.connect(payer.wallet).createSubscription(
            buyerThree.address,
            BigInt(2),
            BigInt(1),
            [],
            [referrerOne.address, referrerTwo.address, referrerThree.address],
            [ether(0.3), ether(0.4), ether(0.3)]
          );
          subjectSubscriptions = [buyerOne.address, buyerThree.address];
        });

        it("should cancel the subscription and refund the user", async () => {
          await subject();
          const actualSubscriptionInfo = await jackpotAutoSubscription.getSubscriptionInfo(subjectSubscriptions[0]);
          const actualSubscription = actualSubscriptionInfo.subscription;

          expect(actualSubscription.remainingUSDC).to.equal(BigInt(0));
          expect(actualSubscription.lastExecutedDrawing).to.equal(BigInt(0));
          expect(actualSubscription.subscribedTicketPrice).to.equal(usdc(0));
        });

        it("should transfer the remaining USDC to the user", async () => {
          const preUserBalance = await usdcMock.balanceOf(buyerOne.address);
          const preSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
          const preJackpotBalance = await usdcMock.balanceOf(await jackpot.getAddress());

          await subject();

          const postUserBalance = await usdcMock.balanceOf(buyerOne.address);
          const postSubscriptionBalance = await usdcMock.balanceOf(await jackpotAutoSubscription.getAddress());
          const postJackpotBalance = await usdcMock.balanceOf(await jackpot.getAddress());
          
          // No execution ever done so full balance refunded
          const contractFlow = usdc(4) + usdc(3);
          expect(postUserBalance).to.equal(preUserBalance + usdc(4));
          expect(postSubscriptionBalance).to.equal(preSubscriptionBalance - contractFlow);
          expect(postJackpotBalance).to.equal(preJackpotBalance + usdc(3));
        });

        it("should emit the SubscriptionCancelled event correctly", async () => {
          const tx = await subject();
          const ticketInfo = await jackpotNFT.getUserTickets(buyerThree.address, 2);

          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionCancelled").withArgs(
            buyerOne.address,
            ExecutionAction.CANCEL_PRICE_CHANGE,
            usdc(4) // No execution ever done so full balance refunded
          );
          await expect(tx).to.emit(jackpotAutoSubscription, "SubscriptionExecuted").withArgs(
            buyerThree.address,
            BigInt(2),
            ticketInfo.map((ticket) => ticket.ticketId),
            BigInt(1),
            BigInt(0)
          );
        });
      });
  
      describe("when the reentrancy protection is violated", async () => {
        beforeEach(async () => {
          await usdcMock.setCallbackTarget(await jackpotAutoSubscription.getAddress());
          const callbackData = jackpotAutoSubscription.interface.encodeFunctionData(
            "executeSubscriptions",
            [subjectSubscriptions]
          );
          await usdcMock.setCallbackData(callbackData);
          await usdcMock.enableCallback();
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ReentrancyGuardReentrantCall");
        });
      });
  
      describe("when the caller is not a keeper", () => {
        beforeEach(async () => {
          subjectCaller = owner;
        });
  
        it("should revert", async () => {
          await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "NotAllowed");
        });
      });
    });

    describe("#getSubscriptionsAction", () => {
      let subjectSubscriptions: Address[];
  
      beforeEach(async () => {
        const staticTickets = [
          { normals: [BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(30)], bonusball: BigInt(9) },
        ];
  
        const totalDays = BigInt(2);
        const totalCost = totalDays * usdc(2);
        await usdcMock.connect(payer.wallet).approve(jackpotAutoSubscription.getAddress(), totalCost);
        await jackpotAutoSubscription.connect(payer.wallet).createSubscription(
          buyerOne.address,
          totalDays,
          BigInt(1),
          staticTickets,
          [referrerOne.address, referrerTwo.address, referrerThree.address],
          [ether(0.3), ether(0.4), ether(0.3)]
        );
  
        subjectSubscriptions = [buyerOne.address];
      });
  
      async function subject(): Promise<any> {
        return await jackpotAutoSubscription.getSubscriptionsAction(subjectSubscriptions);
      }
  
      it("should return the execution action for the subscription", async () => {
        const executionAction = await subject();
        expect(executionAction[0]).to.equal(ExecutionAction.EXECUTE);
      });

      describe("when the execution action is EXECUTE_AND_CLOSE", () => {
        beforeEach(async () => {
          await jackpotAutoSubscription.connect(keeper.wallet).executeSubscriptions(subjectSubscriptions);
  
          await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));
          const drawingState = await jackpot.getDrawingState(1);
          await jackpot.connect(owner.wallet).runJackpot(
            { value: jackpotSystem.deploymentParams.entropyFee + ((jackpotSystem.deploymentParams.entropyBaseGasLimit + jackpotSystem.deploymentParams.entropyVariableGasLimit * drawingState.bonusballMax) * BigInt(1e7)) }
          );
          await entropyProvider.connect(owner.wallet).randomnessCallback([[BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], [BigInt(2)]]);
        });

        it("should return the execution action for the subscription", async () => {
          const executionAction = await subject();
          expect(executionAction[0]).to.equal(ExecutionAction.EXECUTE_AND_CLOSE);
        });
      });

      describe("when the execution action is SKIP_ALREADY_EXECUTED", () => {
        beforeEach(async () => {
          await jackpotAutoSubscription.connect(keeper.wallet).executeSubscriptions(subjectSubscriptions);
        });

        it("should return the execution action for the subscription", async () => {
          const executionAction = await subject();
          expect(executionAction[0]).to.equal(ExecutionAction.SKIP_ALREADY_EXECUTED);
        });
      });

      describe("when the execution action is SKIP_NO_ACTIVE_SUBSCRIPTION", () => {
        beforeEach(async () => {
          subjectSubscriptions = [buyerTwo.address];
        });

        it("should return the execution action for the subscription", async () => {
          const executionAction = await subject();
          expect(executionAction[0]).to.equal(ExecutionAction.SKIP_NO_ACTIVE_SUBSCRIPTION);
        });
      });

      describe("when the execution action is CANCEL_PRICE_CHANGE", () => {
        beforeEach(async () => {
          await jackpot.setTicketPrice(usdc(3));
          await time.increase(jackpotSystem.deploymentParams.drawingDurationInSeconds + BigInt(1));
          const drawingState = await jackpot.getDrawingState(1);
          await jackpot.connect(owner.wallet).runJackpot(
            { value: jackpotSystem.deploymentParams.entropyFee + ((jackpotSystem.deploymentParams.entropyBaseGasLimit + jackpotSystem.deploymentParams.entropyVariableGasLimit * drawingState.bonusballMax) * BigInt(1e7)) }
          );
          await entropyProvider.connect(owner.wallet).randomnessCallback([[BigInt(1), BigInt(2), BigInt(3), BigInt(4), BigInt(5)], [BigInt(2)]]);
        });

        it("should return the execution action for the subscription", async () => {
          const executionAction = await subject();
          expect(executionAction[0]).to.equal(ExecutionAction.CANCEL_PRICE_CHANGE);
        });
      });

      describe("when the execution action is CANCEL_TOO_MANY_REFERREES", () => {
        beforeEach(async () => {
          await jackpot.connect(owner.wallet).setMaxReferrers(1);
          subjectSubscriptions = [buyerOne.address];
        });

        it("should return the execution action for the subscription", async () => {
          const executionAction = await subject();
          expect(executionAction[0]).to.equal(ExecutionAction.CANCEL_TOO_MANY_REFERREES);
        });
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
      return await jackpotAutoSubscription.connect(subjectCaller.wallet).setBatchPurchaseFacilitator(subjectBatchPurchaseFacilitator);
    }

    it("should set the batch purchase facilitator correctly", async () => {
      await subject();
      expect(await jackpotAutoSubscription.batchFacilitator()).to.equal(subjectBatchPurchaseFacilitator);
    });

    it("should emit the BatchPurchaseFacilitatorSet event correctly", async () => {
      await expect(subject()).to.emit(jackpotAutoSubscription, "BatchPurchaseFacilitatorSet").withArgs(subjectBatchPurchaseFacilitator);
    });

    describe("when the batch purchase facilitator address is the zero address", () => {
      beforeEach(async () => {
        subjectBatchPurchaseFacilitator = ADDRESS_ZERO;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ZeroAddress");
      });
    });

    describe("when the caller is not the owner", () => {
      beforeEach(async () => {
        subjectCaller = payer;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "OwnableUnauthorizedAccount");
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
      return await jackpotAutoSubscription.connect(subjectCaller.wallet).addAllowed(subjectAllowed);
    }

    it("should add the keeper correctly", async () => {
      await subject();

      const isAllowed = await jackpotAutoSubscription.isAllowed(subjectAllowed);
      const keepers = await jackpotAutoSubscription.getAllowed();

      expect(isAllowed).to.be.true;
      expect(keepers).to.contain(subjectAllowed);
    });

    it("should emit the AllowedAdded event correctly", async () => {
      await expect(subject()).to.emit(jackpotAutoSubscription, "AllowedAdded").withArgs(subjectAllowed);
    });

    describe("when the keeper is already added", () => {
      beforeEach(async () => {
        subjectAllowed = keeper.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "AllowedAlreadyAdded");
      });
    });

    describe("when the keeper is the zero address", () => {
      beforeEach(async () => {
        subjectAllowed = ADDRESS_ZERO;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ZeroAddress");
      });
    });

    describe("when the caller is not the owner", () => {
      beforeEach(async () => {
        subjectCaller = payer;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "OwnableUnauthorizedAccount");
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
      return await jackpotAutoSubscription.connect(subjectCaller.wallet).removeAllowed(subjectAllowed);
    }

    it("should remove the keeper correctly", async () => {
      await subject();

      const isAllowed = await jackpotAutoSubscription.isAllowed(subjectAllowed);
      const keepers = await jackpotAutoSubscription.getAllowed();

      expect(isAllowed).to.be.false;
      expect(keepers).to.not.contain(subjectAllowed);
    });

    it("should emit the AllowedRemoved event correctly", async () => {
      await expect(subject()).to.emit(jackpotAutoSubscription, "AllowedRemoved").withArgs(subjectAllowed);
    });

    describe("when the keeper is already removed", () => {
      beforeEach(async () => {
        subjectAllowed = keeperTwo.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "AllowedNotFound");
      });
    });

    describe("when the keeper is the zero address", () => {
      beforeEach(async () => {
        subjectAllowed = ADDRESS_ZERO;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "ZeroAddress");
      });
    });

    describe("when the caller is not the owner", () => {
      beforeEach(async () => {
        subjectCaller = payer;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(jackpotAutoSubscription, "OwnableUnauthorizedAccount");
      });
    });
  });
});