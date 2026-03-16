export type Address = string;

export type DrawingState = {
  prizePool: bigint;
  globalTicketsBought: bigint;
  ticketPrice: bigint;
  edgePerTicket: bigint;
  referralWinShare: bigint;
  lpEarnings: bigint;
  ballMax: bigint;
  bonusballMax: bigint;
  drawingTime: bigint;
  winningTicket: bigint;
  jackpotLock: boolean;
}

export type LPDrawingState = {
  lpPoolTotal: bigint;
  pendingDeposits: bigint;
  pendingWithdrawals: bigint;
}

export type LPValueBreakdown = {
  activeDeposits: bigint;
  pendingDeposits: bigint;
  pendingWithdrawals: bigint;
  claimableWithdrawals: bigint;
}

export type DepositInfo = {
  amount: bigint;
  drawingId: bigint;
}

export type WithdrawalInfo = {
  amountInShares: bigint;
  drawingId: bigint;
}

export type LP = {
  consolidatedShares: bigint;
  lastDeposit: DepositInfo;
  pendingWithdrawal: WithdrawalInfo;
  claimableWithdrawals: bigint;
}

export type Ticket = {
  normals: bigint[];
  bonusball: bigint;
}

export type ReferralScheme = {
  referrers: Address[];
  referralSplit: bigint[];
}

export type TrackedTicket = {
  drawingId: bigint;
  packedTicket: bigint;
  referralScheme: string;
}

export type ExtendedTrackedTicket = {
  ticketId: bigint;
  ticket: TrackedTicket;
  normals: bigint[];
  bonusball: bigint;
}

export type TierInfo = {
  expectedWinners: bigint;
  tierPayout: bigint;
  tierAllocation: bigint;
}

export type SetRequest = {
  samples: bigint;
  minRange: bigint;
  maxRange: bigint;
  withReplacement: boolean;
}

export type RelayTxData = {
  bridgeId: string;
  amount: bigint;
}

export type DrawingTierInfo = {
  minPayout: bigint;
  premiumTierMinAllocation: bigint;
  minPayoutTiers: boolean[];
  premiumTierWeights: bigint[];
}

export type ComboCount = {
  count: bigint;
  dupCount: bigint;
}

export type SubscriptionInfo = {
  remainingUSDC: bigint;
  lastExecutedDrawing: bigint;
  subscribedTicketPrice: bigint;
  dynamicTicketCount: bigint;
  staticTickets: Ticket[];
  referrers: Address[];
  referralSplit: bigint[];
}

export enum ExecutionAction {
  EXECUTE,
  EXECUTE_AND_CLOSE,
  SKIP_ALREADY_EXECUTED,
  SKIP_NO_ACTIVE_SUBSCRIPTION,
  SKIP_ACTIVE_BATCH_ORDER,
  CANCEL_PRICE_CHANGE,
  CANCEL_TOO_MANY_REFERREES,
  CANCEL_USER_REQUESTED,
}

export enum BatchExecutionAction {
  EXECUTE_PARTIAL,
  EXECUTE_FINAL,
  CANCEL_WRONG_DRAWING,
  CANCEL_DRAWING_LOCKED,
  CANCEL_TOO_MANY_REFERRERS,
  CANCEL_USER_REQUESTED,
}

export type JackpotSystemFixture = {
  // Accounts
  owner: any;
  user: any;
  lpOne: any;
  buyerOne: any;
  buyerTwo: any;
  referrerOne: any;
  referrerTwo: any;
  referrerThree: any;

  // Contracts
  jackpot: any;
  jackpotLPManager: any;
  jackpotNFT: any;
  payoutCalculator: any;
  usdcMock: any;
  entropyProvider: any;

  // Deployment Parameters
  deploymentParams: {
    drawingDurationInSeconds: bigint;
    normalBallMax: bigint;
    bonusballMin: bigint;
    lpEdgeTarget: bigint;
    reserveRatio: bigint;
    referralFee: bigint;
    referralWinShare: bigint;
    protocolFee: bigint;
    protocolFeeThreshold: bigint;
    ticketPrice: bigint;
    maxReferrers: bigint;
    entropyFee: bigint;
    minimumPayout: bigint;
    premiumTierWeights: bigint[];
    minPayoutTiers: boolean[];
  };

  // Helper functions
  deployer: any;
}