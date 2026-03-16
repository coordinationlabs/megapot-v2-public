import { getWaffleExpect, getAccounts } from "@utils/test";
import { ether } from "@utils/common";
import { Account } from "@utils/test";
import DeployHelper from "@utils/deploys";
import { Address } from "@utils/types";

import {
  BuyTicketsHelpersTester,
  MockJackpot,
} from "@utils/contracts";

import { ADDRESS_ZERO } from "@utils/constants";

const expect = getWaffleExpect();

describe("BuyTicketsHelpers", () => {
  let owner: Account;
  let user: Account;
  let ref1: Account;
  let ref2: Account;
  let ref3: Account;

  let deployer: DeployHelper;
  let tester: BuyTicketsHelpersTester;
  let mockJackpot: MockJackpot;

  beforeEach(async () => {
    [owner, user, ref1, ref2, ref3] = await getAccounts();
    deployer = new DeployHelper(owner.wallet);
    tester = await deployer.deployBuyTicketsHelpersTester();
    mockJackpot = await deployer.deployMockJackpot();
    await mockJackpot.setMaxReferrers(BigInt(3));
  });

  describe("#validateReferrers", () => {
    let subjectJackpot: Address;
    let subjectReferrers: Address[];
    let subjectSplits: bigint[];

    beforeEach(async () => {
      subjectJackpot = await mockJackpot.getAddress();
      subjectReferrers = [ref1.address, ref2.address, ref3.address];
      subjectSplits = [ether(0.3), ether(0.4), ether(0.3)];
    });

    async function subject(): Promise<any> {
      return await tester.validateReferrers(subjectJackpot, subjectReferrers, subjectSplits);
    }

    it("should pass with valid inputs", async () => {
      await subject();
    });

    describe("when split lengths mismatch", () => {
      beforeEach(async () => {
        subjectReferrers = [ref1.address, ref2.address];
        subjectSplits = [ether(0.3), ether(0.4), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "ReferralSplitLengthMismatch");
      });
    });

    describe("when referrers exceed maxReferrers", () => {
      beforeEach(async () => {
        await mockJackpot.setMaxReferrers(BigInt(2));
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "TooManyReferrers");
      });
    });

    describe("when any referrer is zero address", () => {
      beforeEach(async () => {
        subjectReferrers = [ADDRESS_ZERO, ref2.address];
        subjectSplits = [ether(0.5), ether(0.5)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "ZeroAddress");
      });
    });

    describe("when any split is zero", () => {
      beforeEach(async () => {
        subjectReferrers = [ref1.address, ref2.address];
        subjectSplits = [ether(0), ether(1)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "InvalidReferralSplitBps");
      });
    });

    describe("when split sum is not 1.0", () => {
      beforeEach(async () => {
        subjectSplits = [ether(0.2), ether(0.4), ether(0.3)];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "ReferralSplitSumInvalid");
      });
    });
  });

  describe("#validateTickets", () => {
    let subjectTickets: any[];
    let subjectNormalMax: number;
    let subjectBonusMax: number;
    let subjectCaller: Address;

    beforeEach(async () => {
      subjectTickets = [
        { normals: [1,2,3,4,5].map(BigInt), bonusball: BigInt(1) },
        { normals: [6,7,8,9,10].map(BigInt), bonusball: BigInt(2) },
      ];
      subjectNormalMax = 30;
      subjectBonusMax = 10;
      subjectCaller = user.address;
    });

    async function subject(): Promise<any> {
      return await tester.validateTickets(subjectTickets, subjectNormalMax, subjectBonusMax, subjectCaller);
    }

    it("should pass with valid static tickets and emit events", async () => {
      await expect(subject())
        .to.emit(tester, "StaticTicketValidated")
        .withArgs(subjectCaller, subjectTickets[0].normals, subjectTickets[0].bonusball)
        .and.to.emit(tester, "StaticTicketValidated")
        .withArgs(subjectCaller, subjectTickets[1].normals, subjectTickets[1].bonusball);
    });

    describe("when normals length != 5", () => {
      beforeEach(async () => {
        subjectTickets = [{ normals: [1,2,3,4,5,6].map(BigInt), bonusball: BigInt(1) }];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "InvalidNormalBallCount");
      });
    });

    describe("when any normal is zero", () => {
      beforeEach(async () => {
        subjectTickets = [{ normals: [0,2,3,4,5].map(BigInt), bonusball: BigInt(1) }];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "InvalidStaticTicket");
      });
    });

    describe("when normal exceeds max", () => {
      beforeEach(async () => {
        subjectTickets = [{ normals: [1,2,3,4,31].map(BigInt), bonusball: BigInt(1) }];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "InvalidStaticTicket");
      });
    });

    describe("when duplicate normals present", () => {
      beforeEach(async () => {
        subjectTickets = [{ normals: [1,2,3,3,5].map(BigInt), bonusball: BigInt(1) }];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "RepeatedNormalBall");
      });
    });

    describe("when bonusball is zero", () => {
      beforeEach(async () => {
        subjectTickets = [{ normals: [1,2,3,4,5].map(BigInt), bonusball: BigInt(0) }];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "InvalidStaticTicket");
      });
    });

    describe("when bonusball exceeds max", () => {
      beforeEach(async () => {
        subjectTickets = [{ normals: [1,2,3,4,5].map(BigInt), bonusball: BigInt(subjectBonusMax + 1) }];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(tester, "InvalidStaticTicket");
      });
    });
  });
});

