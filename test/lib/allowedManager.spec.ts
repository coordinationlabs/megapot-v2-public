import {
  getWaffleExpect,
  getAccounts
} from "@utils/test/index";
import { Account } from "@utils/test";

import {
  AllowedManagerMock,
} from "@utils/contracts";
import { Address } from "@utils/types";
import { ADDRESS_ZERO } from "@utils/constants";
import DeployHelper from "@utils/deploys";

const expect = getWaffleExpect();

describe("AllowedManager", () => {
  let owner: Account;
  let allowed: Account;
  let allowedTwo: Account;
  let nonAllowed: Account;

  let allowedManager: AllowedManagerMock;
  let deployer: DeployHelper;

  beforeEach(async () => {
    [
      owner,
      allowed,
      allowedTwo,
      nonAllowed,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    allowedManager = await deployer.deployAllowedManagerMock();
  });

  describe("#constructor", () => {
    it("should set the owner correctly", async () => {
      expect(await allowedManager.owner()).to.equal(owner.address);
    });

    it("should start with no allowed", async () => {
      const allowed = await allowedManager.getAllowed();
      expect(allowed.length).to.equal(0);
    });
  });

  describe("#addAllowed", () => {
    let subjectAllowed: Address;
    let subjectCaller: Account;

    beforeEach(async () => {
      subjectAllowed = allowed.address;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return await allowedManager.connect(subjectCaller.wallet).addAllowed(subjectAllowed);
    }

    it("should add the allowed correctly", async () => {
      await subject();

      const isAllowed = await allowedManager.isAllowed(subjectAllowed);
      const allowed = await allowedManager.getAllowed();

      expect(isAllowed).to.be.true;
      expect(allowed).to.contain(subjectAllowed);
      expect(allowed.length).to.equal(1);
    });

    it("should emit the AllowedAdded event correctly", async () => {
      await expect(subject()).to.emit(allowedManager, "AllowedAdded").withArgs(subjectAllowed);
    });

    describe("when adding multiple allowed", () => {
      beforeEach(async () => {
        await allowedManager.connect(owner.wallet).addAllowed(allowedTwo.address);
      });

      it("should add the allowed correctly", async () => {
        await subject();

        const isAllowed = await allowedManager.isAllowed(subjectAllowed);
        const isAllowedTwo = await allowedManager.isAllowed(allowedTwo.address);
        const allowed = await allowedManager.getAllowed();

        expect(isAllowed).to.be.true;
        expect(isAllowedTwo).to.be.true;
        expect(allowed).to.contain(subjectAllowed);
        expect(allowed).to.contain(allowedTwo.address);
        expect(allowed.length).to.equal(2);
      });
    });

    describe("when the allowed is already added", () => {
      beforeEach(async () => {
        await allowedManager.connect(owner.wallet).addAllowed(subjectAllowed);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "AllowedAlreadyAdded");
      });
    });

    describe("when the allowed is the zero address", () => {
      beforeEach(async () => {
        subjectAllowed = ADDRESS_ZERO;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "ZeroAddress");
      });
    });

    describe("when the caller is not the owner", () => {
      beforeEach(async () => {
        subjectCaller = nonAllowed;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "OwnableUnauthorizedAccount");
      });
    });
  });

  describe("#addAllowedBatch", () => {
    let subjectAllowed: Address[];
    let subjectCaller: Account;

    beforeEach(async () => {
      subjectAllowed = [allowed.address, allowedTwo.address];
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return await allowedManager.connect(subjectCaller.wallet).addAllowedBatch(subjectAllowed);
    }

    it("should add multiple allowed correctly", async () => {
      await subject();

      const isAllowed = await allowedManager.isAllowed(allowed.address);
      const isAllowedTwo = await allowedManager.isAllowed(allowedTwo.address);
      const allAllowed = await allowedManager.getAllowed();

      expect(isAllowed).to.be.true;
      expect(isAllowedTwo).to.be.true;
      expect(allAllowed).to.contain(allowed.address);
      expect(allAllowed).to.contain(allowedTwo.address);
      expect(allAllowed.length).to.equal(2);
    });

    it("should emit AllowedAdded event for each address", async () => {
      await expect(subject())
        .to.emit(allowedManager, "AllowedAdded").withArgs(allowed.address)
        .and.to.emit(allowedManager, "AllowedAdded").withArgs(allowedTwo.address);
    });

    describe("when the array is empty", () => {
      beforeEach(async () => {
        subjectAllowed = [];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "EmptyArray");
      });
    });

    describe("when one address in batch is zero", () => {
      beforeEach(async () => {
        subjectAllowed = [allowed.address, ADDRESS_ZERO];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "ZeroAddress");
      });
    });

    describe("when one address in batch is duplicate within batch", () => {
      beforeEach(async () => {
        subjectAllowed = [allowed.address, allowed.address];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "AllowedAlreadyAdded");
      });
    });

    describe("when one address in batch already exists", () => {
      beforeEach(async () => {
        await allowedManager.connect(owner.wallet).addAllowed(allowed.address);
        subjectAllowed = [allowedTwo.address, allowed.address];
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "AllowedAlreadyAdded");
      });
    });

    describe("when the caller is not the owner", () => {
      beforeEach(async () => {
        subjectCaller = nonAllowed;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "OwnableUnauthorizedAccount");
      });
    });
  });

  describe("#removeAllowed", () => {
    let subjectAllowed: Address;
    let subjectCaller: Account;

    beforeEach(async () => {
      await allowedManager.connect(owner.wallet).addAllowed(allowed.address);
      subjectAllowed = allowed.address;
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return await allowedManager.connect(subjectCaller.wallet).removeAllowed(subjectAllowed);
    }

    it("should remove the allowed correctly", async () => {
      await subject();

      const isAllowed = await allowedManager.isAllowed(subjectAllowed);
      const allowed = await allowedManager.getAllowed();

      expect(isAllowed).to.be.false;
      expect(allowed).to.not.contain(subjectAllowed);
      expect(allowed.length).to.equal(0);
    });

    it("should emit the AllowedRemoved event correctly", async () => {
      await expect(subject()).to.emit(allowedManager, "AllowedRemoved").withArgs(subjectAllowed);
    });

    describe("when removing one allowed from multiple allowed", () => {
      beforeEach(async () => {
        await allowedManager.connect(owner.wallet).addAllowed(allowedTwo.address);
      });

      it("should remove only the specified allowed", async () => {
        await subject();

        const isAllowed = await allowedManager.isAllowed(subjectAllowed);
        const isAllowedTwo = await allowedManager.isAllowed(allowedTwo.address);
        const allowed = await allowedManager.getAllowed();

        expect(isAllowed).to.be.false;
        expect(isAllowedTwo).to.be.true;
        expect(allowed).to.not.contain(subjectAllowed);
        expect(allowed).to.contain(allowedTwo.address);
        expect(allowed.length).to.equal(1);
      });
    });

    describe("when the allowed is not found", () => {
      beforeEach(async () => {
        subjectAllowed = allowedTwo.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "AllowedNotFound");
      });
    });

    describe("when the allowed is the zero address", () => {
      beforeEach(async () => {
        subjectAllowed = ADDRESS_ZERO;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "ZeroAddress");
      });
    });

    describe("when the caller is not the owner", () => {
      beforeEach(async () => {
        subjectCaller = nonAllowed;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(allowedManager, "OwnableUnauthorizedAccount");
      });
    });
  });

  describe("#isAllowed", () => {
    describe("when the address is a allowed", () => {
      beforeEach(async () => {
        await allowedManager.connect(owner.wallet).addAllowed(allowed.address);
      });

      it("should return true", async () => {
        const isAllowed = await allowedManager.isAllowed(allowed.address);
        expect(isAllowed).to.be.true;
      });
    });

    describe("when the address is not a allowed", () => {
      it("should return false", async () => {
        const isAllowed = await allowedManager.isAllowed(nonAllowed.address);
        expect(isAllowed).to.be.false;
      });
    });

    describe("when checking zero address", () => {
      it("should return false", async () => {
        const isAllowed = await allowedManager.isAllowed(ADDRESS_ZERO);
        expect(isAllowed).to.be.false;
      });
    });
  });

  describe("#getAllowed", () => {
    describe("when no allowed are added", () => {
      it("should return an empty array", async () => {
        const allowed = await allowedManager.getAllowed();
        expect(allowed.length).to.equal(0);
      });
    });

    describe("when multiple allowed are added", () => {
      beforeEach(async () => {
        await allowedManager.connect(owner.wallet).addAllowed(allowed.address);
        await allowedManager.connect(owner.wallet).addAllowed(allowedTwo.address);
      });

      it("should return all allowed", async () => {
        const allowedAddresses = await allowedManager.getAllowed();
        expect(allowedAddresses.length).to.equal(2);
        expect(allowedAddresses).to.contain(allowed.address);
        expect(allowedAddresses).to.contain(allowedTwo.address);
      });
    });

    describe("when allowed are added and removed", () => {
      beforeEach(async () => {
        await allowedManager.connect(owner.wallet).addAllowed(allowed.address);
        await allowedManager.connect(owner.wallet).addAllowed(allowedTwo.address);
        await allowedManager.connect(owner.wallet).removeAllowed(allowed.address);
      });

      it("should return only remaining allowed", async () => {
        const allowedAddresses = await allowedManager.getAllowed();
        expect(allowedAddresses.length).to.equal(1);
        expect(allowedAddresses).to.not.contain(allowed.address);
        expect(allowedAddresses).to.contain(allowedTwo.address);
      });
    });
  });

  describe("#onlyAllowed modifier", () => {
    describe("when caller is a allowed", () => {
      beforeEach(async () => {
        await allowedManager.connect(owner.wallet).addAllowed(allowed.address);
      });

      it("should allow execution", async () => {
        await expect(
          allowedManager.connect(allowed.wallet).allowedOnlyFunction()
        ).to.emit(allowedManager, "MockFunctionCalled").withArgs(allowed.address);
      });
    });

    describe("when caller is not a allowed", () => {
      it("should prevent execution", async () => {
        await expect(
          allowedManager.connect(nonAllowed.wallet).allowedOnlyFunction()
        ).to.be.revertedWithCustomError(allowedManager, "NotAllowed");
      });
    });

    describe("when owner is not a allowed", () => {
      it("should prevent execution even for owner", async () => {
        await expect(
          allowedManager.connect(owner.wallet).allowedOnlyFunction()
        ).to.be.revertedWithCustomError(allowedManager, "NotAllowed");
      });
    });
  });

  describe("#allowedOnlyFunction", () => {
    describe("when called by authorized allowed", () => {
      beforeEach(async () => {
        await allowedManager.connect(owner.wallet).addAllowed(allowed.address);
      });

      it("should emit MockFunctionCalled event", async () => {
        await expect(
          allowedManager.connect(allowed.wallet).allowedOnlyFunction()
        ).to.emit(allowedManager, "MockFunctionCalled").withArgs(allowed.address);
      });
    });

    describe("when called by different authorized allowed", () => {
      beforeEach(async () => {
        await allowedManager.connect(owner.wallet).addAllowed(allowed.address);
        await allowedManager.connect(owner.wallet).addAllowed(allowedTwo.address);
      });

      it("should emit events with correct caller addresses", async () => {
        await expect(
          allowedManager.connect(allowed.wallet).allowedOnlyFunction()
        ).to.emit(allowedManager, "MockFunctionCalled").withArgs(allowed.address);

        await expect(
          allowedManager.connect(allowedTwo.wallet).allowedOnlyFunction()
        ).to.emit(allowedManager, "MockFunctionCalled").withArgs(allowedTwo.address);
      });
    });
  });
});