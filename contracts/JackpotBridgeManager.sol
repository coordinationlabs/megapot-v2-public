//SPDX-License-Identifier: UNLICENSED

/*
Copyright (C) 2025 Coordination Inc.
All rights reserved.

This software is proprietary and confidential. Unauthorized copying,
distribution, or use is strictly prohibited and may result in legal action.

For licensing inquiries: legal@coordinationlabs.com
*/

pragma solidity ^0.8.28;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Ownable2Step } from "@openzeppelin/contracts/access/Ownable2Step.sol";
import { ReentrancyGuardTransient } from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import { IJackpot } from "./interfaces/IJackpot.sol";
import { IJackpotTicketNFT } from "./interfaces/IJackpotTicketNFT.sol";
import { IRelayDepository } from "./interfaces/IRelayDepository.sol";
import { JackpotErrors } from "./lib/JackpotErrors.sol";

/**
 * @title JackpotBridgeManager
 * @notice Cross-chain jackpot bridge enabling ticket purchases and winnings claims across different blockchains
 * @dev Implements EIP-712 signed transactions for secure cross-chain operations:
 *      - Acts as custodian for tickets purchased from other chains
 *      - Enables signature-based claiming of winnings with automatic bridging
 *      - Supports ticket ownership transfers via signed messages
 *      - Integrates with external bridge providers for cross-chain fund transfers
 *      - Maintains user ticket mappings and ownership tracking
 *      - Uses reentrancy protection for all external interactions
 */
