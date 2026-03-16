// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {FisherYatesRejection} from "./FisherYatesWithRejection.sol";
import {IJackpot} from "../interfaces/IJackpot.sol";

/**
 * @title TicketPicker
 * @notice Comprehensive library for cryptographically secure on-chain MegapotV2 ticket generation
 * @dev Provides multiple approaches to jackpot ticket generation with varying levels of entropy and security.
 *      Supports both user-provided seeds and fully on-chain entropy sources. All functions use rejection
 *      sampling and domain separation to ensure uniform distribution and prevent cross-function correlation.
 *      
 *      Key features:
 *      - Uniform random distribution across all possible outcomes
 *      - Domain separation between different randomness functions
 *      
 *      Available ticket generation methods:
 *      1. pickBonusball: Single bonusball generation with rejection sampling
 *      2. pickSingleTicket: Complete ticket (5 normal balls + 1 bonusball) generation  
 *      3. pickMultipleTickets: Batch generation with user-provided entropy
 *      4. pickAuto: Fully on-chain batch generation using block-based entropy
 *      
 *      Security model:
 *      - pickBonusball/pickSingleTicket: Security depends on caller-provided seed quality
 *      - pickMultipleTickets: Security depends on caller-provided seed quality
 *      - pickAuto: Security depends on network-specific entropy sources (varies by chain)
 *      
 *      Domain separation tags:
 *      - PICK_AUTO_DST: Used by pickAuto to prevent correlation with other functions
 *      - PICK_BONUSBALL_DST: Used by pickBonusball for isolated randomness generation
 * 
 * @custom:network-considerations
 * - Ethereum mainnet: Full entropy from validator randomness
 * - Optimism/Base: High-quality L1 beacon randomness
 * - Other L2s: Variable entropy quality, test before production
 * - Test networks: May have predictable entropy, not suitable for security testing
 * 
 * @custom:security-best-practices
 * - Never reuse seeds across different ticket batches
 * - Implement proper nonce management for same-block uniqueness. User must manage nonce uniqueness.
 * 
 * @author Megapot Protocol Team
 */
