import { ethers } from "hardhat";
import DeployHelper from "@utils/deploys";

import {
  getWaffleExpect,
  getAccounts
} from "@utils/test/index";
import { Account } from "@utils/test";

import { JackpotTicketNFT, MockJackpot, TicketNFTArt } from "@utils/contracts";
import { takeSnapshot, SnapshotRestorer } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { calculatePackedTicket, unpackTicket } from "@utils/protocolUtils";
import { Ticket } from "@utils/types";

const expect = getWaffleExpect();

describe("TicketNFTArt", () => {
  let owner: Account;
  let user1: Account;
  let unauthorized: Account;

  let ticketNFTArt: TicketNFTArt;
  let jackpotTicketNFT: JackpotTicketNFT;
  let mockJackpot: MockJackpot;
  let snapshot: SnapshotRestorer;

  const DRAWING_ID_1 = 1n;
  const TICKET_ID_1 = 1001n;
  const PACKED_TICKET_1 = calculatePackedTicket({ normals: [BigInt(11), BigInt(12), BigInt(13), BigInt(14), BigInt(35)], bonusball: BigInt(16) } as Ticket, BigInt(35));
  const REFERRAL_SCHEME = ethers.keccak256(ethers.toUtf8Bytes("referral"));

  // Dec 25, 2024 12:00:00 UTC
  const DRAWING_TIME = 1735128000n;

  beforeEach(async () => {
    [owner, user1, unauthorized] = await getAccounts();

    const deployer = new DeployHelper(owner.wallet);
    mockJackpot = await deployer.deployMockJackpot();
    ticketNFTArt = await deployer.deployTicketNFTArt(await mockJackpot.getAddress());
    jackpotTicketNFT = await deployer.deployJackpotTicketNFT(
      await mockJackpot.getAddress(),
      await ticketNFTArt.getAddress()
    );

    // Setup default drawing state with drawing time
    await mockJackpot.setDrawingState(35, 10, 0, DRAWING_TIME);

    snapshot = await takeSnapshot();
  });

  beforeEach(async () => {
    await snapshot.restore();
  });

  describe("#constructor", () => {
    it("should set the jackpot address correctly", async () => {
      expect(await ticketNFTArt.jackpot()).to.equal(await mockJackpot.getAddress());
    });

    it("should set the owner to the deployer", async () => {
      expect(await ticketNFTArt.owner()).to.equal(owner.address);
    });
  });

  describe("#updatePathCaches", () => {
    let subjectPathCaches: { number: bigint; path: string; xOffset: bigint; yOffset: bigint }[];
    let subjectCaller: Account;

    beforeEach(async () => {
      subjectPathCaches = [
        { number: 1n, path: "M10,10 L20,20", xOffset: 0n, yOffset: 0n },
        { number: 2n, path: "M30,30 L40,40", xOffset: 100n, yOffset: -50n },
      ];
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return await ticketNFTArt.connect(subjectCaller.wallet).updatePathCaches(subjectPathCaches);
    }

    it("should store paths in the cache", async () => {
      await subject();

      const cached1 = await ticketNFTArt.pathCache(1n);
      expect(cached1.number).to.equal(1n);
      expect(cached1.path).to.equal("M10,10 L20,20");
      expect(cached1.xOffset).to.equal(0n);
      expect(cached1.yOffset).to.equal(0n);

      const cached2 = await ticketNFTArt.pathCache(2n);
      expect(cached2.number).to.equal(2n);
      expect(cached2.path).to.equal("M30,30 L40,40");
      expect(cached2.xOffset).to.equal(100n);
      expect(cached2.yOffset).to.equal(-50n);
    });

    it("should overwrite existing paths", async () => {
      await subject();

      const updatedPaths = [{ number: 1n, path: "M50,50 L60,60", xOffset: 200n, yOffset: 100n }];
      await ticketNFTArt.updatePathCaches(updatedPaths);

      const cached = await ticketNFTArt.pathCache(1n);
      expect(cached.path).to.equal("M50,50 L60,60");
      expect(cached.xOffset).to.equal(200n);
    });

    it("should emit PathCacheUpdated events", async () => {
      await expect(subject())
        .to.emit(ticketNFTArt, "PathCacheUpdated")
        .withArgs(1n, "M10,10 L20,20", 0n, 0n)
        .and.to.emit(ticketNFTArt, "PathCacheUpdated")
        .withArgs(2n, "M30,30 L40,40", 100n, -50n);
    });

    describe("when called by non-owner", () => {
      beforeEach(async () => {
        subjectCaller = unauthorized;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(ticketNFTArt, "OwnableUnauthorizedAccount");
      });
    });

    describe("when number is greater than 9", () => {
      beforeEach(async () => {
        subjectPathCaches = [
          { number: 10n, path: "M10,10 L20,20", xOffset: 0n, yOffset: 0n },
        ];
      });

      it("should revert with InvalidDigit", async () => {
        await expect(subject()).to.be.revertedWithCustomError(ticketNFTArt, "InvalidDigit").withArgs(10n);
      });
    });
  });

  describe("#updatePathPositions", () => {
    let subjectPathPositions: { position: bigint; anchor: bigint }[];
    let subjectCaller: Account;

    beforeEach(async () => {
      subjectPathPositions = [
        { position: 1n, anchor: 12914n },
        { position: 2n, anchor: 15914n },
      ];
      subjectCaller = owner;
    });

    async function subject(): Promise<any> {
      return await ticketNFTArt.connect(subjectCaller.wallet).updatePathPositions(subjectPathPositions);
    }

    it("should store positions in the mapping", async () => {
      await subject();

      const pos1 = await ticketNFTArt.getPathPositions(1n);
      expect(pos1.position).to.equal(1n);
      expect(pos1.anchor).to.equal(12914n);

      const pos2 = await ticketNFTArt.getPathPositions(2n);
      expect(pos2.position).to.equal(2n);
      expect(pos2.anchor).to.equal(15914n);
    });

    it("should overwrite existing positions", async () => {
      await subject();

      const updatedPositions = [{ position: 1n, anchor: 99999n }];
      await ticketNFTArt.updatePathPositions(updatedPositions);

      const pos = await ticketNFTArt.getPathPositions(1n);
      expect(pos.anchor).to.equal(99999n);
    });

    it("should emit PathPositionsUpdated events", async () => {
      await expect(subject())
        .to.emit(ticketNFTArt, "PathPositionsUpdated")
        .withArgs(1n, 12914n)
        .and.to.emit(ticketNFTArt, "PathPositionsUpdated")
        .withArgs(2n, 15914n);
    });

    describe("when called by non-owner", () => {
      beforeEach(async () => {
        subjectCaller = unauthorized;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWithCustomError(ticketNFTArt, "OwnableUnauthorizedAccount");
      });
    });

    describe("when position is 0", () => {
      beforeEach(async () => {
        subjectPathPositions = [
          { position: 0n, anchor: 12914n },
        ];
      });

      it("should revert with InvalidPosition", async () => {
        await expect(subject()).to.be.revertedWithCustomError(ticketNFTArt, "InvalidPosition").withArgs(0n);
      });
    });

    describe("when position is greater than 6", () => {
      beforeEach(async () => {
        subjectPathPositions = [
          { position: 7n, anchor: 12914n },
        ];
      });

      it("should revert with InvalidPosition", async () => {
        await expect(subject()).to.be.revertedWithCustomError(ticketNFTArt, "InvalidPosition").withArgs(7n);
      });
    });
  });

  describe("#getPathPositions", () => {
    it("should return empty struct for unset position", async () => {
      const pos = await ticketNFTArt.getPathPositions(99n);
      expect(pos.position).to.equal(0n);
      expect(pos.anchor).to.equal(0n);
    });

    it("should return stored position after update", async () => {
      await ticketNFTArt.updatePathPositions([{ position: 5n, anchor: 24911n }]);

      const pos = await ticketNFTArt.getPathPositions(5n);
      expect(pos.position).to.equal(5n);
      expect(pos.anchor).to.equal(24911n);
    });
  });

  describe("#generateTokenURI", () => {
    let subjectTicket: {
      ticketId: bigint;
      ticket: {
        drawingId: bigint;
        packedTicket: bigint;
        referralScheme: string;
      };
      normals: number[];
      bonusball: number;
    };

    beforeEach(async () => {
      // Mint a ticket first
      await mockJackpot.mintTicket(
        await jackpotTicketNFT.getAddress(),
        user1.address,
        TICKET_ID_1,
        DRAWING_ID_1,
        PACKED_TICKET_1,
        REFERRAL_SCHEME
      );

      await ticketNFTArt.updatePathCaches([
        { number: BigInt(0), xOffset: -162, yOffset: -133, path: 'm2.076 1.524q-.948 0-1.632-.54t-1.056-1.536q-.36-.996-.36-2.364 0-1.38.36-2.376.372-.996 1.056-1.536.684-.552 1.632-.552.96 0 1.632.552.684.54 1.044 1.536.372.996.372 2.376 0 1.368-.372 2.364-.36.996-1.044 1.536-.672.54-1.632.54m0-1.344q.48 0 .816-.348.336-.36.516-1.056t.18-1.692q0-1.02-.18-1.704-.18-.696-.516-1.056a1.08 1.08 0 0 0-.816-.36 1.1 1.1 0 0 0-.816.36q-.336.36-.516 1.056-.18.684-.18 1.704 0 .996.18 1.692t.516 1.056q.348.348.816.348' },
        { number: BigInt(1), xOffset: 0, yOffset: 0, path: 'v-5.832h-2.136v-1.248h1.008q.48 0 .768-.132a.86.86 0 0 0 .432-.456q.144-.324.144-.852h1.272v8.52zm-2.52 0v-1.368h5.952v1.368z' },
        { number: BigInt(2), xOffset: -259, yOffset: 0, path: 'q0-.996.276-1.752.276-.768.96-1.416.684-.66 1.908-1.296.48-.252.792-.48t.468-.504.156-.684q0-.372-.156-.648a1 1 0 0 0-.444-.432q-.3-.156-.744-.156-.732 0-1.128.396t-.504 1.14l-1.548-.084q.132-1.284.948-2.04t2.256-.756q.924 0 1.56.312t.96.888q.324.564.324 1.308 0 .672-.216 1.164-.216.48-.72.9-.492.408-1.344.864-.72.384-1.176.732-.444.336-.66.636-.216.288-.24.54h4.368v1.368z' },
        { number: BigInt(3), xOffset: 40, yOffset: 19, path: 'q-1.44 0-2.184-.684t-.804-1.8l1.5-.084q.072.672.48.948.42.276 1.02.276.432 0 .78-.132a1.16 1.16 0 0 0 .564-.42q.216-.3.216-.768t-.192-.768a1.1 1.1 0 0 0-.552-.456 2.1 2.1 0 0 0-.84-.156h-.66v-1.236h.66q.372 0 .66-.108.3-.12.468-.372.18-.252.18-.66 0-.576-.336-.864-.324-.288-.924-.288-.648 0-.972.288-.324.276-.384.756l-1.512-.084q.12-1.044.852-1.668t2.028-.624q.852 0 1.476.276.636.276.972.804.336.516.336 1.248 0 .804-.492 1.296-.492.48-1.428.648v-.228q1.032.12 1.608.732.588.6.588 1.536 0 .816-.384 1.404-.384.576-1.092.888-.696.3-1.632.3' },
        { number: BigInt(4), xOffset: 118, yOffset: 0, path: 'v-1.752h-3.936V139.5l3.744-5.52h1.668v5.448h1.02v1.32h-1.02v1.752zm-2.52-3.072h2.52v-3.54z' },
        { number: BigInt(5), xOffset: 45, yOffset: 19, path: 'q-.876 0-1.524-.312a2.6 2.6 0 0 1-1.008-.876 2.6 2.6 0 0 1-.432-1.248l1.536-.096q.084.588.444.888.372.3.984.3.672 0 1.056-.42.396-.42.396-1.2 0-.516-.18-.888a1.2 1.2 0 0 0-.492-.564 1.5 1.5 0 0 0-.768-.192 1.5 1.5 0 0 0-.792.216q-.36.216-.516.588l-1.548-.06.54-4.848h4.86v1.368h-3.612l-.324 2.736-.312-.168q.192-.36.492-.6t.672-.36q.384-.132.78-.132.84 0 1.452.384.612.372.948 1.032.336.648.336 1.488 0 .876-.372 1.548t-1.056 1.044q-.672.372-1.56.372'},
        { number: BigInt(6), xOffset: 48, yOffset: 19, path: 'q-1.008 0-1.704-.444-.696-.456-1.056-1.32t-.36-2.076q0-1.068.18-1.98a5.2 5.2 0 0 1 .6-1.608 3 3 0 0 1 1.056-1.08q.66-.396 1.596-.396.816 0 1.368.276.552.264.876.744.336.468.492 1.068l-1.512.12a1.25 1.25 0 0 0-.384-.624q-.276-.24-.84-.24-.588 0-1.02.348-.42.336-.66 1.056-.24.708-.252 1.836l-.432-.048q.132-.408.444-.756.312-.36.78-.588.48-.228 1.128-.228.84 0 1.464.36t.96 1.008q.348.648.348 1.512 0 .936-.384 1.632a2.64 2.64 0 0 1-1.08 1.056q-.684.372-1.608.372m-.012-1.368q.732 0 1.14-.432t.408-1.224q0-.744-.384-1.176t-1.092-.432q-.48 0-.852.204a1.43 1.43 0 0 0-.588.564 1.7 1.7 0 0 0-.204.852q0 .468.18.84.192.372.54.588.36.216.852.216'},
        { number: BigInt(7), xOffset: -104, yOffset: 0, path: 'q0-1.296.348-2.544a11.2 11.2 0 0 1 1.008-2.4q.66-1.164 1.56-2.208h-4.344v-1.368h5.856v1.284q-.756.852-1.308 1.692-.54.84-.888 1.704a9.3 9.3 0 0 0-.504 1.8 12.6 12.6 0 0 0-.156 2.04z'},
        { number: BigInt(8), xOffset: 46, yOffset: 19, path: 'q-.912 0-1.608-.288a2.43 2.43 0 0 1-1.092-.852q-.396-.564-.396-1.38 0-.936.564-1.548.576-.612 1.524-.816l.024.24q-.768-.18-1.26-.648-.48-.48-.48-1.272 0-.672.336-1.2.348-.528.96-.828.612-.312 1.428-.312t1.428.312q.624.3.96.828t.336 1.2q0 .792-.48 1.272-.48.468-1.26.648l.024-.24q.96.204 1.524.816t.564 1.548q0 .816-.396 1.38t-1.092.852-1.608.288m0-1.344q.66 0 1.104-.312.456-.312.456-1.008 0-.648-.408-1.02-.396-.384-1.152-.384t-1.164.384q-.396.372-.396 1.02 0 .696.444 1.008.456.312 1.116.312m0-4.02q.54 0 .864-.276.336-.276.336-.84 0-.504-.324-.792t-.876-.288q-.54 0-.876.288-.324.288-.324.792 0 .564.324.84.336.276.876.276'},
        { number: BigInt(9), xOffset: 44, yOffset: -871, path: 'q1.008 0 1.704.456.696.444 1.056 1.308.36.852.36 2.076 0 1.068-.192 1.992a5.1 5.1 0 0 1-.588 1.608 3.1 3.1 0 0 1-1.068 1.08q-.648.384-1.584.384-.816 0-1.368-.264a2.4 2.4 0 0 1-.888-.744 3.5 3.5 0 0 1-.48-1.08l1.512-.12q.108.384.384.624.288.24.84.24.588 0 1.008-.336.432-.348.672-1.056.24-.72.252-1.848l.432.048a2.2 2.2 0 0 1-.444.768 2.5 2.5 0 0 1-.792.576q-.468.228-1.116.228-.84 0-1.464-.36a2.5 2.5 0 0 1-.972-1.008q-.336-.648-.336-1.512 0-.948.384-1.632a2.66 2.66 0 0 1 1.068-1.056q.696-.372 1.62-.372m.012 1.368q-.72 0-1.14.432-.408.42-.408 1.224 0 .732.384 1.176.384.432 1.092.432.492 0 .852-.192.372-.204.576-.564a1.7 1.7 0 0 0 .216-.864q0-.468-.192-.84-.18-.372-.54-.588a1.56 1.56 0 0 0-.84-.216'},
      ]);

      await ticketNFTArt.updatePathPositions([
        { position: BigInt(1), anchor: BigInt(12914) },
        { position: BigInt(2), anchor: BigInt(15914) },
        { position: BigInt(3), anchor: BigInt(18914) },
        { position: BigInt(4), anchor: BigInt(21914) },
        { position: BigInt(5), anchor: BigInt(24911) },
        { position: BigInt(6), anchor: BigInt(32155) },
      ]);

      // Get the extended ticket info
      const extendedTicket = await jackpotTicketNFT.getExtendedTicketInfo(TICKET_ID_1);
      const unpackedTicket = unpackTicket(PACKED_TICKET_1, BigInt(35));
      subjectTicket = {
        ticketId: extendedTicket.ticketId,
        ticket: {
          drawingId: extendedTicket.ticket.drawingId,
          packedTicket: PACKED_TICKET_1,
          referralScheme: extendedTicket.ticket.referralScheme
        },
        normals: unpackedTicket.normals.map(n => Number(n)),
        bonusball: Number(unpackedTicket.bonusball)
      };
    });

    async function subject(): Promise<string> {
      return await ticketNFTArt.generateTokenURI(subjectTicket);
    }

    function decodeTokenURI(uri: string): any {
      // Remove "data:application/json;base64," prefix
      const base64Json = uri.replace("data:application/json;base64,", "");
      const jsonString = Buffer.from(base64Json, "base64").toString("utf-8");
      return JSON.parse(jsonString);
    }

    describe("when drawing is not settled", () => {
      beforeEach(async () => {
        // Set currentDrawingId to same as ticket's drawing (not settled)
        await mockJackpot.setDrawingId(DRAWING_ID_1);
      });

      it("should return metadata with 'Not Settled' for tier and win amount", async () => {
        const uri = await subject();
        const metadata = decodeTokenURI(uri);

        const tierAttribute = metadata.attributes.find((a: any) => a.trait_type === "Tier");
        const winAmountAttribute = metadata.attributes.find((a: any) => a.trait_type === "Win Amount");

        expect(tierAttribute.value).to.equal("Not Settled");
        expect(winAmountAttribute.value).to.equal("Not Settled");
      });

      it("should return valid base64 encoded JSON", async () => {
        const uri = await subject();

        expect(uri).to.include("data:application/json;base64,");
        const metadata = decodeTokenURI(uri);

        expect(metadata).to.have.property("name");
        expect(metadata).to.have.property("description");
        expect(metadata).to.have.property("image");
        expect(metadata).to.have.property("attributes");
      });

      it("should have the correct name and description", async () => {
        const uri = await subject();

        const metadata = decodeTokenURI(uri);

        expect(metadata.name).to.equal("Megapot Ticket for Dec 25, 2024");
        expect(metadata.description).to.equal("A ticket for Megapot Lottery Drawing #1. Check results at megapot.io");
      });
    });

    describe("when drawing is settled", () => {
      const WIN_TIER_ID = 5n;
      const WIN_AMOUNT = 1000000n; // 1 USDC in 6 decimals

      beforeEach(async () => {
        // Set currentDrawingId to be greater than ticket's drawing (settled)
        await mockJackpot.setDrawingId(DRAWING_ID_1 + 1n);

        // Setup tier payouts
        const tierPayouts: bigint[] = new Array(12).fill(0n);
        tierPayouts[Number(WIN_TIER_ID)] = WIN_AMOUNT;
        await mockJackpot.setDrawingTierPayouts(tierPayouts as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint]);

        // Setup ticket tier
        await mockJackpot.setTicketTierId(TICKET_ID_1, WIN_TIER_ID);
      });

      it("should return valid base64 encoded JSON", async () => {
        const uri = await subject();

        expect(uri).to.include("data:application/json;base64,");
        const metadata = decodeTokenURI(uri);
        expect(metadata).to.have.property("name");
        expect(metadata).to.have.property("description");
        expect(metadata).to.have.property("image");
        expect(metadata).to.have.property("attributes");
      });

      it("should include correct ticket attributes (normals, bonusball)", async () => {
        const uri = await subject();
        const metadata = decodeTokenURI(uri);

        // Ticket is packed with normals [11, 12, 13, 14, 15] and bonusball 16
        expect(metadata.attributes.find((a: any) => a.trait_type === "Normal Ball 1").value).to.equal("11");
        expect(metadata.attributes.find((a: any) => a.trait_type === "Normal Ball 2").value).to.equal("12");
        expect(metadata.attributes.find((a: any) => a.trait_type === "Normal Ball 3").value).to.equal("13");
        expect(metadata.attributes.find((a: any) => a.trait_type === "Normal Ball 4").value).to.equal("14");
        expect(metadata.attributes.find((a: any) => a.trait_type === "Normal Ball 5").value).to.equal("35");
        expect(metadata.attributes.find((a: any) => a.trait_type === "Bonus Ball").value).to.equal("16");
      });

      it("should include correct drawing date formatted as 'Mon DD, YYYY'", async () => {
        const uri = await subject();
        const metadata = decodeTokenURI(uri);

        // DRAWING_TIME = Dec 25, 2024 12:00:00 UTC
        expect(metadata.name).to.include("Dec 25, 2024");
        expect(metadata.attributes.find((a: any) => a.trait_type === "Drawing Date").value).to.equal("Dec 25, 2024");
      });

      describe("month name formatting", () => {
        const monthTests = [
          { timestamp: 1704110400n, expected: "Jan 1, 2024" },   // Jan 1, 2024 12:00:00 UTC
          { timestamp: 1706788800n, expected: "Feb 1, 2024" },   // Feb 1, 2024 12:00:00 UTC
          { timestamp: 1709294400n, expected: "Mar 1, 2024" },   // Mar 1, 2024 12:00:00 UTC
          { timestamp: 1711972800n, expected: "Apr 1, 2024" },   // Apr 1, 2024 12:00:00 UTC
          { timestamp: 1714564800n, expected: "May 1, 2024" },   // May 1, 2024 12:00:00 UTC
          { timestamp: 1717243200n, expected: "Jun 1, 2024" },   // Jun 1, 2024 12:00:00 UTC
          { timestamp: 1719835200n, expected: "Jul 1, 2024" },   // Jul 1, 2024 12:00:00 UTC
          { timestamp: 1722513600n, expected: "Aug 1, 2024" },   // Aug 1, 2024 12:00:00 UTC
          { timestamp: 1725192000n, expected: "Sep 1, 2024" },   // Sep 1, 2024 12:00:00 UTC
          { timestamp: 1727784000n, expected: "Oct 1, 2024" },   // Oct 1, 2024 12:00:00 UTC
          { timestamp: 1730462400n, expected: "Nov 1, 2024" },   // Nov 1, 2024 12:00:00 UTC
          { timestamp: 1733054400n, expected: "Dec 1, 2024" },   // Dec 1, 2024 12:00:00 UTC
        ];

        monthTests.forEach(({ timestamp, expected }) => {
          it(`should format ${expected.split(" ")[0]} correctly`, async () => {
            await mockJackpot.setDrawingState(35, 10, 0, timestamp);

            const uri = await subject();
            const metadata = decodeTokenURI(uri);

            expect(metadata.attributes.find((a: any) => a.trait_type === "Drawing Date").value).to.equal(expected);
          });
        });
      });

      it("should include correct tier and win amount", async () => {
        const uri = await subject();
        const metadata = decodeTokenURI(uri);

        const tierAttribute = metadata.attributes.find((a: any) => a.trait_type === "Tier");
        const winAmountAttribute = metadata.attributes.find((a: any) => a.trait_type === "Win Amount");

        expect(tierAttribute.value).to.equal(WIN_TIER_ID.toString());
        expect(winAmountAttribute.value).to.equal(WIN_AMOUNT.toString());
      });

      it("should include correct ticket ID", async () => {
        const uri = await subject();
        const metadata = decodeTokenURI(uri);

        const ticketIdAttribute = metadata.attributes.find((a: any) => a.trait_type === "Ticket Id");
        expect(ticketIdAttribute.value).to.equal(TICKET_ID_1.toString());
      });

      it("should include correct drawing ID", async () => {
        const uri = await subject();
        const metadata = decodeTokenURI(uri);

        const drawingIdAttribute = metadata.attributes.find((a: any) => a.trait_type === "Drawing ID");
        expect(drawingIdAttribute.value).to.equal(DRAWING_ID_1.toString());
      });
    });

    describe("when ticket has single digit numbers", () => {
      beforeEach(async () => {
        // Set currentDrawingId to be greater than ticket's drawing (settled)
        await mockJackpot.setDrawingId(DRAWING_ID_1 + 1n);

        // Override subjectTicket with single digit numbers to test single digit path rendering
        subjectTicket = {
          ticketId: TICKET_ID_1,
          ticket: {
            drawingId: DRAWING_ID_1,
            packedTicket: PACKED_TICKET_1,
            referralScheme: REFERRAL_SCHEME
          },
          normals: [1, 2, 3, 4, 5],
          bonusball: 6
        };
      });

      it("should generate valid SVG with single digit paths", async () => {
        const uri = await subject();
        const metadata = decodeTokenURI(uri);

        // Verify the image is a valid base64 SVG
        expect(metadata.image).to.include("data:image/svg+xml;base64,");
        const base64Svg = metadata.image.replace("data:image/svg+xml;base64,", "");
        const svgString = Buffer.from(base64Svg, "base64").toString("utf-8");

        // Verify SVG contains path elements (from the pathCache)
        expect(svgString).to.include("<path");
        expect(svgString).to.include("</svg>");
      });
    });
  });
});
