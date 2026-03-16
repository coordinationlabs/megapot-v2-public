import { getWaffleExpect, getAccounts } from "@utils/test/index";
import { Account } from "@utils/test";
import { TicketPickerTester } from "@utils/contracts";
import DeployHelper from "@utils/deploys";

import {
  takeSnapshot,
  SnapshotRestorer,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { randomBytes } from "node:crypto";

const expect = getWaffleExpect();

describe("TicketPicker", () => {
  let owner: Account;
  let buyer: Account;
  let ticketPickerTester: TicketPickerTester;
  let snapshot: SnapshotRestorer;

  let deployer: DeployHelper;

  function randomUint256(): bigint {
    return BigInt("0x" + randomBytes(32).toString("hex"));
  }

  beforeEach(async () => {
    [owner, buyer] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    ticketPickerTester = await deployer.deployTicketPickerTester();
    snapshot = await takeSnapshot();
  });

  beforeEach(async () => {
    await snapshot.restore();
  });

  describe("#pickBonusball", () => {
    let subjectSeed: bigint;
    let subjectMax: bigint;

    beforeEach(async () => {
      subjectSeed = randomUint256();
      subjectMax = BigInt(42);
    });

    async function subject(fixSeed: boolean = false): Promise<any> {
      const seed = fixSeed ? subjectSeed : randomUint256();
      return await ticketPickerTester.pickBonusball(seed, subjectMax);
    }

    it("returns a number in [1, max]", async () => {
      const max = BigInt(subjectMax);
      for (let i = 0; i < 1000; i++) {
        const num = await subject();

        expect(num).to.be.gte(1);
        expect(num).to.be.lte(max);
      }
    });

    it("is deterministic for the same seed", async () => {
      const a = await subject(true);
      const b = await subject(true);

      expect(a).to.eq(b);
    });

    it("returns a range of numbers [1, max]", async () => {
      let one = false;
      let max = false;
      let count = 0;
      while (!one || !max) {
        const v = await ticketPickerTester.pickBonusball(randomUint256(), 255);
        count++;
        if (v === 1n) one = true;
        if (v === 255n) max = true;
      }
    });

    describe("when the max is above the range", async () => {
      beforeEach(async () => {
        subjectMax = BigInt(256);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Invalid max");
      });
    });

    describe("when the max is below the range", async () => {
      beforeEach(async () => {
        subjectMax = BigInt(0);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Invalid max");
      });
    });
  });

  describe("#pickSingleTicket", () => {
    let subjectSeed: bigint;
    let subjectNormalMax: bigint;
    let subjectBonusballMax: bigint;

    beforeEach(async () => {
      subjectSeed = randomUint256();
      subjectNormalMax = BigInt(42);
      subjectBonusballMax = BigInt(10);
    });

    async function subject(fixSeed: boolean = false): Promise<any> {
      const seed = fixSeed ? subjectSeed : randomUint256();
      return await ticketPickerTester.pickSingleTicket(seed, subjectNormalMax, subjectBonusballMax);
    }

    it("returns a ticket with 5 unique normals within [1, normalMax] and bonusball within [1, bonusballMax]", async () => {
      const ticket = await subject();
      expect(ticket.normals.length).to.eq(5);

      const seen = new Set<number>();
      for (const n of ticket.normals) {
        expect(n).to.be.gte(1);
        expect(n).to.be.lte(subjectNormalMax);
        expect(seen.has(Number(n))).to.eq(false);
        seen.add(Number(n));
      }
      expect(ticket.bonusball).to.be.gte(1);
      expect(ticket.bonusball).to.be.lte(subjectBonusballMax);
    });

    it("is deterministic for the same seed", async () => {
      const a = await subject(true);
      const b = await subject(true);
      expect(a).to.deep.eq(b);
    });

    it("produces different tickets when the seed changes", async () => {
      const a = await subject();
      const b = await subject();
      expect(a).to.not.deep.eq(b);
    });
  });

  describe("#pickMultipleTickets", () => {
    let subjectSeed: bigint;
    let subjectCount: bigint;
    let subjectNormalMax: bigint;
    let subjectBonusballMax: bigint;

    beforeEach(async () => {
      subjectSeed = randomUint256();
      subjectCount = BigInt(3);
      subjectNormalMax = BigInt(42);
      subjectBonusballMax = BigInt(10);
    });

    async function subject(fixSeed: boolean = false): Promise<any> {
      const seed = fixSeed ? subjectSeed : randomUint256();
      return await ticketPickerTester.pickMultipleTickets(seed, subjectCount, subjectNormalMax, subjectBonusballMax);
    }

    it("each ticket has 5 unique normals within [1, normalMax] and bonusball within [1, bonusballMax]", async () => {
      const tickets = await subject();
      expect(tickets.length).to.eq(Number(subjectCount));

      for (const ticket of tickets) {
        expect(ticket.normals.length).to.eq(5);
        const seen = new Set<number>();
        for (const n of ticket.normals) {
          expect(n).to.be.gte(1);
          expect(n).to.be.lte(subjectNormalMax);
          expect(seen.has(Number(n))).to.eq(false);
          seen.add(Number(n));
        }
        expect(ticket.bonusball).to.be.gte(1);
        expect(ticket.bonusball).to.be.lte(subjectBonusballMax);
      }
    });

    it("is deterministic for the same seed", async () => {
      const a = await subject(true);
      const b = await subject(true);
      expect(a).to.deep.eq(b);
    });

    it("produces different tickets when the seed changes", async () => {
      const a = await subject();
      const b = await subject();
      expect(a).to.not.deep.eq(b);
    });

    describe("when the count is 0", async () => {
      beforeEach(async () => {
        subjectCount = BigInt(0);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Pick at least 1 ticket");
      });
    });
  });

  describe("#pickAuto", () => {
    let subjectNonce: bigint;
    let subjectCount: bigint;
    let subjectNormalMax: bigint;
    let subjectBonusballMax: bigint;

    beforeEach(async () => {
      subjectNonce = randomUint256();
      subjectCount = BigInt(3);
      subjectNormalMax = BigInt(42);
      subjectBonusballMax = BigInt(10);
    });

    async function subject(fixNonce: boolean = false): Promise<any> {
      const nonce = fixNonce ? subjectNonce : randomUint256();
      return await ticketPickerTester.pickAuto(nonce, subjectCount, subjectNormalMax, subjectBonusballMax);
    }

    it("each ticket has 5 unique normals within [1, normalMax] and bonusball within [1, bonusballMax]", async () => {
      const tickets = await subject();
      expect(tickets.length).to.eq(Number(subjectCount));

      for (const ticket of tickets) {
        expect(ticket.normals.length).to.eq(5);
        const seen = new Set<number>();
        for (const n of ticket.normals) {
          expect(n).to.be.gte(1);
          expect(n).to.be.lte(subjectNormalMax);
          expect(seen.has(Number(n))).to.eq(false);
          seen.add(Number(n));
        }
        expect(ticket.bonusball).to.be.gte(1);
        expect(ticket.bonusball).to.be.lte(subjectBonusballMax);
      }
    });

    it("is deterministic for the same nonce", async () => {
      const a = await subject(true);
      const b = await subject(true);
      expect(a).to.deep.eq(b);
    });

    it("produces different tickets when the nonce changes", async () => {
      const a = await subject();
      const b = await subject();
      expect(a).to.not.deep.eq(b);
    });
  });
});