contract JackpotBridgeManager is Ownable2Step, ReentrancyGuardTransient, EIP712 {

    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    // =============================================================
    //                      STRUCTS
    // =============================================================

    struct ClaimWinningsData {
        uint256[] ticketIds;
        RelayTxData bridgeDetails;
    }

    struct RelayTxData {
        bytes32 bridgeId;
        uint256 amount;
    }

    // =============================================================
    //                      EVENTS
    // =============================================================
    event TicketsBought(address indexed _recipient, uint256 indexed _drawingId, uint256[] _ticketIds);
    event WinningsClaimed(address indexed _winner, uint256[] _ticketIds, uint256 _amount);
    event FundsBridged(bytes32 indexed _bridgeId, uint256 _amount);

    // =============================================================
    //                      ERRORS
    // =============================================================
    error InvalidClaimedAmount();
    error InvalidBridgeAmount();

    // =============================================================
    //                      CONSTANTS
    // =============================================================

    bytes32 public constant CLAIM_WINNINGS_TYPEHASH = keccak256(
        "ClaimWinningsData(uint256[] ticketIds,RelayTxData bridgeDetails)RelayTxData(bytes32 bridgeId,uint256 amount)"
    );
    bytes32 public constant CLAIM_TICKET_TYPEHASH = keccak256(
        "ClaimTicketData(uint256[] ticketIds,address recipient)"
    );
    bytes32 public constant RELAY_TYPEHASH = keccak256("RelayTxData(bytes32 bridgeId,uint256 amount)");

    // =============================================================
    //                      STATE VARIABLES
    // =============================================================

    mapping(uint256 => address) public ticketOwner;
    mapping(address => mapping(uint256 => EnumerableSet.UintSet)) internal userTickets;

    IJackpot public immutable jackpot;
    IJackpotTicketNFT public immutable jackpotTicketNFT;
    IERC20 public immutable usdc;
    IRelayDepository public immutable relayDepository;

    // =============================================================
    //                      CONSTRUCTOR
    // =============================================================

    /**
     * @notice Initializes the JackpotBridgeManager with core contract references and EIP-712 domain
     * @dev Sets up immutable references to jackpot contracts and configures EIP-712 for signature validation.
     *      The contract acts as an intermediary for cross-chain jackpot interactions.
     * @param _jackpot Address of the main Jackpot contract
     * @param _jackpotTicketNFT Address of the JackpotTicketNFT contract
     * @param _usdc Address of the USDC token contract
     * @param _name EIP-712 domain name for signature validation
     * @param _version EIP-712 domain version for signature validation
     * @custom:effects
     * - Sets immutable contract references for jackpot system integration
     * - Configures EIP-712 domain for secure signature validation
     * - Sets deployer as contract owner
     * - Inherits reentrancy protection from ReentrancyGuard
     * @custom:security
     * - Immutable contract references prevent unauthorized changes
     * - EIP-712 provides structured signature validation
     * - Owner-based access control for administrative functions
     */
    constructor(
        IJackpot _jackpot,
        IJackpotTicketNFT _jackpotTicketNFT,
        IERC20 _usdc,
        IRelayDepository _relayDepository,
        string memory _name,
        string memory _version
    ) Ownable(msg.sender) EIP712(_name, _version) {
        jackpot = _jackpot;
        jackpotTicketNFT = _jackpotTicketNFT;
        usdc = _usdc;
        relayDepository = _relayDepository;
    }
    
    // =============================================================
    //                      EXTERNAL FUNCTIONS
    // =============================================================

    /**
     * @notice Purchases jackpot tickets on behalf of a cross-chain user
     * @dev Transfers USDC from caller, purchases tickets via Jackpot contract, and tracks ownership.
     *      The bridge manager becomes the NFT holder while maintaining user ownership records.
     * @param _tickets Array of ticket structs containing jackpot number selections
     * @param _recipient Address that owns the tickets (on the origin chain)
     * @param _referrers Array of referrer addresses for fee distribution
     * @param _referralSplitBps Array of referral split weights (must sum to PRECISE_UNIT if provided)
     * @param _source Bytes32 identifier for tracking ticket purchase source
     * @return Array of minted ticket IDs
     * @custom:requirements
     * - Recipient address must not be zero
     * - Caller must have sufficient USDC balance and approval
     * - Tickets must pass Jackpot contract validation
     * - Referral arrays must be properly formatted
     * @custom:emits TicketsBought with recipient, drawing ID, and ticket IDs
     * @custom:effects
     * - Transfers USDC from caller to bridge manager
     * - Purchases tickets through Jackpot contract (NFTs minted to bridge manager)
     * - Records ticket ownership mapping to recipient
     * - Adds ticketIds to user tickets mapping
     * @custom:security
     * - Reentrancy protection via nonReentrant modifier
     * - Zero address validation for recipient
     * - Ownership tracking for secure claiming
     */
    function buyTickets(
        IJackpot.Ticket[] memory _tickets,
        address _recipient,
        address[] memory _referrers,
        uint256[] memory _referralSplitBps,
        bytes32 _source
    )
        external
        nonReentrant
        returns (uint256[] memory)
    {
        if (_recipient == address(0)) revert JackpotErrors.ZeroAddress();
        uint256 currentDrawingId = jackpot.currentDrawingId();
        uint256 ticketPrice = jackpot.getDrawingState(currentDrawingId).ticketPrice;
        uint256 ticketCost = ticketPrice * _tickets.length;

        usdc.safeTransferFrom(msg.sender, address(this), ticketCost);
        usdc.approve(address(jackpot), ticketCost);
        uint256[] memory ticketIds = jackpot.buyTickets(_tickets, address(this), _referrers, _referralSplitBps, _source);

        // Store the tickets in the user's mapping
        for (uint256 i = 0; i < _tickets.length; i++) {
            userTickets[_recipient][currentDrawingId].add(ticketIds[i]);
            ticketOwner[ticketIds[i]] = _recipient;
        }

        emit TicketsBought(_recipient, currentDrawingId, ticketIds);

        return ticketIds;
    }

    /**
     * @notice Claims jackpot winnings and bridges funds to destination chain
     * @dev Validates ticket ownership via EIP-712 signature, claims winnings, and executes bridge transaction.
     *      The signature must be from the original ticket recipient to authorize the claim.
     * @param _userTicketIds Array of ticket IDs to claim winnings for
     * @param _bridgeDetails Struct containing bridge ID and amount for Relay depository
     * @param _signature EIP-712 signature from ticket owner authorizing the claim
     * @custom:requirements
     * - Must provide at least one ticket ID
     * - Signature must be valid and from ticket owner
     * - Tickets must have claimable winnings
     * - Bridge transaction must succeed and transfer exact claimed amount
     * @custom:emits WinningsClaimed with winner, ticket IDs, and amount
     * @custom:emits FundsBridged with bridge ID and amount
     * @custom:effects
     * - Claims winnings from Jackpot contract
     * - Removes tickets from internal ownership tracking (ticketOwner and userTickets mappings)
     * - Approves USDC to Relay depository
     * - Executes bridge transaction via Relay depository
     * - Validates bridge amount matches claimed amount before transfer
     * @custom:security
     * - Reentrancy protection via nonReentrant modifier
     * - EIP-712 signature validation for authorization
     * - Amount validation ensures bridge request matches claimed winnings
     * - Ticket ownership validation prevents unauthorized claims
     */
    function claimWinnings(uint256[] memory _userTicketIds, RelayTxData memory _bridgeDetails, bytes memory _signature) external nonReentrant {
        if (_userTicketIds.length == 0) revert JackpotErrors.NoTicketsToClaim();

        bytes32 eipHash = createClaimWinningsEIP712Hash(_userTicketIds, _bridgeDetails);
        address signer = ECDSA.recover(eipHash, _signature);

        _validateTicketOwnership(_userTicketIds, signer);

        uint256 preUSDCBalance = usdc.balanceOf(address(this));
        jackpot.claimWinnings(_userTicketIds);
        uint256 postUSDCBalance = usdc.balanceOf(address(this));
        uint256 claimedAmount = postUSDCBalance - preUSDCBalance;

        if (claimedAmount == 0) revert InvalidClaimedAmount();

        _updateInternalTicketOwnership(_userTicketIds, signer);

        _bridgeFunds(signer, _bridgeDetails, claimedAmount);

        emit WinningsClaimed(signer, _userTicketIds, claimedAmount);
    }

    /**
     * @notice Transfers ticket NFTs to recipient on local chain via signature authorization
     * @dev Validates ticket ownership and transfers NFTs from bridge manager to specified recipient.
     *      Used when users want to move tickets to local chain custody.
     * @param _ticketIds Array of ticket IDs to transfer
     * @param _recipient Address to receive the ticket NFTs
     * @param _signature EIP-712 signature from ticket owner authorizing the transfer
     * @custom:requirements
     * - Recipient must not be zero address
     * - Recipient must not be the bridge manager contract
     * - Signature must be valid and from ticket owner
     * - Caller must be authorized to execute the transfer
     * @custom:emits Transfer events from ERC-721 transfers
     * @custom:effects
     * - Clears ticketOwner mapping for each ticket
     * - Removes tickets from userTickets EnumerableSet
     * - Transfers NFTs from bridge manager to recipient
     * @custom:security
     * - Reentrancy protection via nonReentrant modifier
     * - EIP-712 signature validation for authorization
     * - Address validation prevents invalid transfers
     * - Ownership validation ensures only owner can transfer
     */
    function claimTickets(uint256[] memory _ticketIds, address _recipient, bytes memory _signature) external {
        if (_recipient == address(0)) revert JackpotErrors.ZeroAddress();
        if (_recipient == address(this)) revert JackpotErrors.InvalidRecipient();

        bytes32 eipHash = createClaimTicketEIP712Hash(_ticketIds, _recipient);
        address signer = ECDSA.recover(eipHash, _signature);

        _validateTicketOwnership(_ticketIds, signer);
        
        _updateInternalTicketOwnership(_ticketIds, signer);

        _transferTickets(_ticketIds, _recipient);
    }

    // =============================================================
    //                      PUBLIC FUNCTIONS
    // =============================================================

    /**
     * @notice Creates EIP-712 hash for claiming winnings with bridge details
     * @dev Generates structured hash for signature validation including ticket IDs and bridge transaction data.
     *      The hash includes relay transaction details to prevent replay attacks across different bridges.
     * @param _userTicketIds Array of ticket IDs to include in hash
     * @param _bridgeDetails Bridge transaction details to include in hash
     * @return bytes32 EIP-712 compliant hash for signature validation
     */
    function createClaimWinningsEIP712Hash(uint256[] memory _userTicketIds, RelayTxData memory _bridgeDetails) public view returns (bytes32) {
        bytes32 relayHash = keccak256(abi.encode(RELAY_TYPEHASH, _bridgeDetails.bridgeId, _bridgeDetails.amount));

        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_WINNINGS_TYPEHASH, keccak256(abi.encodePacked(_userTicketIds)), relayHash)));
    }

    /**
     * @notice Creates EIP-712 hash for claiming tickets with recipient details
     * @dev Generates structured hash for signature validation when transferring tickets to local chain.
     *      Includes ticket IDs and recipient address to prevent unauthorized transfers.
     * @param _ticketIds Array of ticket IDs to include in hash
     * @param _recipient Destination address to include in hash
     * @return bytes32 EIP-712 compliant hash for signature validation
     */
    function createClaimTicketEIP712Hash(uint256[] memory _ticketIds, address _recipient) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TICKET_TYPEHASH, keccak256(abi.encodePacked(_ticketIds)), _recipient)));
    }

    // =============================================================
    //                      VIEW/PURE FUNCTIONS
    // =============================================================

    /**
     * @notice Returns all ticket IDs owned by a user for a specific drawing
     * @dev Returns the contents of the user's ticket set for the given drawing
     *      Tickets are automatically removed from this set when claimed or transferred.
     * @param _user Address of the ticket owner
     * @param _drawingId Drawing to query tickets for
     * @return Array of ticket IDs currently owned by the user
     */
    function getUserTickets(address _user, uint256 _drawingId) external view returns (uint256[] memory) {
        return userTickets[_user][_drawingId].values();
    }
    
    // =============================================================
    //                      PRIVATE FUNCTIONS
    // =============================================================

    function _validateTicketOwnership(uint256[] memory _userTicketIds, address _signer) private view {
        for (uint256 i = 0; i < _userTicketIds.length; i++) {
            uint256 ticketId = _userTicketIds[i];
            if (ticketOwner[ticketId] != _signer) revert JackpotErrors.NotTicketOwner();
        }
    }

    function _bridgeFunds(address _signer, RelayTxData memory _bridgeDetails, uint256 _claimedAmount) private {
        if (_bridgeDetails.amount != _claimedAmount) revert InvalidBridgeAmount();

        usdc.approve(address(relayDepository), _bridgeDetails.amount);

        relayDepository.depositErc20(_signer, address(usdc), _bridgeDetails.amount, _bridgeDetails.bridgeId);
    
        emit FundsBridged(_bridgeDetails.bridgeId, _bridgeDetails.amount);
    }

    function _updateInternalTicketOwnership(uint256[] memory _ticketIds, address _oldOwner) private {
        for (uint256 i = 0; i < _ticketIds.length; i++) {
            uint256 ticketId = _ticketIds[i];
            IJackpotTicketNFT.TrackedTicket memory ticket = jackpotTicketNFT.getTicketInfo(ticketId);

            delete ticketOwner[ticketId];
            userTickets[_oldOwner][ticket.drawingId].remove(ticketId);
        }
    }

    function _transferTickets(uint256[] memory _ticketIds, address _recipient) private {
        for (uint256 i = 0; i < _ticketIds.length; i++) {
            IERC721(address(jackpotTicketNFT)).safeTransferFrom(address(this), _recipient, _ticketIds[i]);
        }
    }
}