// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title MockAgentID
/// @notice Minimal stand-in for the Agent ID registry, for local tests only.
/// Only implements what AgentRollCall actually calls: balanceOf(address).
/// `mint` is permissionless because this contract is never deployed to a
/// real network — it exists purely so tests can grant/revoke "Agent ID
/// holder" status at will.
contract MockAgentID {
    mapping(address => uint256) private _balances;

    function balanceOf(address owner) external view returns (uint256) {
        return _balances[owner];
    }

    /// @notice Test helper: give `to` one mock Agent ID.
    function mint(address to) external {
        _balances[to] += 1;
    }

    /// @notice Test helper: remove all mock Agent IDs from `from`.
    function burn(address from) external {
        _balances[from] = 0;
    }
}