library TicketPicker {
    /// @notice Domain separation tag for #pickAuto
    bytes32 internal constant PICK_AUTO_DST =
        keccak256(bytes("megapot.v2.ticket_picker.pick_auto"));
    /// @notice Domain separation tag for #pickBonusball
    bytes32 internal constant PICK_BONUSBALL_DST =
        keccak256(bytes("megapot.v2.ticket_picker.pick_bonusball"));
    /// @notice Number of normal balls to pick per ticket
    uint8 private constant NORMAL_BALL_COUNT = 5;

    /**
     * @notice Generates a cryptographically secure uniform random bonusball number in the range [1, max]
     * @dev Uses rejection sampling with domain separation to ensure uniform distribution and prevent
     *      cross-function entropy correlation. The function employs an infinite loop with rejection
     *      sampling to eliminate modulo bias that would occur with naive `seed % max` approach.
     *      
     *      Security considerations:
     *      - Uses domain separation tag PICK_BONUSBALL_DST to prevent cross-function attacks
     *      - Incorporates chain ID and contract address to prevent cross-chain/cross-contract replay
     *      - Rejection sampling ensures uniformity across the range [1, max]
     *      - Infinite loop is bounded by cryptographic assumptions (negligible probability of infinite execution)
     * 
     * @param _seed Entropy source for random number generation. Should be cryptographically secure
     *             and unique per call to prevent predictable outcomes
     * @param _max Maximum value for the bonusball (inclusive). Must be in range [1, 255] to fit in uint8
     * 
     * @return bonusball A uniformly distributed random number in the range [1, _max]
     * 
     * @custom:security-note The quality of randomness depends entirely on the input seed. Callers must
     *                       ensure the seed has sufficient entropy in general weak entropy sources are ok
     * @custom:gas-note Gas consumption is probabilistic due to rejection sampling, but bounded by
     *                  cryptographic assumptions with expected iterations < 2 for most practical values.
     */
    function pickBonusball(
        uint256 _seed,
        uint256 _max
    ) internal view returns (uint8) {
        require(_max > 0 && _max <= type(uint8).max, "Invalid max");

        uint256 limit = (type(uint256).max / _max) * _max;
        for (;;) {
            _seed = uint256(
                keccak256(
                    abi.encode(
                        PICK_BONUSBALL_DST,
                        block.chainid,
                        address(this),
                        _seed
                    )
                )
            );
            if (_seed < limit) {
                // seed % max is in [0, max-1], since we cast to uint8 we can
                // allow max to be 255 (check done above)
                return 1 + uint8(_seed % _max);
            }
        }
        // Unreachable
        revert("Unreachable");
    }

    /**
     * @notice Generates a complete jackpot ticket with normal balls and bonusball using cryptographically secure randomness
     * @dev Creates a single ticket by combining Fisher-Yates sampling for normal balls with rejection sampling for bonusball.
     *      The function ensures no duplicate normal balls and maintains uniform distribution across all possible outcomes.
     *      
     *      Implementation details:
     *      - Normal balls are generated using Fisher-Yates rejection sampling from FisherYatesRejection library
     *      - Bonusball is generated using internal rejection sampling via pickBonusball function
     *      - Same seed is used for both components, but domain separation prevents correlation
     *      - Assembly is used for efficient memory layout conversion from uint256[] to uint8[]
     *      
     *      Ticket structure:
     *      - Normal balls: exactly 5 unique numbers in range [1, normalMax]
     *      - Bonusball: single number in range [1, bonusballMax], independent of normal balls
     * 
     * @param _seed Entropy source for ticket generation. Should be unique per ticket to ensure
     *             different outcomes. Same seed will always produce identical tickets
     * @param _normalMax Maximum value for normal balls (inclusive).
     * @param _bonusballMax Maximum value for bonusball (inclusive). Must be in range [1, 255] to fit in uint8.
     * 
     * @return ticket Complete jackpot ticket with 5 unique normal balls and 1 bonusball
     * 
     * @custom:invariants 
     * - Normal balls array will always contain exactly 5 elements
     * - All normal balls will be unique and in range [1, normalMax]
     * - Bonusball will be in range [1, _bonusballMax]
     * - Same seed produces identical tickets (deterministic)
     * 
     * @custom:gas-note Gas consumption is probabilistic due to rejection sampling in both normal ball
     *                  selection and bonusball generation, but bounded by cryptographic assumptions
     */
    function pickSingleTicket(
        uint256 _seed,
        uint8 _normalMax,
        uint8 _bonusballMax  
    ) internal view returns (IJackpot.Ticket memory) {
        // Pick normal balls
        uint256[] memory _normals = FisherYatesRejection.draw(
            1,
            _normalMax,
            NORMAL_BALL_COUNT,
            _seed
        );
        uint8[] memory normals;
        assembly {
            normals := _normals
        }

        // Pick bonusball
        uint8 bonusball = pickBonusball(_seed, _bonusballMax);
        return IJackpot.Ticket({normals: normals, bonusball: bonusball});
    }

    /**
     * @notice Generates multiple jackpot tickets in a batch using a user-provided entropy source
     * @dev Creates an array of unique tickets by deriving individual seeds from the base seed using keccak256.
     *      Each ticket uses `keccak256(abi.encode(_seed, i))` as its unique seed, ensuring different outcomes
     *      for each ticket in the batch even with the same base seed.
     *      
     *      Security model:
     *      - Caller is responsible for providing cryptographically secure seed
     *      - Seed derivation prevents correlation between tickets in the same batch
     *      - Deterministic behavior: same inputs always produce identical ticket arrays
     *      - No protection against seed reuse across different function calls
     *      
     *      Implementation details:
     *      - Uses counter-based seed derivation: `keccak256(abi.encode(baseSeed, ticketIndex))`
     *      - Each derived seed maintains full entropy from the original seed
     *      - Delegates individual ticket generation to pickSingleTicket for consistency
     * 
     * @param _seed Base entropy source for ticket generation. Must be cryptographically secure and unique
     *              per batch to ensure unpredictable outcomes. Same seed will always produce identical batches
     * @param _count Number of tickets to generate (must be > 0). Practical limits depend on block gas limit
     * @param _ballMax Maximum value for normal balls (inclusive). Must be ≥ 5 to ensure unique ball selection
     * @param _bonusballMax Maximum value for bonusball (inclusive). Must be in range [1, 255]
     * 
     * @return tickets Array of jackpot tickets, each with 5 unique normal balls and 1 bonusball
     * 
     * @custom:security-warning 
     * - CRITICAL: Caller must ensure seed has sufficient entropy and is not predictable
     * - Same seed with same parameters will produce identical ticket batches
     * - No built-in protection against seed reuse - caller must manage seed uniqueness
     * - In production, combine with block-based entropy or external randomness sources
     * 
     * @custom:invariants
     * - Array length will equal _count parameter
     * - Each ticket will be unique within the batch (extremely high probability)
     * - All tickets follow same constraints as pickSingleTicket
     */
    function pickMultipleTickets(
        uint256 _seed,
        uint256 _count,
        uint8 _ballMax,
        uint8 _bonusballMax
    ) internal view returns (IJackpot.Ticket[] memory tickets) {
        require(_count > 0, "Pick at least 1 ticket");

        tickets = new IJackpot.Ticket[](_count);
        for (uint256 i; i < _count; ++i) {
            tickets[i] = TicketPicker.pickSingleTicket(
                uint256(keccak256(abi.encode(_seed, i))),
                _ballMax,
                _bonusballMax
            );
        }
    }

    /**
     * @notice Generates jackpot tickets using fully on-chain entropy sources without external randomness
     * @dev Combines multiple on-chain entropy sources to create a seed for ticket generation. Uses domain separation
     *      and includes chain-specific data to prevent cross-chain replay attacks and ensure unique outcomes.
     *      
     *      Entropy sources combined:
     *      - PICK_AUTO_DST: Domain separation tag to prevent cross-function correlation
     *      - address(this): Contract address to prevent cross-contract replay
     *      - block.chainid: Chain identifier to prevent cross-chain replay
     *      - block.prevrandao: Network-specific randomness beacon
     *      - blockhash(block.number - 1): Previous block hash for additional entropy
     *      - _nonce: User-provided nonce to prevent same-block collisions. User must manage nonce uniqueness.
     *      
     *      Security considerations:
     *      - Entropy quality varies by network - strongest on Ethereum mainnet and OP chains.
     *      - Domain separation prevents correlation with other protocol functions.
     * 
     * @param _nonce User-provided nonce to ensure uniqueness within the same block and prevent
     *               collisions when called multiple times with same parameters
     * @param _count Number of tickets to generate (must be > 0). Gas limits apply for large batches
     * @param _ballMax Maximum value for normal balls (inclusive). Must be ≥ 5 for unique ball selection (error
     *                 thrown in FisherYates library)
     * @param _bonusballMax Maximum value for bonusball (inclusive). Must be in range [1, 255]
     * 
     * @return tickets Array of jackpot tickets generated using on-chain entropy
     * 
     * @custom:security-model
     * - Entropy strength: Moderate to high (network-dependent)
     * 
     * @custom:best-practices
     * - CRITICAL: Use unique nonces for each call within the same block.
     */
    function pickAuto(
        uint256 _nonce,
        uint256 _count,
        uint8 _ballMax,
        uint8 _bonusballMax
    ) internal view returns (IJackpot.Ticket[] memory tickets) {
        // Note: count non-zero validation happens in pickMultipleTickets
        // Generate seed using readily-available onchain data
        // NB: block.prevrandao is the last-synced L1 randomness beacon on OP chains, but always 0 (or other behaviour) on other networks.
        uint256 seed = uint256(
            keccak256(
                abi.encode(
                    // Domain separation
                    PICK_AUTO_DST,
                    address(this),
                    block.chainid,
                    // Weak entropy
                    block.prevrandao,
                    blockhash(block.number - 1),
                    // Nonce to prevent collisions in the same block.
                    _nonce
                )
            )
        );

        tickets = pickMultipleTickets(seed, _count, _ballMax, _bonusballMax);
    }
}
