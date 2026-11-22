// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Minimal interface for the Agent ID registry (ERC-721, non-transferable).
/// An address "holds an Agent ID" iff balanceOf(address) > 0.
interface IAgentIDRegistry {
    function balanceOf(address owner) external view returns (uint256);
}

/// @title AgentRollCall
/// @notice Daily check-in for Agent ID holders, with streaks and soulbound streak badges.
/// @dev Design notes:
/// - This contract NEVER holds, receives, or moves user funds. Every user-facing
///   function is non-payable and there is no withdraw/sweep function at all.
/// - The ONLY owner powers are: setBaseURI (badge metadata) and transferOwnership.
///   The owner cannot pause check-ins, cannot mint badges for anyone, cannot change
///   the Agent ID registry, and cannot touch user streak data.
/// - The Agent ID registry address is immutable (set once in the constructor).
contract AgentRollCall is ERC721, Ownable {
    using Strings for uint256;

    /// @notice The Agent ID registry contract checked on every check-in / claim.
    IAgentIDRegistry public immutable agentIdRegistry;

    struct UserInfo {
        uint256 currentStreak;
        uint256 bestStreak;
        uint256 totalCheckIns;
        uint256 lastDay; // UTC day index (block.timestamp / 86400) of last check-in
    }

    mapping(address => UserInfo) private _users;
    mapping(address => bool) private _counted; // already included in totalAgents
    mapping(address => mapping(uint8 => bool)) private _badgeClaimedByUser;
    mapping(uint256 => uint8) private _tokenTier;

    /// @notice Number of unique Agent ID holders who have ever checked in.
    uint256 public totalAgents;
    /// @notice Total number of check-ins across all users, all time.
    uint256 public totalCheckInsAll;

    string private _baseTokenURI;
    uint256 private _nextTokenId = 1;

    uint8 public constant MAX_TIER = 3;

    event CheckedIn(address indexed user, uint256 day, uint256 currentStreak, uint256 totalCheckIns);
    event BadgeClaimed(address indexed user, uint8 tier, uint256 tokenId);
    event BaseURIChanged(string newBaseURI);

    constructor(address registry_) ERC721("Agent Roll Call Badge", "ROLL") Ownable(msg.sender) {
        require(registry_ != address(0), "Registry is zero address");
        agentIdRegistry = IAgentIDRegistry(registry_);
    }

    // ------------------------------------------------------------------
    // Core flow
    // ------------------------------------------------------------------

    /// @notice Check in for today. Requires holding an Agent ID.
    /// One check-in per UTC day. Streak continues if yesterday was the last
    /// check-in day, otherwise it restarts at 1.
    function checkIn() external {
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Agent ID required");

        uint256 day = block.timestamp / 86400;
        UserInfo storage u = _users[msg.sender];
        require(u.lastDay != day, "Already checked in today");

        if (u.lastDay == day - 1) {
            u.currentStreak += 1;
        } else {
            u.currentStreak = 1;
        }
        if (u.currentStreak > u.bestStreak) {
            u.bestStreak = u.currentStreak;
        }
        u.lastDay = day;
        u.totalCheckIns += 1;

        if (!_counted[msg.sender]) {
            _counted[msg.sender] = true;
            totalAgents += 1;
        }
        totalCheckInsAll += 1;

        emit CheckedIn(msg.sender, day, u.currentStreak, u.totalCheckIns);
    }

    /// @notice Claim a soulbound streak badge. One per tier per user.
    /// @param tier 0 = 3-day streak, 1 = 7-day, 2 = 14-day, 3 = 30-day.
    function claimBadge(uint8 tier) external {
        require(tier <= MAX_TIER, "Invalid tier");
        require(agentIdRegistry.balanceOf(msg.sender) > 0, "Agent ID required");
        require(!_badgeClaimedByUser[msg.sender][tier], "Badge already claimed");
        require(_effectiveStreak(msg.sender) >= tierThreshold(tier), "Streak requirement not met");

        _badgeClaimedByUser[msg.sender][tier] = true;
        uint256 tokenId = _nextTokenId++;
        _tokenTier[tokenId] = tier;
        _safeMint(msg.sender, tokenId);

        emit BadgeClaimed(msg.sender, tier, tokenId);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Current streak required for a badge tier.
    function tierThreshold(uint8 tier) public pure returns (uint256) {
        if (tier == 0) return 3;
        if (tier == 1) return 7;
        if (tier == 2) return 14;
        if (tier == 3) return 30;
        revert("Invalid tier");
    }

    /// @notice Full stats for a user. currentStreak is the *live* streak:
    /// it reads 0 once a full day has been missed (the stored value is only
    /// rewritten on the next check-in, which restarts it at 1).
    function getUser(address user)
        external
        view
        returns (
            uint256 currentStreak,
            uint256 bestStreak,
            uint256 totalCheckIns,
            uint256 lastDay,
            bool checkedInToday
        )
    {
        UserInfo storage u = _users[user];
        uint256 day = block.timestamp / 86400;
        return (
            _effectiveStreak(user),
            u.bestStreak,
            u.totalCheckIns,
            u.lastDay,
            u.lastDay == day
        );
    }

    /// @notice Whether `user` has already claimed the badge for `tier`.
    function badgeClaimed(address user, uint8 tier) external view returns (bool) {
        return _badgeClaimedByUser[user][tier];
    }

    /// @notice Badge tier of a minted token id.
    function tokenTier(uint256 tokenId) external view returns (uint8) {
        require(_ownerOf(tokenId) != address(0), "Nonexistent token");
        return _tokenTier[tokenId];
    }

    /// @notice tokenURI = baseURI + tier number (e.g. baseURI "…/badge/" + "2").
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Nonexistent token");
        return string(abi.encodePacked(_baseTokenURI, uint256(_tokenTier[tokenId]).toString()));
    }

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    // ------------------------------------------------------------------
    // Owner (the ONLY owner power besides transferOwnership)
    // ------------------------------------------------------------------

    /// @notice Set the base URI used to build badge tokenURIs.
    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
        emit BaseURIChanged(newBaseURI);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev Live streak: stored streak if the last check-in was today or
    /// yesterday, otherwise the streak is broken and counts as 0.
    function _effectiveStreak(address user) internal view returns (uint256) {
        UserInfo storage u = _users[user];
        if (u.lastDay == 0) return 0;
        uint256 day = block.timestamp / 86400;
        if (u.lastDay == day || u.lastDay == day - 1) {
            return u.currentStreak;
        }
        return 0;
    }

    /// @dev Soulbound: badges can be minted and burned, never transferred.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        require(from == address(0) || to == address(0), "Badges are soulbound");
        return super._update(to, tokenId, auth);
    }
}
