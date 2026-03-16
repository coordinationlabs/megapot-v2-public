//SPDX-License-Identifier: UNLICENSED

pragma solidity ^0.8.28;

import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SignedMath } from "@openzeppelin/contracts/utils/math/SignedMath.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { DateTimeLib } from "../external/DateTimeLib.sol";

import { IJackpot } from "../interfaces/IJackpot.sol";
import { IJackpotTicketNFT } from "../interfaces/IJackpotTicketNFT.sol";
import { ITicketArt } from "../interfaces/ITicketArt.sol";

/**
 * @title TicketNFTArt
 * @notice Generates on-chain SVG artwork and metadata for Megapot ticket NFTs
 * @dev This contract renders ticket numbers as SVG paths and produces base64-encoded
 *      JSON metadata conforming to the ERC721 metadata standard. The SVG paths for
 *      digits (0-9) and their positions are configurable by the owner.
 */
contract TicketNFTArt is ITicketArt, Ownable {
    using Strings for uint256;
    using Strings for uint8;

    struct PathCache {
        uint256 number;
        string path;
        int256 xOffset;
        int256 yOffset;
    }

    struct PathPositions {
        uint256 position;
        uint256 anchor;
    }

    // Mapping of number to path element
    mapping(uint256 => PathCache) public pathCache;
    // Mapping of number position (1-6) to anchor on ticket (bonusball is position 6)
    mapping(uint256 => PathPositions) public pathPositions;

    // SVG constants
    string constant SVG_HEADER = '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="460" fill="none" viewBox="0 0 460 460"><g filter="url(#a)"><mask id="b" width="240" height="280" x="110" y="90" maskUnits="userSpaceOnUse" style="mask-type:alpha"><path fill="#fff" d="M334 90c8.837 0 16 7.163 16 16v172.035c-6.196.471-11.077 5.648-11.077 11.965s4.881 11.494 11.077 11.965V354c0 8.837-7.163 16-16 16H126c-8.837 0-16-7.163-16-16v-52.035q.457.035.923.035c6.627 0 12-5.373 12-12s-5.373-12-12-12q-.466 0-.923.035V106c0-8.837 7.163-16 16-16z"/></mask><g mask="url(#b)"><path fill="#fff" d="M110 90h240v200H110z"/><path fill="#7b7f8a" d="M126.792 116v-8.52h1.596l2.58 6.12v-6.12h1.44V116h-1.596l-2.58-6.12V116zm10.003.192q-1.38 0-2.16-.816-.768-.828-.768-2.328v-5.568h1.488v5.664q0 .816.36 1.26.372.444 1.08.444t1.068-.444q.372-.444.372-1.26v-5.664h1.488v5.568q0 1.5-.78 2.328-.768.816-2.148.816m6.704-1.296-1.344-5.592.18-.024V116h-1.392v-8.52h1.8l1.476 5.928h-.456l1.476-5.928h1.8V116h-1.392v-6.72l.18.024-1.344 5.592zm4.999 1.104v-8.52h2.544q1.416 0 2.16.6.744.588.744 1.704 0 .516-.24.936a1.7 1.7 0 0 1-.696.66q-.456.24-1.128.276v-.084q.816.024 1.344.288.54.264.804.732.276.456.276 1.056 0 1.14-.78 1.752-.78.6-2.208.6zm1.476-1.344h1.344q.744-.012 1.092-.3.36-.3.36-.828 0-.564-.372-.876-.36-.312-1.08-.312h-1.344zm0-3.636h1.068q.708 0 1.032-.288.336-.288.336-.816t-.336-.804q-.324-.288-1.032-.288h-1.068zm5.839 4.98v-8.52h5.28v1.368h-3.792v2.22h3.648v1.32h-3.648v2.244h3.888V116zm6.932 0v-8.52h2.7q1.368 0 2.148.684t.78 1.872q0 .612-.276 1.08a2.04 2.04 0 0 1-.708.744q-.444.264-.972.3l-.048-.156q.924.036 1.38.408.456.36.528 1.188l.204 2.4h-1.488l-.18-2.052q-.036-.456-.18-.708a.7.7 0 0 0-.42-.348q-.276-.096-.768-.096h-1.212V116zm1.488-4.572h1.176q.696 0 1.056-.336.372-.336.372-.96t-.372-.948q-.36-.336-1.056-.336h-1.176zm8.623 4.764q-.936 0-1.632-.372a2.77 2.77 0 0 1-1.08-1.044q-.396-.684-.468-1.608l1.512-.084q.084.588.3.984.228.384.588.588.372.192.852.192.456 0 .768-.12.324-.12.492-.36a.98.98 0 0 0 .168-.576q0-.36-.168-.624t-.6-.492-1.236-.444q-.864-.228-1.416-.528t-.816-.744q-.264-.456-.264-1.14 0-.768.336-1.332.348-.576.996-.888.66-.312 1.572-.312.9 0 1.536.348.636.336.996.972.372.624.456 1.488l-1.524.072a2.2 2.2 0 0 0-.252-.804 1.3 1.3 0 0 0-.504-.54q-.312-.192-.768-.192-.612 0-.972.312a.98.98 0 0 0-.36.792q0 .348.156.576.168.228.564.408t1.116.36q.996.264 1.572.624.588.36.84.864t.252 1.188q0 .732-.372 1.284a2.4 2.4 0 0 1-1.044.852q-.672.3-1.596.3M298.912 116v-8.52h2.544q1.416 0 2.16.6.744.588.744 1.704 0 .516-.24.936a1.7 1.7 0 0 1-.696.66q-.456.24-1.128.276v-.084q.816.024 1.344.288.54.264.804.732.276.456.276 1.056 0 1.14-.78 1.752-.78.6-2.208.6zm1.476-1.344h1.344q.744-.012 1.092-.3.36-.3.36-.828 0-.564-.372-.876-.36-.312-1.08-.312h-1.344zm0-3.636h1.068q.708 0 1.032-.288.336-.288.336-.816t-.336-.804q-.324-.288-1.032-.288h-1.068zm8.407 5.172q-1.02 0-1.74-.516-.708-.516-1.08-1.512t-.372-2.412q0-1.44.372-2.436t1.08-1.512q.72-.516 1.74-.516t1.728.516q.72.516 1.092 1.512t.372 2.436q0 1.416-.372 2.412t-1.092 1.512q-.708.516-1.728.516m0-1.344q.54 0 .912-.336t.552-1.02q.192-.696.192-1.74t-.192-1.74q-.18-.696-.552-1.032a1.29 1.29 0 0 0-.912-.348q-.54 0-.912.348-.372.336-.564 1.032-.18.696-.18 1.74t.18 1.74q.192.684.564 1.02t.912.336m4.388 1.152v-8.52h1.596l2.58 6.12v-6.12h1.44V116h-1.596l-2.58-6.12V116zm10.003.192q-1.38 0-2.16-.816-.768-.828-.768-2.328v-5.568h1.488v5.664q0 .816.36 1.26.372.444 1.08.444t1.068-.444q.372-.444.372-1.26v-5.664h1.488v5.568q0 1.5-.78 2.328-.768.816-2.148.816m7.279 0q-.936 0-1.632-.372a2.77 2.77 0 0 1-1.08-1.044q-.396-.684-.468-1.608l1.512-.084q.084.588.3.984.228.384.588.588.372.192.852.192.456 0 .768-.12.324-.12.492-.36a.98.98 0 0 0 .168-.576q0-.36-.168-.624t-.6-.492-1.236-.444q-.864-.228-1.416-.528t-.816-.744q-.264-.456-.264-1.14 0-.768.336-1.332.348-.576.996-.888.66-.312 1.572-.312.9 0 1.536.348.636.336.996.972.372.624.456 1.488l-1.524.072a2.2 2.2 0 0 0-.252-.804 1.3 1.3 0 0 0-.504-.54q-.312-.192-.768-.192-.612 0-.972.312a.98.98 0 0 0-.36.792q0 .348.156.576.168.228.564.408t1.116.36q.996.264 1.572.624.588.36.84.864t.252 1.188q0 .732-.372 1.284a2.4 2.4 0 0 1-1.044.852q-.672.3-1.596.3"/>';
    string constant SVG_CIRCLE = '<g data-figma-bg-blur-radius="40"><rect width="23" height="23" x="310.5" y="126.5" stroke="#111827" rx="11.5"/>';
    string constant SVG_FOOTER = '</g><mask id="d" fill="#fff"><path d="M110 290h240v80H110z"/></mask><path fill="#fff" d="M110 290h240v80H110z"/><path fill="#f0f0f0" d="M350 290v-.5h-2v1h2zm-6 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-4v1h4zm-8 0v-.5h-2v1h2zm238 0v-1h-2v2h2zm-6 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-4v2h4zm-8 0v-1h-2v2h2z" mask="url(#d)"/><g clip-path="url(#e)"><mask id="f" width="107" height="20" x="126" y="320" maskUnits="userSpaceOnUse" style="mask-type:luminance"><path fill="#fff" d="M233 320H126v20h107z"/></mask><g fill="#111827" mask="url(#f)"><path d="m159.036 324.154 1.064-3.715h-10.219l-5.475 19.164h10.219l1.063-3.715h-5.262l1.235-4.33h4.359l1.05-3.729h-4.359l1.063-3.675zM172.393 322.825q-.591-1.303-2.013-2.011t-3.535-.709q-1.953 0-3.368.655t-2.306 1.804q-.89 1.15-1.328 2.713l-1.954 6.962q-.69 2.38-.219 4.109.471 1.731 2.026 2.66t4.093.929q1.568 0 2.983-.374 1.416-.375 2.346-.962l2.631-9.315h-6.923l-1.01 3.555h2.112l-.87 3.033a3 3 0 0 1-.259.088q-.359.1-.757.1-.612 0-1.004-.281a1.27 1.27 0 0 1-.505-.789q-.112-.507.087-1.229l2.352-8.245q.16-.535.358-.889.2-.354.486-.528.285-.173.684-.174.678 0 .93.448t.08 1.196l-.452 1.59h5.222l.358-1.296q.346-1.737-.246-3.04zM178.281 320.439l-8.664 19.164h5.183l1.578-3.916h2.693l-.631 3.916h5.05l2.126-19.164zm1.411 11.453h-1.778l2.943-7.28-1.166 7.28zM200.17 323.58q-.3-1.497-1.449-2.319t-3.102-.822h-5.568l-5.475 19.164h4.957l1.94-6.802h1.076q2.06 0 3.489-.575a5.6 5.6 0 0 0 2.358-1.757q.93-1.183 1.435-3.041l.093-.36q.545-1.991.246-3.488m-4.95 2.659-.266.922q-.32 1.122-.83 1.637-.513.515-1.376.515h-.279l1.542-5.399h.265q.518 0 .804.24.285.242.326.762.039.522-.186 1.323M221.373 320.439l-1.143 4.023h3.335l-4.332 15.141h4.957l4.318-15.141h3.336l1.156-4.023zM141.547 320.439l-5.07 11.728 1.642-11.728h-6.644L126 339.603h4.398l3.392-11.869-1.478 11.869h4.172l5.348-12.096-3.461 12.096h4.438l5.475-19.164z"/><path d="M210.412 320c-5.491 0-9.943 4.477-9.943 10s4.452 10 9.943 10c5.492 0 9.944-4.477 9.944-10s-4.452-10-9.944-10m2.882 18.573c-1.559-4.088-6.498-5.649-10.102-3.192 3.384-2.755 3.334-7.962-.103-10.65 3.65 2.386 8.559.729 10.039-3.389-1.128 4.229 1.956 8.412 6.307 8.555-4.348.228-7.35 4.47-6.141 8.676"/></g></g></g></g><defs><clipPath id="c" transform="translate(-270 -86)"><rect width="23" height="23" x="310.5" y="126.5" rx="11.5"/></clipPath><clipPath id="e"><path fill="#fff" d="M126 320h107v20H126z"/></clipPath><filter id="a" width="288" height="328" x="86" y="68" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse"><feFlood flood-opacity="0" result="BackgroundImageFix"/><feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset dy="2"/><feGaussianBlur stdDeviation="12"/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.04 0"/><feBlend in2="BackgroundImageFix" result="effect1_dropShadow_8110_78882"/><feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset dy="4"/><feGaussianBlur stdDeviation="2"/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0"/><feBlend in2="effect1_dropShadow_8110_78882" result="effect2_dropShadow_8110_78882"/><feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset dy="2"/><feGaussianBlur stdDeviation="1"/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.01 0"/><feBlend in2="effect2_dropShadow_8110_78882" result="effect3_dropShadow_8110_78882"/><feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/><feOffset/><feComposite in2="hardAlpha" operator="out"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0"/><feBlend in2="effect3_dropShadow_8110_78882" result="effect4_dropShadow_8110_78882"/><feBlend in="SourceGraphic" in2="effect4_dropShadow_8110_78882" result="shape"/></filter></defs></svg>';

    // Path placement constants
    uint256 constant GRID_PRECISION = 100;
    uint256 constant VERTICAL_ANCHOR = 14250;       // y-axis anchor for the numbers
    uint256 constant SECOND_DIGIT_OFFSET = 800;     // Offset for the second digit of the numbers (if necessary)
    uint256 constant BB_SECOND_DIGIT_OFFSET = 450;  // Centering the bonus ball when it is double digit
    uint256 constant BB_POSITION = 6;

    IJackpot public immutable jackpot;

    // Custom errors
    error InvalidDigit(uint256 number);
    error InvalidPosition(uint256 position);

    // Events
    event PathCacheUpdated(uint256 indexed number, string path, int256 xOffset, int256 yOffset);
    event PathPositionsUpdated(uint256 indexed position, uint256 anchor);

    /**
     * @notice Initializes the TicketNFTArt contract
     * @param _jackpot The address of the Jackpot contract used to retrieve drawing data
     */
    constructor(
        IJackpot _jackpot
    )
        Ownable(msg.sender)
    {
        jackpot = _jackpot;
    }   

    /**
     * @notice Generates a base64-encoded JSON metadata URI for a ticket NFT
     * @param _ticket The extended ticket data including ticket ID, drawing info, and ball numbers
     * @return A data URI containing base64-encoded JSON metadata with name, description, image, and attributes
     */
    function generateTokenURI(
        IJackpotTicketNFT.ExtendedTrackedTicket memory _ticket
    )
        external
        view
        returns (string memory)
    {
        string memory svg = _generateSVG(_ticket);

        (
            bool drawingSettled,
            uint256 winTierId,
            uint256 winAmount
        ) = _getTicketOutcome(_ticket);
        string memory json = Base64.encode(
            bytes(
                string(
                    abi.encodePacked(
                        '{"name": "Megapot Ticket for ',
                        _calculateDrawingDate(_ticket.ticket.drawingId),
                        '", "description": "A ticket for Megapot Lottery Drawing #',
                        _ticket.ticket.drawingId.toString(),
                        '. Check results at megapot.io", "image": "data:image/svg+xml;base64,',
                        Base64.encode(bytes(svg)),
                        '", "attributes": [{"trait_type": "Drawing Date", "value": "',
                        _calculateDrawingDate(_ticket.ticket.drawingId),
                        '"}, {"trait_type": "Drawing ID", "value": "',
                        _ticket.ticket.drawingId.toString(),
                        '"}, {"trait_type": "Normal Ball 1", "value": "',
                        _ticket.normals[0].toString(),
                        '"}, {"trait_type": "Normal Ball 2", "value": "',
                        _ticket.normals[1].toString(),
                        '"}, {"trait_type": "Normal Ball 3", "value": "',
                        _ticket.normals[2].toString(),
                        '"}, {"trait_type": "Normal Ball 4", "value": "',
                        _ticket.normals[3].toString(),
                        '"}, {"trait_type": "Normal Ball 5", "value": "',
                        _ticket.normals[4].toString(),
                        '"}, {"trait_type": "Bonus Ball", "value": "',
                        _ticket.bonusball.toString(),
                        '"}, {"trait_type": "Tier", "value": "',
                        drawingSettled ? winTierId.toString() : "Not Settled",
                        '"}, {"trait_type": "Win Amount", "value": "',
                        drawingSettled ? winAmount.toString() : "Not Settled",
                        '"}, {"trait_type": "Ticket Id", "value": "',
                        _ticket.ticketId.toString(),
                        '"}, {"trait_type": "Referral Scheme Id", "value": "',
                        uint256(_ticket.ticket.referralScheme).toString(),
                        '"}]}'
                    )
                )
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", json));
    }

    /**
     * @notice Returns the path position configuration for a given position index
     * @param _position The position index (1-5 for normal balls, 6 for bonus ball)
     * @return The PathPositions struct containing position and anchor data
     */
    function getPathPositions(
        uint256 _position
    )
        external
        view
        returns (PathPositions memory)
    {
        return pathPositions[_position];
    }

    // =============================================================
    //                       ADMIN FUNCTIONS
    // =============================================================

    /**
     * @notice Updates the SVG path cache for rendering ticket numbers
     * @dev Each PathCache entry contains the SVG path data and x/y offsets for a digit (0-9).
     *      These paths are used to render numbers on the ticket NFT image.
     * @param _pathCaches Array of PathCache structs to store, keyed by their number field
     */
    function updatePathCaches(
        PathCache[] memory _pathCaches
    )
        external
        onlyOwner
    {
        for (uint256 i = 0; i < _pathCaches.length; i++) {
            if (_pathCaches[i].number > 9) revert InvalidDigit(_pathCaches[i].number);
            pathCache[_pathCaches[i].number] = _pathCaches[i];
            emit PathCacheUpdated(
                _pathCaches[i].number,
                _pathCaches[i].path,
                _pathCaches[i].xOffset,
                _pathCaches[i].yOffset
            );
        }
    }

    /**
     * @notice Updates the anchor positions for placing numbers on the ticket SVG
     * @dev Position 1-5 correspond to normal balls, position 6 is the bonus ball.
     *      The anchor value determines the x-coordinate base position for each number slot.
     * @param _pathPositions Array of PathPositions structs to store, keyed by their position field
     */
    function updatePathPositions(
        PathPositions[] memory _pathPositions
    )
        external
        onlyOwner
    {
        for (uint256 i = 0; i < _pathPositions.length; i++) {
            if (_pathPositions[i].position == 0 || _pathPositions[i].position > 6) {
                revert InvalidPosition(_pathPositions[i].position);
            }
            pathPositions[_pathPositions[i].position] = _pathPositions[i];
            emit PathPositionsUpdated(
                _pathPositions[i].position,
                _pathPositions[i].anchor
            );
        }
    }

    // =============================================================
    //                       INTERNAL FUNCTIONS
    // =============================================================

    function _generateSVG(
        IJackpotTicketNFT.ExtendedTrackedTicket memory _ticket
    )
        internal
        view
        returns (string memory)
    {
        return string(
            abi.encodePacked(
                SVG_HEADER,
                _positionPathElement(1, _ticket.normals[0]),
                _positionPathElement(2, _ticket.normals[1]),
                _positionPathElement(3, _ticket.normals[2]),
                _positionPathElement(4, _ticket.normals[3]),
                _positionPathElement(5, _ticket.normals[4]),
                SVG_CIRCLE,
                _positionPathElement(6, _ticket.bonusball),
                SVG_FOOTER
            )
        );
    }

    function _calculateDrawingDate(
        uint256 _drawingId
    )
        internal
        view
        returns (string memory)
    {
        uint256 drawingTimestamp = jackpot.getDrawingState(_drawingId).drawingTime;
        (
            uint256 year,
            uint256 month,
            uint256 day
        ) = DateTimeLib.timestampToDate(drawingTimestamp);
        return string(abi.encodePacked(_getMonthName(month), " ", day.toString(), ", ", year.toString()));
    }

    function _getMonthName(uint256 _month) internal pure returns (string memory) {
        if (_month == 1) return "Jan";
        if (_month == 2) return "Feb";
        if (_month == 3) return "Mar";
        if (_month == 4) return "Apr";
        if (_month == 5) return "May";
        if (_month == 6) return "Jun";
        if (_month == 7) return "Jul";
        if (_month == 8) return "Aug";
        if (_month == 9) return "Sep";
        if (_month == 10) return "Oct";
        if (_month == 11) return "Nov";
        return "Dec";
    }

    function _getTicketOutcome(
        IJackpotTicketNFT.ExtendedTrackedTicket memory _ticket
    )
        internal
        view
        returns (bool drawingSettled, uint256 winTierId, uint256 winAmount)
    {
        drawingSettled = true;
        uint256 currentDrawingId = jackpot.currentDrawingId();
        // If drawing not settled return false
        if (_ticket.ticket.drawingId >= currentDrawingId) return (false, 0, 0);

        uint256[] memory ticketIds = new uint256[](1);
        ticketIds[0] = _ticket.ticketId;
        uint256[] memory tierIds = jackpot.getTicketTierIds(ticketIds);
        uint256[12] memory tierPayouts = jackpot.getDrawingTierPayouts(_ticket.ticket.drawingId);

        winTierId = tierIds[0];
        winAmount = tierPayouts[winTierId];
    }

    /**
     * @dev Generates a positioned SVG path element for a ticket number.
     *
     *      For single digits (0-9): Centers the digit at the position's anchor point,
     *      applying the digit's x/y offsets for fine-tuning.
     *
     *      For double digits (10-99): Renders two separate path elements - first digit
     *      at the anchor, second digit offset by SECOND_DIGIT_OFFSET. The bonus ball
     *      position (6) applies additional centering via BB_SECOND_DIGIT_OFFSET.
     *
     *      Coordinates use GRID_PRECISION (100) for decimal precision, e.g., 12914 = 129.14
     */
    function _positionPathElement(
        uint256 _position,
        uint8 _number
    )
        internal
        view
        returns (string memory) {
            // Single digit: center at anchor with offset adjustments
            if (_number < 10) {
                uint256 yPosition = pathCache[_number].yOffset > 0 ?
                    VERTICAL_ANCHOR + SignedMath.abs(pathCache[_number].yOffset) :
                    VERTICAL_ANCHOR - SignedMath.abs(pathCache[_number].yOffset);
                uint256 xPosition = pathCache[_number].xOffset > 0 ?
                    pathPositions[_position].anchor + SignedMath.abs(pathCache[_number].xOffset) :
                    pathPositions[_position].anchor - SignedMath.abs(pathCache[_number].xOffset);
                return string(abi.encodePacked(
                    '<path fill="#000" d="M',
                    (xPosition / GRID_PRECISION).toString(),
                    '.',
                    (xPosition % GRID_PRECISION).toString(),
                    ' ',
                    (yPosition / GRID_PRECISION).toString(),
                    '.',
                    (yPosition % GRID_PRECISION).toString(),
                    pathCache[_number].path,
                    '"/>'
                ));
            } else {
                // Double digit: split into two path elements with offset between them
                uint256 firstDigit = _number / 10;
                uint256 secondDigit = _number % 10;
                uint256 yPosition = pathCache[firstDigit].yOffset > 0 ?
                    VERTICAL_ANCHOR + SignedMath.abs(pathCache[firstDigit].yOffset) :
                    VERTICAL_ANCHOR - SignedMath.abs(pathCache[firstDigit].yOffset);
                uint256 yPosition2 = pathCache[secondDigit].yOffset > 0 ?
                    VERTICAL_ANCHOR + SignedMath.abs(pathCache[secondDigit].yOffset) :
                    VERTICAL_ANCHOR - SignedMath.abs(pathCache[secondDigit].yOffset);
                uint256 xPosition = pathCache[firstDigit].xOffset > 0 ?
                    pathPositions[_position].anchor + SignedMath.abs(pathCache[firstDigit].xOffset) :
                    pathPositions[_position].anchor - SignedMath.abs(pathCache[firstDigit].xOffset);
                uint256 xPosition2 = pathCache[secondDigit].xOffset > 0 ?
                    pathPositions[_position].anchor + SECOND_DIGIT_OFFSET + SignedMath.abs(pathCache[secondDigit].xOffset) :
                    pathPositions[_position].anchor + SECOND_DIGIT_OFFSET - SignedMath.abs(pathCache[secondDigit].xOffset);
                return string(abi.encodePacked(
                    '<path fill="#000" d="M',
                    ((_position != BB_POSITION ? xPosition : xPosition - BB_SECOND_DIGIT_OFFSET) / GRID_PRECISION).toString(),
                    '.',
                    ((_position != BB_POSITION ? xPosition : xPosition - BB_SECOND_DIGIT_OFFSET) % GRID_PRECISION).toString(),
                    ' ',
                    (yPosition / GRID_PRECISION).toString(),
                    '.',
                    (yPosition % GRID_PRECISION).toString(),
                    pathCache[firstDigit].path,
                    '"/>',
                    '<path fill="#000" d="M',
                    ((_position != BB_POSITION ? xPosition2 : xPosition2 - BB_SECOND_DIGIT_OFFSET) / GRID_PRECISION).toString(),
                    '.',
                    ((_position != BB_POSITION ? xPosition2 : xPosition2 - BB_SECOND_DIGIT_OFFSET) % GRID_PRECISION).toString(),
                    ' ',
                    (yPosition2 / GRID_PRECISION).toString(),
                    '.',
                    (yPosition2 % GRID_PRECISION).toString(),
                    pathCache[secondDigit].path,
                    '"/>'
                ));
            }
        }
}
