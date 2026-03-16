import { ethers } from "hardhat";

import {
  getWaffleExpect,
  getAccounts
} from "@utils/test/index";
import { ether, usdc } from "@utils/common"
import { Account } from "@utils/test";

import { PRECISE_UNIT, ZERO_BYTES32 } from "@utils/constants";

import {
  GuaranteedMinimumPayoutCalculator,
  Jackpot,
  JackpotLPManager,
  JackpotTicketNFT,
  ReentrantUSDCMock,
  ScaledEntropyProviderMock,
} from "@utils/contracts";
import { ExtendedTrackedTicket, JackpotSystemFixture, ReferralScheme, Ticket, LP } from "@utils/types";
import { deployJackpotSystem } from "@utils/test/jackpotFixture";
import { calculateTierTotalWinners } from "@utils/protocolUtils";
import { time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const expect = getWaffleExpect();

interface ContractTotalClaims {
  referrers: Record<string, bigint>,
  lpPendingDeposits: Record<string, bigint>,
  lpPendingWithdrawals: Record<string, bigint>,
  lpUSDCValue: Record<string, bigint>,
  lpShares: Record<string, bigint>,
  lpDelayedClaims: bigint,
  lpRevenue: bigint,
  lpLosses: bigint,
}

interface CycleFlows {
  preCycleBalance: bigint;
  lpInflows: bigint;
  lpOutflows: bigint;
  ticketInflows: bigint;
  ticketClaimOutflows: bigint;
  referrerOutflows: bigint;
}

function createClaimRecord(addresses: Account[]): Record<string, bigint> {
  const contractBalances: Record<string, bigint> = {};
  for (const address of addresses) {
    contractBalances[address.address] = 0n;
  }
  return contractBalances;
}

describe("Core Protocol Scenarios", () => {
  let owner: Account;
  let lps: Account[];
  let buyers: Account[];
  let referrers: Account[];
  let deploymentParams: any;

  let jackpotSystem: JackpotSystemFixture;
  let jackpot: Jackpot;
  let jackpotNFT: JackpotTicketNFT;
  let jackpotLPManager: JackpotLPManager;
  let payoutCalculator: GuaranteedMinimumPayoutCalculator;
  let usdcMock: ReentrantUSDCMock;
  let entropyProvider: ScaledEntropyProviderMock;

  let userTotalClaims: ContractTotalClaims;

  // Test configuration
  const INITIAL_LP_DEPOSIT = usdc(3_000_000);
  const DRAWING_DURATION = 86400; // 1 hour
  const TICKET_PRICE = usdc(1);
  const NORMAL_BALL_MAX = 35n;
  const BONUSBALL_MIN = 9n;
  const RESERVE_RATIO = ether(0); // 0%
  const LP_EDGE_TARGET = ether(0.25); // 25%
  const MINIMUM_PAYOUT = usdc(1);

  beforeEach(async () => {
    let rest: Account[];
    [owner, ...rest] = await getAccounts();
    
    // Split accounts
    lps = rest.slice(0, 5);
    buyers = rest.slice(5, 15);
    referrers = rest.slice(15, 18);

    userTotalClaims = {
      lpPendingDeposits: createClaimRecord([...lps, owner]),
      lpPendingWithdrawals: createClaimRecord([...lps, owner]),
      lpShares: createClaimRecord([...lps, owner]),
      lpUSDCValue: createClaimRecord([...lps, owner]),
      referrers: createClaimRecord(referrers),
      lpDelayedClaims: 0n,
      lpRevenue: 0n,
      lpLosses: 0n,
    };

    // Deploy system
    jackpotSystem = await deployJackpotSystem();
    ({ jackpot, jackpotNFT, jackpotLPManager, payoutCalculator, usdcMock, entropyProvider, deploymentParams } = jackpotSystem);

    // Initialize jackpot
    await jackpot.connect(owner.wallet).initialize(
      usdcMock.getAddress(),
      await jackpotLPManager.getAddress(),
      await jackpotNFT.getAddress(),
      entropyProvider.getAddress(),
      await payoutCalculator.getAddress(),
      owner.address,
      deploymentParams.protocolFee,
      deploymentParams.protocolFeeThreshold
    );

    // Setup drawing parameters
    await jackpot.connect(owner.wallet).setNormalBallMax(NORMAL_BALL_MAX);
    await jackpot.connect(owner.wallet).setReserveRatio(RESERVE_RATIO);
    await jackpot.connect(owner.wallet).setLpEdgeTarget(LP_EDGE_TARGET);
    await jackpot.connect(owner.wallet).setBonusballMin(BONUSBALL_MIN);
    await jackpot.connect(owner.wallet).setProtocolFee(BigInt(0));
    
    // Setup payout calculator
    await payoutCalculator.connect(owner.wallet).setMinimumPayout(MINIMUM_PAYOUT);
    await payoutCalculator.connect(owner.wallet).setMinPayoutTiers([
      false, true, false, true, true, true,
      true, true, true, true, true, true
    ]);
    
    // Equal weights across tiers 2-11
    await payoutCalculator.connect(owner.wallet).setPremiumTierWeights(
      [
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
      ]
    );

    // Fund accounts
    await setupAccountFunding();
    
    // Initial LP deposits
    await setupInitialLPPool();
  });

  async function setupAccountFunding() {
    // Fund LPs with $100K - $1M each
    for (let i = 0; i < lps.length; i++) {
      const amount = usdc(100_000 + i * 200_000); // $100K, $300K, $500K, $700K, $900K
      await usdcMock.connect(owner.wallet).transfer(lps[i].address, amount);
    }

    // Fund buyers with $100K each  
    for (let i = 0; i < buyers.length; i++) {
      const amount = usdc(100_000); // $100K
      await usdcMock.connect(owner.wallet).transfer(buyers[i].address, amount);
    }

    // Fund referrers with small amounts
    for (const referrer of referrers) {
      await usdcMock.connect(owner.wallet).transfer(referrer.address, usdc(1_000));
    }
  }

  async function setupInitialLPPool() {
    // Owner makes initial large deposit
    await jackpot.connect(owner.wallet).initializeLPDeposits(usdc(10_000_000));
    await usdcMock.connect(owner.wallet).approve(jackpot.getAddress(), INITIAL_LP_DEPOSIT);
    await jackpot.connect(owner.wallet).lpDeposit(INITIAL_LP_DEPOSIT);
    userTotalClaims.lpPendingDeposits[owner.address] += INITIAL_LP_DEPOSIT;
    userTotalClaims.lpUSDCValue[owner.address] += INITIAL_LP_DEPOSIT;
    // 2-3 additional seed LPs
    for (let i = 0; i < 3; i++) {
      const lp = lps[i];
      const amount = usdc(100_000 + i * 200_000); // $100K, $300K, $500K
      await usdcMock.connect(lp.wallet).approve(jackpot.getAddress(), amount);
      await jackpot.connect(lp.wallet).lpDeposit(amount);
      userTotalClaims.lpPendingDeposits[lp.address] += amount;
      userTotalClaims.lpUSDCValue[lp.address] += amount;
    }
  }

  it("runs 10 drawing cycles with random operations", async () => {
    // Initialize first jackpot
    await jackpot.connect(owner.wallet).initializeJackpot(
      BigInt(await time.latest()) + BigInt(DRAWING_DURATION)
    );

    await updateExpectedLPBalances(
      userTotalClaims,
      userTotalClaims.lpRevenue - userTotalClaims.lpLosses
    );
    
    for (let cycle = 1; cycle <= 10; cycle++) {
      console.log(`\n=== CYCLE ${cycle} ===`);
      
      const balanceBeforeCycle = await usdcMock.balanceOf(await jackpot.getAddress());
      console.log(`Balance before cycle: $${Number(balanceBeforeCycle) / 1e6}`);
      // Phase 1: Pre-drawing operations
      const lpFlows = await performLPOperations(cycle);
      const ticketFlows = await performTicketPurchases(cycle);
      
      // Phase 2: Execute drawing
      await executeDrawing(cycle);
      
      // Phase 3: Post-drawing claims and validations
      const claimFlows = await claimWinnings(cycle);

      await verifyIndividualReferrerBalances(userTotalClaims);
      await claimReferralFees(cycle);

      await updateExpectedLPBalances(
        userTotalClaims,
        userTotalClaims.lpRevenue - userTotalClaims.lpLosses
      );
      
      await validateSystemState(cycle,
        {
          preCycleBalance: balanceBeforeCycle,
          lpInflows: lpFlows.totalLPDeposits,
          lpOutflows: lpFlows.totalLPWithdrawals,
          ticketInflows: ticketFlows.totalTicketRevenue,
          ticketClaimOutflows: claimFlows.totalNetUserWinnings,
          referrerOutflows: ticketFlows.totalReferralFees + claimFlows.totalReferrerWinShares,
        },
        userTotalClaims
      );

      userTotalClaims.referrers = createClaimRecord(referrers);
      userTotalClaims.lpRevenue = 0n;
      userTotalClaims.lpLosses = 0n;
    }
  });

  // =============================================================
  //                    VALIDATION FUNCTIONS
  // =============================================================

  async function validateSystemState(cycle: number, cycleFlows: CycleFlows, userClaims: ContractTotalClaims) {
    console.log(`Cycle ${cycle}: Validating System State`);
    
    // Validate LP pool solvency
    const currentDrawingId = await jackpot.currentDrawingId();
    
    // Validate contract balance is as expected based off of the net aggregate flows between each user type (LPs, ticket holders, referrers)
    const netExpectedFlow = cycleFlows.lpInflows - cycleFlows.lpOutflows + cycleFlows.ticketInflows - cycleFlows.ticketClaimOutflows - cycleFlows.referrerOutflows;
    const expectedContractBalance = cycleFlows.preCycleBalance + netExpectedFlow;
    const actualContractBalance = await usdcMock.balanceOf(await jackpot.getAddress());
    expect(actualContractBalance).to.equal(expectedContractBalance);

    reconcileReferrers(cycleFlows.referrerOutflows, userClaims);
    await reconcileLPs(userClaims);

    console.log(`  Contract balance: $${Number(actualContractBalance) / 1e6}`);
    console.log(`  Current drawing: ${currentDrawingId}`);
  }

  function reconcileReferrers(referrerOutflows: bigint, userClaims: ContractTotalClaims): void {
    let expectedReferrerOutflows = 0n;
    for (const referrer of referrers) {
      expectedReferrerOutflows += userClaims.referrers[referrer.address];
    }

    expect(referrerOutflows).to.equal(expectedReferrerOutflows);
  }

  async function verifyIndividualReferrerBalances(userClaims: ContractTotalClaims): Promise<void> {
    for (const referrer of referrers) {
      expect(userClaims.referrers[referrer.address]).to.equal(await jackpot.referralFees(referrer.address));
    }
  }

  async function reconcileLPs(userClaims: ContractTotalClaims): Promise<void> {
    const currentDrawingId = await jackpot.currentDrawingId();
    for (const lp of Object.keys(userClaims.lpShares)) {
      const lpInfo = await jackpotLPManager.getLPValueBreakdown(lp);
      console.log(`LP ${lp}--------------------------------:`);
      console.log(`Current accumulator: $${Number(await jackpotLPManager.drawingAccumulator(currentDrawingId - BigInt(1)))}`);
      console.log(userClaims.lpUSDCValue[lp], userClaims.lpShares[lp], userClaims.lpPendingDeposits[lp], userClaims.lpPendingWithdrawals[lp]);
      console.log(lpInfo.activeDeposits, lpInfo.pendingDeposits, lpInfo.pendingWithdrawals, lpInfo.claimableWithdrawals);
      // expect(lpInfo.activeDeposits + lpInfo.pendingDeposits + lpInfo.pendingWithdrawals + lpInfo.claimableWithdrawals)
      //   .to.be.closeTo(userClaims.lpUSDCValue[lp], 1);
    }
  }

  // =============================================================
  //                  LP OPERATION FUNCTIONS
  // =============================================================

  async function updateExpectedLPBalances(userClaims: ContractTotalClaims, netRevenue: bigint): Promise<void> {
    const currentDrawingId = await jackpot.currentDrawingId();
    const currentAccumulator = await jackpotLPManager.drawingAccumulator(currentDrawingId - BigInt(1));

    // Allocate profits from previous round
    if (currentDrawingId > 1) {
      console.log(`Allocating profits from previous round: $${Number(netRevenue) / 1e6}`);
      const totalShares = Object.values(userClaims.lpShares).reduce((acc, val) => acc + val, 0n);
      for (const lp of Object.keys(userClaims.lpShares)) {
        const lpProfit = netRevenue * userClaims.lpShares[lp] / totalShares;
        console.log(`LP ${lp} profit: $${Number(lpProfit) / 1e6}`);
        userClaims.lpUSDCValue[lp] += lpProfit;
      }
    }

    // Update share amounts (we will update any inflows or outflows in performLPOperations)
    for (const lp of Object.keys(userClaims.lpShares)) {
      userClaims.lpShares[lp] += userClaims.lpPendingDeposits[lp] * PRECISE_UNIT / currentAccumulator;
      userClaims.lpPendingDeposits[lp] = BigInt(0);
      userClaims.lpShares[lp] -= userClaims.lpPendingWithdrawals[lp];
      userClaims.lpPendingWithdrawals[lp] = BigInt(0);
    }
  }
  
  async function performLPOperations(cycle: number): Promise<{ totalLPDeposits: bigint, totalLPWithdrawals: bigint }> {
    console.log(`Cycle ${cycle}: LP Operations`);
    
    let totalLPDeposits = 0n;
    let totalLPWithdrawals = 0n;
    
    // Random LP deposits (2-5 LPs)
    const numDeposits = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < numDeposits; i++) {
      const lpIndex = Math.floor(Math.random() * lps.length);
      const lp = lps[lpIndex];
      const amount = usdc(1_000 + Math.floor(Math.random() * 99_000)); // $1K - $100K
      
      try {
        await usdcMock.connect(lp.wallet).approve(jackpot.getAddress(), amount);
        await jackpot.connect(lp.wallet).lpDeposit(amount);
        userTotalClaims.lpPendingDeposits[lp.address] += amount;
        userTotalClaims.lpUSDCValue[lp.address] += amount;
        totalLPDeposits += amount;
        console.log(`  LP ${lpIndex} deposited $${Number(amount) / 1e6}`);
      } catch (error) {
        console.log(`  LP ${lpIndex} deposit failed (insufficient funds)`);
      }
    }

    // Random LP withdrawal requests (1-3 LPs)
    const numWithdrawals = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < numWithdrawals; i++) {
      const lpIndex = Math.floor(Math.random() * lps.length);
      const lp = lps[lpIndex];
      
      try {
        const lpUsdcInfo = await jackpotLPManager.getLPValueBreakdown(lp.address);
        if (lpUsdcInfo.activeDeposits > 0n) {
          const lpInfo = await jackpotLPManager.getLpInfo(lp.address);
          const withdrawShares = lpInfo.consolidatedShares / 4n; // Withdraw 25% of shares
          
          // Calculate USDC value of withdrawal using current accumulator price
          const currentAccumulator = await jackpotLPManager.drawingAccumulator(cycle);
          const withdrawalValue = withdrawShares * currentAccumulator / PRECISE_UNIT;
          
          await jackpot.connect(lp.wallet).initiateWithdraw(withdrawShares);
          userTotalClaims.lpPendingWithdrawals[lp.address] += withdrawShares;
          console.log(`  LP ${lpIndex} requested withdrawal of ${withdrawShares} shares (~$${Number(withdrawalValue) / 1e6})`);
        }
      } catch (error) {
        console.log(`  LP ${lpIndex} withdrawal request failed`);
      }
    }

    // Finalize withdrawals
    for (const lp of lps) {
      const lpUsdcInfo = await jackpotLPManager.getLPValueBreakdown(lp.address);
      
      if (lpUsdcInfo.claimableWithdrawals > 0n) {
        await jackpot.connect(lp.wallet).finalizeWithdraw();
        console.log(`  LP ${lp.address} finalized withdrawal of $${Number(lpUsdcInfo.claimableWithdrawals) / 1e6} usdc`);
        totalLPWithdrawals += lpUsdcInfo.claimableWithdrawals;

        // Look into this is things aren't working
        userTotalClaims.lpUSDCValue[lp.address] -= lpUsdcInfo.claimableWithdrawals;
      }
    } 
    
    console.log(`  Total LP deposits: $${Number(totalLPDeposits) / 1e6}`);
    console.log(`  Total LP withdrawals: $${Number(totalLPWithdrawals) / 1e6}`);
    return { totalLPDeposits, totalLPWithdrawals };
  }


  // =============================================================
  //                TICKET OPERATION FUNCTIONS
  // =============================================================

  async function performTicketPurchases(cycle: number): Promise<{ totalTicketRevenue: bigint, totalReferralFees: bigint }> {
    console.log(`Cycle ${cycle}: Ticket Purchases`);
    
    let totalTickets = 0;
    let totalTicketRevenue = 0n;
    let totalReferralFees = 0n;
    
    // Get referral fee rate from contract
    const referralFee = await jackpot.referralFee();
    
    // Ensure minimum ticket volume for guaranteed winners
    const targetTickets = 500 + Math.floor(Math.random() * 500); // 500-1000 tickets
    
    while (totalTickets < targetTickets) {
      const buyerIndex = Math.floor(Math.random() * buyers.length);
      const buyer = buyers[buyerIndex];
      const numTickets = 10 + Math.floor(Math.random() * 100); // 10-110 tickets
      
      // Generate random tickets with some strategic ones for guaranteed winners
      const tickets = await generateTickets(numTickets, cycle);
      const ticketCost = BigInt(tickets.length) * TICKET_PRICE;
      
      // Random referral setup (30% chance)
      let referrerAddrs: string[] = [];
      let referralSplits: bigint[] = [];
      let hasReferrers = false;
      if (Math.random() < 0.3) {
        const numReferrers = 1 + Math.floor(Math.random() * 2); // 1-2 referrers
        for (let i = 0; i < numReferrers; i++) {
          referrerAddrs.push(referrers[i].address);
          referralSplits.push(PRECISE_UNIT / BigInt(numReferrers));
        }
        hasReferrers = true;
      }
      
      try {
        await usdcMock.connect(buyer.wallet).approve(jackpot.getAddress(), ticketCost);
        await jackpot.connect(buyer.wallet).buyTickets(
          tickets,
          buyer.address,
          referrerAddrs,
          referralSplits,
          ethers.encodeBytes32String(`cycle-${cycle}`)
        );
        
        totalTickets += tickets.length;
        totalTicketRevenue += ticketCost;
        
        // Calculate referral fees for this purchase
        const referralFeeAmount = ticketCost * referralFee / PRECISE_UNIT;
        if (hasReferrers) {
          let adjustedReferralFeeAmount = 0n;
          for (let i = 0; i < referrerAddrs.length; i++) {
            adjustedReferralFeeAmount += referralFeeAmount * referralSplits[i] / PRECISE_UNIT;
            userTotalClaims.referrers[referrerAddrs[i]] += referralFeeAmount * referralSplits[i] / PRECISE_UNIT;
          }
          totalReferralFees += adjustedReferralFeeAmount;
        } else {
          userTotalClaims.lpRevenue += referralFeeAmount;
        }

        userTotalClaims.lpRevenue += ticketCost - referralFeeAmount;
        
        console.log(`  Buyer ${buyerIndex} bought ${tickets.length} tickets ${hasReferrers ? 'with referrers' : ''}`);
      } catch (error) {
        console.log(`  Buyer ${buyerIndex} purchase failed`);
      }
    }
    
    console.log(`  Total tickets purchased: ${totalTickets}`);
    console.log(`  Total ticket sales: $${Number(totalTicketRevenue) / 1e6}`);
    console.log(`  Total referral fees: $${Number(totalReferralFees) / 1e6}`);

    return { totalTicketRevenue, totalReferralFees };
  }

  async function generateTickets(count: number, cycle: number): Promise<Ticket[]> {
    const tickets: Ticket[] = [];
    
    for (let i = 0; i < count; i++) {
      // Mix of random and strategic tickets
      const drawingState = await jackpot.getDrawingState(cycle);
      tickets.push(generateRandomTicket(drawingState.ballMax, drawingState.bonusballMax));
    }
    
    return tickets;
  }

  function generateRandomTicket(normalBallMax: bigint, bonusballMax: bigint): Ticket {
    const normals: number[] = [];
    const used = new Set<number>();
    
    // Generate 5 unique normal numbers
    while (normals.length < 5) {
      const num = 1 + Math.floor(Math.random() * Number(normalBallMax));
      if (!used.has(num)) {
        normals.push(num);
        used.add(num);
      }
    }
    normals.sort((a, b) => a - b);
    const bonusball = Number(1) + Math.floor(Math.random() * Number(bonusballMax));
    
    return {
      normals: normals.map(n => BigInt(n)),
      bonusball: BigInt(bonusball)
    } as unknown as Ticket;
  }

  // =============================================================
  //                  DRAWING OPERATION FUNCTIONS
  // =============================================================

  async function executeDrawing(cycle: number) {
    console.log(`Cycle ${cycle}: Executing Drawing`);
    
    // Fast forward to drawing time
    await time.increase(DRAWING_DURATION + 1);
    
    // Get drawing state for entropy calculation
    const drawingState = await jackpot.getDrawingState(cycle);
    const entropyFee = jackpotSystem.deploymentParams.entropyFee + 
      ((jackpotSystem.deploymentParams.entropyBaseGasLimit + 
        jackpotSystem.deploymentParams.entropyVariableGasLimit * drawingState.bonusballMax) * 10_000_000n);
    
    // Run jackpot
    await jackpot.runJackpot({ value: entropyFee });
    
    // Generate strategic winning numbers to ensure some winners
    const winningNumbers = await generateRandomTicket(drawingState.ballMax, drawingState.bonusballMax);
    await entropyProvider.randomnessCallback([winningNumbers.normals, [winningNumbers.bonusball]]);
    
    console.log(`  Drawing ${cycle} completed with numbers: ${winningNumbers.normals} + ${winningNumbers.bonusball}`);
  }

  // =============================================================
  //                TICKET CLAIM OPERATION FUNCTIONS
  // =============================================================

  async function claimWinnings(cycle: number): Promise<{ totalNetUserWinnings: bigint, totalReferrerWinShares: bigint }> {
    console.log(`Cycle ${cycle}: Claiming Winnings`);
    
    // Get all tickets for this drawing and claim winners
    let totalClaimed = 0;
    let totalNetUserWinnings: bigint = BigInt(0);
    let totalReferrerWinShares: bigint = BigInt(0);
    const tierPayouts = await payoutCalculator.getDrawingTierPayouts(BigInt(cycle));
    const referralWinShare = await jackpot.referralWinShare();
    
    // Add previous cycle's lp referralWinShare to lp revenue
    userTotalClaims.lpRevenue += userTotalClaims.lpDelayedClaims;
    userTotalClaims.lpDelayedClaims = 0n;
    for (const buyer of buyers) {
      try {
        const ticketIds: bigint[] = [];
        const ticketInfo: ExtendedTrackedTicket[] = await jackpotNFT.getUserTickets(buyer.address, BigInt(cycle));
        for (let i = 0; i < ticketInfo.length; i++) {
          ticketIds.push(ticketInfo[i].ticketId);
        }
        const ticketTiers = await jackpot.getTicketTierIds(ticketIds)
        let buyerWinnings: bigint = BigInt(0);
        for (let i = 0; i < ticketInfo.length; i++) {
          const referrerShare = tierPayouts[Number(ticketTiers[i])] * referralWinShare / PRECISE_UNIT;
          if (ticketInfo[i].ticket.referralScheme != ZERO_BYTES32) {
            const referralScheme: ReferralScheme = await jackpot.getReferralScheme(ticketInfo[i].ticket.referralScheme);
            let adjustedReferrerShare = 0n;
            for (let j = 0; j < referralScheme.referrers.length; j++) {
              userTotalClaims.referrers[referralScheme.referrers[j]] += referrerShare * referralScheme.referralSplit[j] / PRECISE_UNIT;
              adjustedReferrerShare += referrerShare * referralScheme.referralSplit[j] / PRECISE_UNIT;
            }
            totalReferrerWinShares += adjustedReferrerShare;
          } else {
            userTotalClaims.lpDelayedClaims += referrerShare;
          }
          buyerWinnings += tierPayouts[Number(ticketTiers[i])] - referrerShare;
          userTotalClaims.lpLosses += tierPayouts[Number(ticketTiers[i])];
        }
        totalNetUserWinnings += buyerWinnings;

        if (ticketIds.length > 0) {
          await jackpot.connect(buyer.wallet).claimWinnings(ticketIds);
          totalClaimed += ticketIds.length;
        }
      } catch (error) {
        // No winnings to claim
      }
    }

    console.log(`  Processed ${totalClaimed} ticket claims`);
    return { totalNetUserWinnings, totalReferrerWinShares };
  }

  // =============================================================
  //             REFERRAL FEE CLAIM OPERATION FUNCTIONS
  // =============================================================  

  async function claimReferralFees(cycle: number): Promise<void> {
    console.log(`Cycle ${cycle}: Claiming Referral Fees`);
    
    for (const referrer of referrers) {
      if (userTotalClaims.referrers[referrer.address] > 0n) {
        console.log(`  Referrer ${referrer.address} claiming referral fees of $${Number(userTotalClaims.referrers[referrer.address]) / 1e6}`);
        await jackpot.connect(referrer.wallet).claimReferralFees();
      }
    }
  }
});